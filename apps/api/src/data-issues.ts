import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { importerScopePredicate, permissionConfig } from "./authorization.js";

const listQuerySchema = z.object({
  status: z.enum(["open", "resolved", "all"]).default("open"),
  code: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const resolveBodySchema = z.object({
  evidence: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, "Informe a evidência da resolução."),
  reason: z.string().trim().min(1).max(2000),
  proposedPurchaseOrder: z.string().trim().max(80).nullable().optional(),
  proposedIpNumber: z.string().trim().max(80).nullable().optional(),
}).strict();

function problem(reply: FastifyReply, status: number, code: string, detail: string) {
  return reply.code(status).send({
    type: "about:blank",
    title: status === 404 ? "Recurso não encontrado" : status === 409 ? "Conflito" : "Requisição inválida",
    status,
    detail,
    instance: reply.request.url.split("?", 1)[0],
    traceId: reply.request.id,
    code,
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function visibleIssueSql(scopes: readonly string[], priorParameterCount = 0, master = false) {
  if (master) return { sql: "TRUE", values: [] };
  const poScope = importerScopePredicate("po.importer", priorParameterCount + 1, scopes);
  const processScope = importerScopePredicate("process.importer", priorParameterCount + 2, scopes);
  return {
    sql: `EXISTS (
      SELECT 1 FROM procurement.po_line_observation AS obs
      JOIN procurement.purchase_order AS po ON po.id = obs.purchase_order_id
      WHERE obs.source_row_id = issue.source_row_id AND ${poScope.sql}
    ) OR EXISTS (
      SELECT 1 FROM costs.process_cost AS cost
      JOIN imports.import_process AS process ON process.id = cost.process_id
      WHERE cost.source_row_id = issue.source_row_id AND ${processScope.sql}
    )`,
    values: [...poScope.values, ...processScope.values],
  };
}

export async function registerDataIssueRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get<{ Querystring: { status?: string; code?: string; page?: string; pageSize?: string } }>(
    "/api/v1/data-issues",
    { config: permissionConfig("quality.read") },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Os filtros ou a paginação são inválidos.");
      const { status, page, pageSize } = parsed.data;
      const code = parsed.data.code || null;
      const scopes = request.authorizationContext?.importerScopes ?? [];
      const visible = visibleIssueSql(scopes, 0, request.authorizationContext?.roles.includes("Master") ?? false);
      const offset = (page - 1) * pageSize;
      const result = await pool.query<{
        total_count: number | string;
        open_count: number | string;
        resolved_count: number | string;
        items: Array<Record<string, unknown>>;
      }>(
        `WITH visible AS MATERIALIZED (
           SELECT issue.id, issue.batch_id, issue.source_row_id, issue.severity,
                  issue.issue_code, issue.field_name, issue.evidence, issue.status,
                  issue.created_at, source.sheet_name, source.row_number,
                  source.raw_values AS source_values
           FROM migration.data_issue AS issue
           JOIN migration.source_row AS source ON source.id = issue.source_row_id
           WHERE (${visible.sql}) AND ($${visible.values.length + 1}::text IS NULL OR issue.issue_code = $${visible.values.length + 1})
         ), filtered AS MATERIALIZED (
           SELECT * FROM visible
           WHERE $${visible.values.length + 2} = 'all'
              OR ($${visible.values.length + 2} = 'open' AND status = 'OPEN')
              OR ($${visible.values.length + 2} = 'resolved' AND status = 'RESOLVED')
         ), page AS (
           SELECT filtered.*,
                  (SELECT jsonb_build_object(
                    'id', review.id,
                    'outcome', review.outcome,
                    'reviewer', review.reviewer,
                    'notes', review.notes,
                    'evidence', review.resolution_evidence,
                    'proposedPurchaseOrder', review.proposed_purchase_order,
                    'proposedIpNumber', review.proposed_ip_number,
                    'recordedAt', review.recorded_at
                  ) FROM migration.quality_review AS review
                  WHERE review.data_issue_id = filtered.id
                     OR (review.data_issue_id IS NULL
                         AND review.source_row_id = filtered.source_row_id
                         AND review.issue_code = filtered.issue_code)
                  ORDER BY (review.data_issue_id = filtered.id) DESC NULLS LAST,
                           review.recorded_at DESC, review.id DESC LIMIT 1) AS latest_review
           FROM filtered
           ORDER BY created_at DESC, id
           LIMIT $${visible.values.length + 3} OFFSET $${visible.values.length + 4}
         )
         SELECT (SELECT count(*)::int FROM filtered) AS total_count,
                (SELECT count(*)::int FROM visible WHERE status = 'OPEN') AS open_count,
                (SELECT count(*)::int FROM visible WHERE status = 'RESOLVED') AS resolved_count,
                coalesce(jsonb_agg(jsonb_build_object(
                  'id', page.id,
                  'sourceRowId', page.source_row_id,
                  'severity', page.severity,
                  'code', page.issue_code,
                  'fieldName', page.field_name,
                  'evidence', page.evidence,
                  'status', page.status,
                  'createdAt', page.created_at,
                  'sheetName', page.sheet_name,
                  'sourceRowNumber', page.row_number,
                  'sourceValues', page.source_values,
                  'latestReview', page.latest_review
                ) ORDER BY page.created_at DESC, page.id) FILTER (WHERE page.id IS NOT NULL), '[]'::jsonb) AS items
         FROM page`,
        [...visible.values, code, status, pageSize, offset],
      );

      return {
        page,
        pageSize,
        totalCount: Number(result.rows[0]?.total_count ?? 0),
        openCount: Number(result.rows[0]?.open_count ?? 0),
        resolvedCount: Number(result.rows[0]?.resolved_count ?? 0),
        items: result.rows[0]?.items ?? [],
      };
    },
  );

  app.post<{ Params: { id: string }; Body: z.infer<typeof resolveBodySchema> }>(
    "/api/v1/data-issues/:id/resolve",
    { config: permissionConfig("quality.resolve") },
    async (request, reply) => {
      const id = z.string().uuid().safeParse(request.params.id);
      const body = resolveBodySchema.safeParse(request.body);
      const idempotencyKey = request.headers["idempotency-key"];
      if (!id.success || !body.success || typeof idempotencyKey !== "string"
        || !/^[\x21-\x7e]{1,128}$/u.test(idempotencyKey)) {
        return problem(reply, 400, "INVALID_RESOLUTION", "Informe id válido, evidência, justificativa e Idempotency-Key.");
      }

      const identity = request.authContext;
      const authorization = request.authorizationContext;
      if (!identity || !authorization) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessão ausente ou expirada.");
      const normalized = {
        issueId: id.data,
        evidence: body.data.evidence,
        reason: body.data.reason,
        proposedPurchaseOrder: body.data.proposedPurchaseOrder ?? null,
        proposedIpNumber: body.data.proposedIpNumber ?? null,
      };
      const payloadHash = createHash("sha256").update(canonicalJson(normalized)).digest("hex");
      const scopeForIssue = visibleIssueSql(authorization.importerScopes, 1, authorization.roles.includes("Master"));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serialize retries with the same actor/key without holding a table lock.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${identity.userId}:${idempotencyKey}`]);
        const previous = await client.query<{
          payload_sha256: string;
          id: string;
          recorded_at: Date;
        }>(
          `SELECT review.payload_sha256, review.id, review.recorded_at
           FROM migration.quality_review AS review
           WHERE review.reviewer_user_id = $1 AND review.idempotency_key = $2
           LIMIT 1`,
          [identity.userId, idempotencyKey],
        );
        const visibleIssue = await client.query<{
          id: string;
          batch_id: string;
          source_row_id: string;
          issue_code: string;
          status: string;
          evidence: Record<string, unknown>;
        }>(
          `SELECT issue.id, issue.batch_id, issue.source_row_id, issue.issue_code,
                  issue.status, issue.evidence
           FROM migration.data_issue AS issue
           WHERE issue.id = $1 AND issue.source_row_id IS NOT NULL AND (${scopeForIssue.sql})
           FOR UPDATE OF issue`,
          [id.data, ...scopeForIssue.values],
        );
        const issue = visibleIssue.rows[0];
        if (!issue) {
          await client.query("ROLLBACK");
          return problem(reply, 404, "RESOURCE_NOT_FOUND", "A pendência não existe ou não está disponível no escopo autorizado.");
        }
        if (previous.rowCount && previous.rows[0].payload_sha256.trim() !== payloadHash) {
          await client.query("COMMIT");
          return problem(reply, 409, "IDEMPOTENCY_KEY_REUSED", "A chave já foi usada com outro conteúdo.");
        }
        if (previous.rowCount) {
          await client.query("COMMIT");
          return reply.code(200).send({
            id: previous.rows[0].id,
            issueId: issue.id,
            status: issue.status,
            recordedAt: previous.rows[0].recorded_at,
          });
        }
        if (issue.status !== "OPEN") {
          await client.query("ROLLBACK");
          return problem(reply, 409, "ISSUE_ALREADY_RESOLVED", "A pendência já foi resolvida.");
        }

        const reviewId = randomUUID();
        const actor = `${identity.issuer}#${identity.subject}`;
        const displayReviewer = identity.displayName?.trim() || identity.subject;
        const recordedAt = new Date();
        await client.query(
          `INSERT INTO migration.quality_review
            (id, data_issue_id, batch_id, source_row_id, issue_code, outcome, reviewer, notes,
             proposed_purchase_order, proposed_ip_number, recorded_at,
             resolution_evidence, reviewer_user_id, idempotency_key, payload_sha256)
           VALUES ($1, $2, $3, $4, $5, 'Resolved', $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)`,
          [reviewId, issue.id, issue.batch_id, issue.source_row_id, issue.issue_code, displayReviewer,
            body.data.reason, normalized.proposedPurchaseOrder, normalized.proposedIpNumber,
            recordedAt, JSON.stringify(body.data.evidence), identity.userId, idempotencyKey, payloadHash],
        );
        await client.query(
          "UPDATE migration.data_issue SET status = 'RESOLVED' WHERE id = $1 AND status = 'OPEN'",
          [issue.id],
        );
        const correlationId = randomUUID();
        await client.query(
          `INSERT INTO audit.audit_log
            (id, aggregate_type, aggregate_id, entity_type, entity_id, operation,
             field_name, old_value, new_value, actor_id, occurred_at, reason, correlation_id)
           VALUES ($1, 'DATA_ISSUE', $2, 'DATA_ISSUE', $2, 'RESOLVE', 'status',
             $3::jsonb, $4::jsonb, $5, $6, $7, $8)`,
          [randomUUID(), issue.id, JSON.stringify({ status: "OPEN" }),
            JSON.stringify({ status: "RESOLVED", reviewId }), actor, recordedAt,
            body.data.reason, correlationId],
        );
        await client.query(
          `INSERT INTO audit.outbox_message
            (event_id, event_type, aggregate_type, aggregate_id, payload, occurred_at)
           VALUES ($1, 'quality.issue.resolved', 'DATA_ISSUE', $2, $3::jsonb, $4)`,
          [randomUUID(), issue.id, JSON.stringify({ issueId: issue.id, reviewId }), recordedAt],
        );
        await client.query("COMMIT");
        return reply.code(201).send({ id: reviewId, issueId: issue.id, status: "RESOLVED", recordedAt });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  );
}
