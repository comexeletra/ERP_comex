import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { createTtceClient, createTtceRepository, selectTtceTreatments,
  TTCE_SOURCE, TtceError, type TtceCredentials } from "./ttce.js";

const querySchema = z.object({
  date: z.iso.date().optional(),
  originCountry: z.string().regex(/^\d{1,3}$/u).optional(),
  destinationUf: z.string().regex(/^[A-Za-z]{2}$/u).optional(),
  destinationCity: z.string().regex(/^\d{7}$/u).optional(),
}).strict();
const paramsSchema = z.object({ id: z.uuid() });
const limitation = "A fonte em lote inclui fundamentos opcionais e fundamentos normais ou teto com atributos adicionais. Ela não inclui todos os tratamentos normais nem valores calculados; esta consulta não determina o imposto devido.";

function problem(reply: FastifyReply, status: number, code: string, detail: string) {
  return reply.code(status).send({ type: "about:blank", title: detail, status, detail,
    instance: reply.request.url.split("?", 1)[0], traceId: reply.request.id, code });
}
function brasiliaToday(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function registerTaxTreatmentRoutes(app: FastifyInstance, pool: Pool,
  options: { credentials?: TtceCredentials; client?: ReturnType<typeof createTtceClient> } = {}) {
  const client = options.client ?? (options.credentials ? createTtceClient(options.credentials) : undefined);
  const chapter = createTtceRepository(pool, client);
  app.get("/api/v1/ncms/:id/tax-treatments", {
    config: permissionConfig("catalog.read", "global"),
  }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const query = querySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return problem(reply, 400, "INVALID_TAX_QUERY", "Informe NCM, data, país de origem e destino válidos.");
    }
    const result = await pool.query<{ code: string; name: string; valid_from: string | null; valid_to: string | null }>(
      `SELECT code,name,valid_from::text,valid_to::text FROM catalog.entry
       WHERE id=$1 AND kind='NCM' AND importer IS NULL`, [params.data.id]);
    const ncm = result.rows[0];
    if (!ncm) return problem(reply, 404, "NCM_NOT_FOUND", "NCM não encontrada.");
    const referenceDate = query.data.date ?? brasiliaToday();
    if ((ncm.valid_from && referenceDate < ncm.valid_from)
      || (ncm.valid_to && referenceDate > ncm.valid_to)) {
      return problem(reply, 409, "NCM_NOT_VALID_ON_DATE", "A NCM não tem vigência confirmada na data informada.");
    }
    const missingInputs = ([
      ["originCountry", query.data.originCountry],
      ["destinationUf", query.data.destinationUf],
      ["destinationCity", query.data.destinationCity],
    ] as const).filter(([, value]) => !value).map(([name]) => name);
    reply.header("cache-control", "no-store");
    if (missingInputs.length) {
      return { ncm: { id: params.data.id, code: ncm.code, name: ncm.name }, referenceDate,
        status: "needs_input", missingInputs, treatments: [], source: TTCE_SOURCE,
        limitation, sourceHash: null, fetchedAt: null, stale: false };
    }
    try {
      const cached = await chapter(referenceDate, ncm.code.slice(0, 2));
      const selected = selectTtceTreatments(cached.payload, {
        ncm: ncm.code, originCountry: query.data.originCountry!,
        destinationUf: query.data.destinationUf!, destinationCity: query.data.destinationCity!,
      });
      return { ncm: { id: params.data.id, code: ncm.code, name: ncm.name }, referenceDate,
        originCountry: query.data.originCountry, destinationUf: query.data.destinationUf!.toUpperCase(),
        destinationCity: query.data.destinationCity, status: "partial",
        treatments: selected.treatments, matchedIntervals: selected.matchedIntervals,
        missingInputs: [], source: TTCE_SOURCE, sourceHash: cached.sourceHash,
        fetchedAt: cached.fetchedAt.toISOString(), stale: cached.stale, limitation };
    } catch (error) {
      if (error instanceof TtceError) {
        if (error.retryAt && error.retryAt > Date.now()) {
          reply.header("retry-after", String(Math.ceil((error.retryAt - Date.now()) / 1000)));
        }
        return problem(reply, error.status, "TTCE_UNAVAILABLE", error.message);
      }
      request.log.error({ code: "TTCE_QUERY_FAILED", message: error instanceof Error ? error.message : "unknown" },
        "Consulta TTCE falhou");
      return problem(reply, 502, "TTCE_INVALID_RESPONSE", "Não foi possível validar a resposta do tratamento tributário oficial.");
    }
  });
}
