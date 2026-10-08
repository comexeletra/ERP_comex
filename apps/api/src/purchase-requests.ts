import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { actorAndScopes, BusinessError, keyFrom, problem, receipt, record, saveReceipt, transaction } from "./operations.js";

const uuid = z.uuid();
const date = z.iso.date().nullable();
const reason = z.string().trim().min(3).max(1000);
const querySchema = z.object({ importer: z.string().trim().min(1).max(120).optional() }).strict();
const createSchema = z.object({
  importer: z.string().trim().min(1).max(120),
  scNumber: z.string().trim().min(1).max(80),
  commercialPlanReceivedDate: date,
  requester: z.string().trim().min(1).max(160),
  approvalDate: date,
  reason,
}).strict();

export async function registerPurchaseRequestRoutes(app: FastifyInstance, pool: Pool) {
  app.get("/api/v1/purchase-requests", { config: permissionConfig("purchase-requests.read") }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Filtro de importadora inválido.");
    const scopes = request.authorizationContext?.importerScopes ?? [];
    if (parsed.data.importer && !scopes.includes(parsed.data.importer)) {
      return problem(reply, 404, "RESOURCE_NOT_FOUND", "Importadora fora do seu escopo.");
    }
    const result = await pool.query(
      `SELECT sc.id, sc.importer, sc.sc_number AS "scNumber",
              sc.commercial_plan_received_date::text AS "commercialPlanReceivedDate",
              sc.requester, sc.approval_date::text AS "approvalDate", sc.version::text,
              count(po.id)::int AS "purchaseOrderCount"
       FROM procurement.purchase_request sc
       LEFT JOIN procurement.purchase_order po ON po.purchase_request_id = sc.id
       WHERE sc.importer = ANY($1::text[]) AND ($2::text IS NULL OR sc.importer = $2)
       GROUP BY sc.id
       ORDER BY sc.importer, sc.normalized_sc_number, sc.id`,
      [scopes, parsed.data.importer ?? null]);
    return { items: result.rows };
  });

  app.post("/api/v1/purchase-requests", { config: permissionConfig("purchase-requests.write") }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return problem(reply, 400, "INVALID_PURCHASE_REQUEST", "Revise os dados da SC.");
    let actor: ReturnType<typeof actorAndScopes>;
    let key: string;
    try {
      actor = actorAndScopes(request);
      key = keyFrom(request);
    } catch (error) {
      if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message);
      throw error;
    }
    if (!actor.scopes.includes(parsed.data.importer)) {
      return problem(reply, 404, "RESOURCE_NOT_FOUND", "Importadora fora do seu escopo.");
    }
    return transaction(pool, reply, async client => {
      const knownImporter = await client.query(
        `SELECT importer FROM procurement.purchase_order WHERE importer = $1
         UNION SELECT importer FROM imports.import_process WHERE importer = $1
         UNION SELECT value AS importer FROM catalog.operational_value
           WHERE entity_key = 'IMPORTER' AND value = $1 LIMIT 1`, [parsed.data.importer]);
      if (!knownImporter.rowCount) throw new BusinessError(404, "UNKNOWN_IMPORTER", "Importadora ainda não cadastrada.");

      const claim = await receipt(client, actor.actor.userId, key, "PURCHASE_REQUEST", parsed.data);
      if (claim.existingId) {
        const existing = await client.query(
          `SELECT id, importer, sc_number AS "scNumber",
                  commercial_plan_received_date::text AS "commercialPlanReceivedDate",
                  requester, approval_date::text AS "approvalDate", version::text
           FROM procurement.purchase_request WHERE id = $1 AND importer = ANY($2::text[])`,
          [claim.existingId, actor.scopes]);
        if (!existing.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "SC não encontrada.");
        return { ...existing.rows[0], replayed: true };
      }

      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO procurement.purchase_request
           (id, importer, sc_number, normalized_sc_number, commercial_plan_received_date,
            requester, approval_date, created_by)
         VALUES ($1,$2,$3::varchar,upper(btrim($3::varchar)),$4,$5,$6,$7)
         RETURNING id, importer, sc_number AS "scNumber",
                   commercial_plan_received_date::text AS "commercialPlanReceivedDate",
                   requester, approval_date::text AS "approvalDate", version::text`,
        [id, parsed.data.importer, parsed.data.scNumber, parsed.data.commercialPlanReceivedDate,
          parsed.data.requester, parsed.data.approvalDate, `${actor.actor.issuer}#${actor.actor.subject}`]);
      await saveReceipt(client, actor.actor.userId, key, claim.hash, "PURCHASE_REQUEST", id);
      await record(client, "PURCHASE_REQUEST", id, "PURCHASE_REQUEST", id, "CREATE", null,
        parsed.data, actor.actor, parsed.data.reason);
      return inserted.rows[0];
    }, 201);
  });
}
