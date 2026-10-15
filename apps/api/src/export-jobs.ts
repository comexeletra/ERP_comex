import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";

const filtersSchema = z.object({
  number: z.string().trim().max(80).optional(),
  importer: z.string().trim().max(120).optional(),
  product: z.string().trim().max(200).optional(),
  ipNumber: z.string().trim().max(80).optional(),
}).strict();
const jobIdSchema = z.string().uuid();

function canAccessExport(
  left: readonly string[], right: readonly string[], requestedAsMaster: boolean, currentRoles: readonly string[],
): boolean {
  if (requestedAsMaster && currentRoles.includes("Master")) return true;
  const normalized = (values: readonly string[]) => [...new Set(values)].sort();
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

export async function registerExportJobRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/exports", {
    config: permissionConfig("purchase-orders.read"),
  }, async (request, reply) => {
    const result = await pool.query<{
      id: string; status: string; importer_scopes: string[]; error_code: string | null;
      requested_as_master: boolean; created_at: Date; expires_at: Date | null;
    }>(
      `SELECT id, status, importer_scopes, requested_as_master, error_code, created_at, expires_at
       FROM jobs.export_job
       WHERE requested_by = $1 AND job_type = 'purchase-order-xlsx'
       ORDER BY created_at DESC LIMIT 20`,
      [request.authContext!.userId],
    );
    const authorization = request.authorizationContext;
    const currentScopes = authorization?.importerScopes ?? [];
    reply.header("cache-control", "no-store");
    return { items: result.rows.filter(job => canAccessExport(job.importer_scopes, currentScopes,
      job.requested_as_master, authorization?.roles ?? [])).map(job => ({
      id: job.id,
      status: job.status,
      errorCode: job.status === "failed" ? job.error_code : null,
      createdAt: job.created_at,
      expiresAt: job.expires_at,
      downloadPath: job.status === "completed" && job.expires_at && job.expires_at > new Date()
        ? `/api/v1/exports/${job.id}/download` : null,
    })) };
  });

  app.post("/api/v1/exports/purchase-orders", {
    config: permissionConfig("purchase-orders.read"),
  }, async (request, reply) => {
    const parsed = filtersSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Filtros inválidos para a exportação." });
    }

    const id = randomUUID();
    const userId = request.authContext!.userId;
    const authorization = request.authorizationContext;
    const importerScopes = authorization?.importerScopes ?? [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('export-jobs:global', 0))");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`export-jobs:${userId}`]);
      const counts = await client.query<{ user_active: number; total_active: number }>(
        `SELECT count(*) FILTER (WHERE requested_by = $1)::int AS user_active,
                count(*)::int AS total_active
         FROM jobs.export_job WHERE status IN ('queued', 'running')`,
        [userId],
      );
      const count = counts.rows[0];
      if (Number(count?.user_active ?? 0) >= 3) {
        await client.query("ROLLBACK");
        reply.header("retry-after", "60");
        return reply.code(429).send({ error: "Você já tem três exportações em andamento." });
      }
      if (Number(count?.total_active ?? 0) >= 500) {
        await client.query("ROLLBACK");
        reply.header("retry-after", "60");
        return reply.code(503).send({ error: "A fila de exportações está cheia. Tente novamente em instantes." });
      }
      await client.query(
        `INSERT INTO jobs.export_job
           (id, job_type, requested_by, importer_scopes, requested_as_master, parameters)
         VALUES ($1, 'purchase-order-xlsx', $2, $3::text[], $4, $5::jsonb)`,
        [id, userId, importerScopes, authorization?.roles.includes("Master") ?? false,
          JSON.stringify(parsed.data)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    reply.header("cache-control", "no-store");
    return reply.code(202).send({ id, status: "queued" });
  });

  app.get<{ Params: { id: string } }>("/api/v1/exports/:id", {
    config: permissionConfig("purchase-orders.read"),
  }, async (request, reply) => {
    const parsedId = jobIdSchema.safeParse(request.params.id);
    if (!parsedId.success) return reply.code(404).send({ error: "Exportação não encontrada." });
    const result = await pool.query<{
      status: string; importer_scopes: string[]; requested_as_master: boolean; error_code: string | null;
      expires_at: Date | null;
    }>(
      `SELECT status, importer_scopes, requested_as_master, error_code, expires_at
       FROM jobs.export_job
       WHERE id = $1 AND requested_by = $2`,
      [parsedId.data, request.authContext!.userId],
    );
    const job = result.rows[0];
    const authorization = request.authorizationContext;
    if (!job || !canAccessExport(job.importer_scopes, authorization?.importerScopes ?? [],
      job.requested_as_master, authorization?.roles ?? [])) {
      return reply.code(404).send({ error: "Exportação não encontrada." });
    }
    reply.header("cache-control", "no-store");
    return {
      id: parsedId.data,
      status: job.status,
      errorCode: job.status === "failed" ? job.error_code : null,
      downloadPath: job.status === "completed" && job.expires_at && job.expires_at > new Date()
        ? `/api/v1/exports/${parsedId.data}/download` : null,
      expiresAt: job.expires_at,
    };
  });

  app.get<{ Params: { id: string } }>("/api/v1/exports/:id/download", {
    config: permissionConfig("purchase-orders.read"),
  }, async (request, reply) => {
    const parsedId = jobIdSchema.safeParse(request.params.id);
    if (!parsedId.success) return reply.code(404).send({ error: "Exportação não encontrada." });
    const result = await pool.query<{ importer_scopes: string[]; requested_as_master: boolean;
      result_binary: Buffer | null }>(
      `SELECT importer_scopes, requested_as_master, result_binary
       FROM jobs.export_job
       WHERE id = $1 AND requested_by = $2 AND job_type = 'purchase-order-xlsx'
         AND status = 'completed' AND expires_at > now()`,
      [parsedId.data, request.authContext!.userId],
    );
    const job = result.rows[0];
    const authorization = request.authorizationContext;
    if (!job || !job.result_binary
      || !canAccessExport(job.importer_scopes, authorization?.importerScopes ?? [],
        job.requested_as_master, authorization?.roles ?? [])) {
      return reply.code(404).send({ error: "Arquivo de exportação indisponível." });
    }

    reply.header("cache-control", "no-store");
    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("content-disposition", 'attachment; filename="carteira-pos.xlsx"');
    return reply.send(job.result_binary);
  });
}
