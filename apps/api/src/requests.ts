import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";

const requestQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const createRequestBody = z.object({
  importer: z.string().trim().min(1).max(120),
  requesterReference: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(8).max(2000),
  notes: z.string().trim().max(2000).default(""),
  items: z.array(z.object({
    description: z.string().trim().min(1).max(1000),
    purposeText: z.string().trim().max(500).nullable().optional(),
    costCenterText: z.string().trim().max(160).nullable().optional(),
  }).strict()).min(1).max(100),
}).strict();
const updateRequestBody = z.object({
  requesterReference: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(8).max(2000),
  notes: z.string().trim().max(2000),
  items: z.array(z.object({
    id: z.uuid().optional(),
    description: z.string().trim().min(1).max(1000),
    purposeText: z.string().trim().max(500).nullable().optional(),
    costCenterText: z.string().trim().max(160).nullable().optional(),
  }).strict()).min(1).max(100),
}).strict();

type RequestItem = { id: string; line_number: number; description: string; source_kind: "NATIVE";
  purpose_text: string | null; cost_center_text: string | null; created_at: Date };
type RequestRow = { id: string; request_number: string; importer: string;
  source_kind: "NATIVE"; requester_reference: string; reason: string; notes: string; status: string; version: string;
  created_at: Date; updated_at: Date; item_count?: number };
type RequestHistoryRow = { id: string; operation: string; field_name: string | null;
  old_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null;
  actor_id: string; occurred_at: string; reason: string | null };

function changedRequestFields(row: RequestHistoryRow): string[] {
  if (row.operation === "CREATE") return ["Criação"];
  const fields: Array<[string, string]> = [
    ["requesterReference", "Solicitante"], ["reason", "Motivo"],
    ["notes", "Observações"], ["items", "Itens"],
  ];
  return fields.filter(([key]) => canonicalJson(row.old_value?.[key]) !== canonicalJson(row.new_value?.[key]))
    .map(([, label]) => label);
}

function problem(reply: FastifyReply, status: number, code: string, detail: string) {
  return reply.code(status).send({ type: "about:blank", title: detail, status, detail,
    instance: reply.request.url.split("?", 1)[0], traceId: reply.request.id, code });
}
function validKey(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,128}$/u.test(value);
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${fields.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function presentItem(item: RequestItem) {
  return { id: item.id, lineNumber: item.line_number, description: item.description, sourceKind: item.source_kind,
    purposeText: item.purpose_text, costCenterText: item.cost_center_text, createdAt: item.created_at };
}
function presentRequest(row: RequestRow, items?: RequestItem[]) {
  return { id: row.id, requestNumber: row.request_number, importer: row.importer, sourceKind: row.source_kind,
    requesterReference: row.requester_reference, reason: row.reason, notes: row.notes, status: row.status,
    version: String(row.version), itemCount: Number(row.item_count ?? items?.length ?? 0),
    ...(items ? { items: items.map(presentItem) } : {}), createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function registerRequestRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/requests", { config: permissionConfig("requests.read") }, async (request, reply) => {
    const parsed = requestQuery.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Paginação inválida.");
    const { page, pageSize } = parsed.data;
    const scopes = request.authorizationContext?.importerScopes ?? [];
    const result = await pool.query<{ total_count: number; items: RequestRow[] }>(
      `WITH visible AS MATERIALIZED (
         SELECT req.*, (SELECT count(*)::int FROM procurement.import_request_item AS line
           WHERE line.request_id = req.id) AS item_count
         FROM procurement.import_request AS req WHERE req.importer = ANY($1::text[])
       ), page AS (
         SELECT * FROM visible ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3
       )
       SELECT (SELECT count(*)::int FROM visible) AS total_count,
         coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC)
           FILTER (WHERE page.id IS NOT NULL), '[]'::jsonb) AS items FROM page`,
      [scopes, pageSize, (page - 1) * pageSize]);
    return { page, pageSize, totalCount: Number(result.rows[0]?.total_count ?? 0),
      items: (result.rows[0]?.items ?? []).map(row => presentRequest(row)) };
  });

  app.post("/api/v1/requests", { config: permissionConfig("requests.write") }, async (request, reply) => {
    const parsed = createRequestBody.safeParse(request.body);
    const key = request.headers["idempotency-key"];
    if (!parsed.success || !validKey(key)) {
      return problem(reply, 400, "INVALID_REQUEST", "Informe importador, solicitante, motivo, ao menos um item descrito e Idempotency-Key válidos.");
    }
    const auth = request.authorizationContext;
    const actor = request.authContext;
    if (!auth || !actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
    const body = parsed.data;
    if (!auth.importerScopes.includes(body.importer)) {
      return problem(reply, 404, "RESOURCE_NOT_FOUND", "Importador não encontrado no seu escopo.");
    }
    const hash = createHash("sha256").update(canonicalJson(body)).digest("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`request:${actor.userId}:${key}`]);
      const previous = await client.query<{ payload_sha256: string; request_id: string }>(
        `SELECT payload_sha256, request_id FROM procurement.import_request_command_receipt
         WHERE actor_user_id = $1 AND idempotency_key = $2`, [actor.userId, key]);
      if (previous.rows[0]) {
        const visible = await client.query<RequestRow>(
          `SELECT * FROM procurement.import_request WHERE id = $1 AND importer = ANY($2::text[])`,
          [previous.rows[0].request_id, auth.importerScopes]);
        if (!visible.rows[0]) { await client.query("ROLLBACK"); return problem(reply, 409, "IDEMPOTENCY_KEY_REUSED", "Chave já usada em outra solicitação."); }
        if (previous.rows[0].payload_sha256.trim() !== hash) {
          await client.query("COMMIT");
          return problem(reply, 409, "IDEMPOTENCY_KEY_REUSED", "Chave já usada com outro conteúdo.");
        }
        const lines = await client.query<RequestItem>(
          "SELECT * FROM procurement.import_request_item WHERE request_id = $1 ORDER BY line_number", [visible.rows[0].id]);
        await client.query("COMMIT");
        reply.header("ETag", `"${visible.rows[0].version}"`);
        return reply.code(200).send(presentRequest(visible.rows[0], lines.rows));
      }

      const importer = await client.query(
        `SELECT importer FROM procurement.purchase_order WHERE importer = $1
         UNION SELECT importer FROM imports.import_process WHERE importer = $1 LIMIT 1`, [body.importer]);
      if (!importer.rowCount) {
        await client.query("ROLLBACK");
        return problem(reply, 404, "RESOURCE_NOT_FOUND", "Importador sem origem operacional conhecida.");
      }
      const id = randomUUID();
      const number = await client.query<{ request_number: string }>(
        `SELECT 'SR-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('procurement.import_request_number_seq')::text, 6, '0') AS request_number`);
      const inserted = await client.query<RequestRow>(
        `INSERT INTO procurement.import_request
          (id, request_number, importer, requester_reference, reason, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
        [id, number.rows[0].request_number, body.importer, body.requesterReference, body.reason, body.notes, actor.userId]);
      const itemRows: RequestItem[] = [];
      for (const [index, item] of body.items.entries()) {
        const line = await client.query<RequestItem>(
          `INSERT INTO procurement.import_request_item
            (id, request_id, line_number, description, purpose_text, cost_center_text)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [randomUUID(), id, index + 1, item.description, item.purposeText ?? null, item.costCenterText ?? null]);
        itemRows.push(line.rows[0]);
      }
      await client.query(
        `INSERT INTO procurement.import_request_command_receipt
          (actor_user_id, idempotency_key, payload_sha256, request_id) VALUES ($1,$2,$3,$4)`,
        [actor.userId, key, hash, id]);
      const correlationId = randomUUID();
      await client.query(
        `INSERT INTO audit.audit_log
          (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
         VALUES ($1,'IMPORT_REQUEST',$2,'IMPORT_REQUEST',$2,'CREATE',NULL,NULL,$3::jsonb,$4,now(),$5,$6)`,
        [randomUUID(), id, JSON.stringify(presentRequest(inserted.rows[0], itemRows)), `${actor.issuer}#${actor.subject}`,
          body.reason, correlationId]);
      await client.query(
        `INSERT INTO audit.outbox_message (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
         VALUES ($1,'procurement.request.created','IMPORT_REQUEST',$2,$3::jsonb,now())`,
        [randomUUID(), id, JSON.stringify({ id, requestNumber: number.rows[0].request_number,
          importer: body.importer, itemCount: itemRows.length, version: 1 })]);
      await client.query("COMMIT");
      reply.header("ETag", '"1"');
      return reply.code(201).send(presentRequest(inserted.rows[0], itemRows));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  });

  app.get<{ Params: { id: string } }>("/api/v1/requests/:id", { config: permissionConfig("requests.read") }, async (request, reply) => {
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success) return problem(reply, 400, "INVALID_ID", "Identificador inválido.");
    const scopes = request.authorizationContext?.importerScopes ?? [];
    const found = await pool.query<RequestRow>(
      `SELECT * FROM procurement.import_request WHERE id = $1 AND importer = ANY($2::text[])`, [id.data, scopes]);
    if (!found.rows[0]) return problem(reply, 404, "RESOURCE_NOT_FOUND", "Solicitação não encontrada.");
    const lines = await pool.query<RequestItem>(
      "SELECT * FROM procurement.import_request_item WHERE request_id = $1 ORDER BY line_number", [id.data]);
    reply.header("ETag", `"${found.rows[0].version}"`);
    return presentRequest(found.rows[0], lines.rows);
  });

  app.get<{ Params: { id: string } }>("/api/v1/requests/:id/history", { config: permissionConfig("requests.read") }, async (request, reply) => {
    const id = z.uuid().safeParse(request.params.id);
    const parsed = requestQuery.safeParse(request.query);
    if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_QUERY", "Solicitação ou paginação inválida.");
    const scopes = request.authorizationContext?.importerScopes ?? [];
    const visible = await pool.query<{ id: string }>(
      `SELECT id FROM procurement.import_request WHERE id = $1 AND importer = ANY($2::text[])`,
      [id.data, scopes]);
    if (!visible.rows[0]) return problem(reply, 404, "RESOURCE_NOT_FOUND", "Solicitação não encontrada.");
    const { page, pageSize } = parsed.data;
    const history = await pool.query<{ total_count: number; items: RequestHistoryRow[] }>(
      `WITH page AS (
         SELECT id, operation, field_name, old_value, new_value, actor_id, occurred_at, reason
         FROM audit.import_request_history WHERE aggregate_id = $1
         ORDER BY occurred_at DESC, id DESC LIMIT $2 OFFSET $3
       )
       SELECT (SELECT count(*)::int FROM audit.import_request_history WHERE aggregate_id = $1) AS total_count,
         coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.occurred_at DESC, page.id DESC)
           FILTER (WHERE page.id IS NOT NULL), '[]'::jsonb) AS items FROM page`,
      [id.data, pageSize, (page - 1) * pageSize]);
    return { page, pageSize, totalCount: Number(history.rows[0]?.total_count ?? 0),
      items: (history.rows[0]?.items ?? []).map(row => ({
        id: row.id, operation: row.operation, changedFields: changedRequestFields(row),
        actor: row.actor_id, occurredAt: row.occurred_at, reason: row.reason,
      })) };
  });

  app.patch<{ Params: { id: string } }>("/api/v1/requests/:id", { config: permissionConfig("requests.write") }, async (request, reply) => {
    const id = z.uuid().safeParse(request.params.id);
    const parsed = updateRequestBody.safeParse(request.body);
    const expected = request.headers["if-match"];
    if (!id.success || !parsed.success) {
      return problem(reply, 400, "INVALID_REQUEST_UPDATE", "Informe solicitação, campos completos, ao menos um item e If-Match válido.");
    }
    if (expected === undefined) return problem(reply, 428, "PRECONDITION_REQUIRED", "Informe If-Match com a versão atual da solicitação.");
    if (typeof expected !== "string" || !/^"[1-9][0-9]*"$/u.test(expected)) {
      return problem(reply, 400, "INVALID_REQUEST_UPDATE", "If-Match inválido.");
    }
    const auth = request.authorizationContext;
    const actor = request.authContext;
    if (!auth || !actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
    const body = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<RequestRow>(
        `SELECT * FROM procurement.import_request
         WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE`, [id.data, auth.importerScopes]);
      const before = found.rows[0];
      if (!before) { await client.query("ROLLBACK"); return problem(reply, 404, "RESOURCE_NOT_FOUND", "Solicitação não encontrada."); }
      if (`"${before.version}"` !== expected) {
        await client.query("ROLLBACK");
        return problem(reply, 409, "VERSION_CONFLICT", "Solicitação alterada. Recarregue antes de salvar.");
      }
      if (before.status !== "SUBMITTED") {
        await client.query("ROLLBACK");
        return problem(reply, 409, "REQUEST_NOT_EDITABLE", "Somente solicitações enviadas podem ser editadas.");
      }

      const currentItems = await client.query<RequestItem>(
        "SELECT * FROM procurement.import_request_item WHERE request_id = $1 ORDER BY line_number FOR UPDATE", [id.data]);
      const currentIds = new Set(currentItems.rows.map(item => item.id));
      const requestedIds = body.items.flatMap(item => item.id ? [item.id] : []);
      if (new Set(requestedIds).size !== requestedIds.length || requestedIds.some(itemId => !currentIds.has(itemId))) {
        await client.query("ROLLBACK");
        return problem(reply, 400, "INVALID_REQUEST_ITEMS", "Os itens informados não pertencem à solicitação ou estão duplicados.");
      }

      const existingPayload = {
        requesterReference: before.requester_reference, reason: before.reason, notes: before.notes,
        items: currentItems.rows.map(item => ({ description: item.description,
          purposeText: item.purpose_text, costCenterText: item.cost_center_text })),
      };
      const nextPayload = {
        requesterReference: body.requesterReference, reason: body.reason, notes: body.notes,
        items: body.items.map(item => ({ description: item.description,
          purposeText: item.purposeText ?? null, costCenterText: item.costCenterText ?? null })),
      };
      if (canonicalJson(existingPayload) === canonicalJson(nextPayload)) {
        await client.query("ROLLBACK");
        return problem(reply, 400, "NO_CHANGES", "Nenhuma alteração informada.");
      }

      const updated = await client.query<RequestRow>(
        `UPDATE procurement.import_request
         SET requester_reference = $2, reason = $3, notes = $4, version = version + 1,
             updated_by = $5, updated_at = now()
        WHERE id = $1 RETURNING *`,
        [id.data, body.requesterReference, body.reason, body.notes, actor.userId]);
      // Vacate the current unique line numbers before reordering existing rows.
      await client.query(
        "UPDATE procurement.import_request_item SET line_number = line_number + 1000 WHERE request_id = $1",
        [id.data]);
      const keptItemIds: string[] = [];
      for (const [index, item] of body.items.entries()) {
        if (item.id) {
          keptItemIds.push(item.id);
          await client.query(
            `UPDATE procurement.import_request_item
             SET line_number = $3, description = $4, purpose_text = $5, cost_center_text = $6
             WHERE id = $1 AND request_id = $2`,
            [item.id, id.data, index + 1, item.description, item.purposeText ?? null, item.costCenterText ?? null]);
        } else {
          const newId = randomUUID();
          keptItemIds.push(newId);
          await client.query(
            `INSERT INTO procurement.import_request_item
              (id, request_id, line_number, description, purpose_text, cost_center_text)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [newId, id.data, index + 1, item.description, item.purposeText ?? null, item.costCenterText ?? null]);
        }
      }
      await client.query(
        "DELETE FROM procurement.import_request_item WHERE request_id = $1 AND NOT (id = ANY($2::uuid[]))",
        [id.data, keptItemIds]);
      const savedItems = await client.query<RequestItem>(
        "SELECT * FROM procurement.import_request_item WHERE request_id = $1 ORDER BY line_number", [id.data]);
      const oldValue = presentRequest(before, currentItems.rows);
      const newValue = presentRequest(updated.rows[0], savedItems.rows);
      const correlationId = randomUUID();
      await client.query(
        `INSERT INTO audit.audit_log
          (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
         VALUES ($1,'IMPORT_REQUEST',$2,'IMPORT_REQUEST',$2,'UPDATE','request',$3::jsonb,$4::jsonb,$5,now(),$6,$7)`,
        [randomUUID(), id.data, JSON.stringify(oldValue), JSON.stringify(newValue), `${actor.issuer}#${actor.subject}`,
          body.reason, correlationId]);
      await client.query(
        `INSERT INTO audit.outbox_message (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
         VALUES ($1,'procurement.request.updated','IMPORT_REQUEST',$2,$3::jsonb,now())`,
        [randomUUID(), id.data, JSON.stringify({ id: id.data, requestNumber: before.request_number,
          importer: before.importer, version: String(updated.rows[0].version) })]);
      await client.query("COMMIT");
      reply.header("ETag", `"${updated.rows[0].version}"`);
      return presentRequest(updated.rows[0], savedItems.rows);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  });
}
