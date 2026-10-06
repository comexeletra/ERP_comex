import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";

const quantity = z.string().trim().regex(/^(?:0|[1-9]\d{0,15})(?:[.,]\d{1,8})?$/u)
  .refine(value => !/^0(?:[.,]0+)?$/u.test(value)).transform(value => value.replace(",", "."));
const nonnegative = z.string().trim().regex(/^(?:0|[1-9]\d{0,15})(?:[.,]\d{1,8})?$/u)
  .transform(value => value.replace(",", "."));
const nullableText = (limit: number) => z.string().trim().max(limit).nullable();
const poFields = z.object({
  number: z.string().trim().min(1).max(80),
  supplierText: nullableText(240), orderDate: z.iso.date().nullable(), notes: z.string().trim().max(4000),
  reason: z.string().trim().min(3).max(1000),
}).strict();
export const createPo = poFields.extend({
  importer: z.string().trim().min(1).max(120),
});
const processFields = z.object({
  ipNumber: z.string().trim().min(1).max(80),
  logisticsStatus: nullableText(40), priority: nullableText(20),
  notes: z.string().trim().max(4000), reason: z.string().trim().min(3).max(1000),
}).strict();
const createProcess = processFields.extend({
  importer: z.string().trim().min(1).max(120),
});
export const itemFields = z.object({
  externalLineReference: nullableText(80), productCode: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000), orderedQuantity: quantity,
  unit: z.string().trim().min(1).max(32), unitPrice: nonnegative.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/u).nullable(),
  reason: z.string().trim().min(3).max(1000),
}).strict().refine(value => (value.unitPrice === null) === (value.currency === null));
const allocationFields = z.object({
  quantity, notes: z.string().trim().max(2000), reason: z.string().trim().min(3).max(1000),
}).strict();
const createAllocation = allocationFields.extend({
  itemId: z.uuid(), processId: z.uuid(),
});
const cancelAllocation = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
const closeProcess = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
const uuid = z.uuid();

export class BusinessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function problem(reply: FastifyReply, status: number, code: string, detail: string) {
  return reply.code(status).send({ type: "about:blank", title: detail, status, detail,
    instance: reply.request.url.split("?", 1)[0], traceId: reply.request.id, code });
}
export function keyFrom(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !/^[\x21-\x7e]{1,128}$/u.test(key)) {
    throw new BusinessError(400, "INVALID_IDEMPOTENCY_KEY", "Informe Idempotency-Key válido.");
  }
  return key;
}
export function versionFrom(request: FastifyRequest): string {
  const value = request.headers["x-record-version"] ?? request.headers["if-match"];
  if (value === undefined) throw new BusinessError(428, "PRECONDITION_REQUIRED", "Informe X-Record-Version com a versão atual.");
  if (typeof value !== "string" || !/^"[0-9]+"$/u.test(value)) {
    if (typeof value === "string" && /^[0-9]+$/u.test(value)) return `"${value}"`;
    throw new BusinessError(400, "INVALID_VERSION", "X-Record-Version inválido.");
  }
  return value;
}
export function actorAndScopes(request: FastifyRequest) {
  const actor = request.authContext;
  const auth = request.authorizationContext;
  if (!actor || !auth) throw new BusinessError(401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
  return { actor, scopes: auth.importerScopes };
}
function inScope(importer: string, scopes: readonly string[]) {
  if (!scopes.includes(importer)) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Importadora fora do seu escopo.");
}
export async function transaction<T>(pool: Pool, reply: FastifyReply, fn: (client: PoolClient) => Promise<T>, status = 200) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return reply.code(status).send(result);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message);
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "23505") return problem(reply, 409, "DUPLICATE_RECORD", "Já existe um registro com essa identidade ou vínculo.");
    if (code === "23514") return problem(reply, 409, "BUSINESS_CONSTRAINT", "A quantidade ou o vínculo viola uma regra do pedido.");
    throw error;
  } finally { client.release(); }
}
export async function receipt(client: PoolClient, actorId: string, key: string, type: string, payload: unknown) {
  const hash = createHash("sha256").update(JSON.stringify({ type, payload })).digest("hex");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`operational:${actorId}:${key}`]);
  const previous = await client.query<{ payload_sha256: string; resource_type: string; resource_id: string }>(
    `SELECT payload_sha256, resource_type, resource_id FROM procurement.operational_command_receipt
     WHERE actor_user_id = $1 AND idempotency_key = $2`, [actorId, key]);
  if (previous.rows[0]) {
    if (previous.rows[0].payload_sha256.trim() !== hash || previous.rows[0].resource_type !== type) {
      throw new BusinessError(409, "IDEMPOTENCY_KEY_REUSED", "Chave já usada com outro conteúdo.");
    }
    return { hash, existingId: previous.rows[0].resource_id };
  }
  return { hash, existingId: null };
}
export async function saveReceipt(client: PoolClient, actorId: string, key: string, hash: string, type: string, id: string) {
  await client.query(
    `INSERT INTO procurement.operational_command_receipt
     (actor_user_id,idempotency_key,payload_sha256,resource_type,resource_id)
     VALUES ($1,$2,$3,$4,$5)`, [actorId, key, hash, type, id]);
}
export async function record(client: PoolClient, aggregateType: string, aggregateId: string,
  entityType: string, entityId: string, operation: string, before: unknown, after: unknown,
  actor: { issuer: string; subject: string }, reason: string) {
  const eventId = randomUUID();
  await client.query(
    `INSERT INTO audit.audit_log
     (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,
      actor_id,occurred_at,reason,correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,$7::jsonb,$8::jsonb,$9,now(),$10,$11)`,
    [randomUUID(), aggregateType, aggregateId, entityType, entityId, operation,
      before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after),
      `${actor.issuer}#${actor.subject}`, reason, eventId]);
  await client.query(
    `INSERT INTO audit.outbox_message
     (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,now())`,
    [eventId, `comex.${entityType.toLowerCase()}.${operation.toLowerCase()}`,
      aggregateType, aggregateId, JSON.stringify({ aggregateId, entityId, operation })]);
}
async function knownImporter(client: PoolClient, importer: string) {
  const result = await client.query(
    `SELECT importer FROM procurement.purchase_order WHERE importer = $1
     UNION SELECT importer FROM imports.import_process WHERE importer = $1
     UNION SELECT value AS importer FROM catalog.operational_value WHERE entity_key = 'IMPORTER' AND value = $1
     LIMIT 1`, [importer]);
  if (!result.rowCount) throw new BusinessError(404, "UNKNOWN_IMPORTER", "Importadora ainda não cadastrada.");
}
export async function lockedPo(client: PoolClient, id: string, scopes: string[]) {
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM procurement.purchase_order WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE`,
    [id, scopes]);
  if (!result.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "PO não encontrada.");
  return result.rows[0];
}
export function checkVersion(row: Record<string, unknown>, expected: string) {
  if (`"${row.version}"` !== expected) {
    throw new BusinessError(409, "VERSION_CONFLICT", "Registro alterado. Recarregue antes de salvar.");
  }
}

export async function registerOperationalRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/v1/purchase-orders/:id/operational",
    { config: permissionConfig("purchase-orders.read") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      if (!id.success) return problem(reply, 400, "INVALID_ID", "Identificador inválido.");
      const scopes = request.authorizationContext?.importerScopes ?? [];
      const po = await pool.query<Record<string, unknown>>(
        `SELECT id, importer, external_number AS number, supplier_text AS "supplierText",
                order_date::text AS "orderDate", notes, source_kind AS "sourceKind", version::text
         FROM procurement.purchase_order WHERE id = $1 AND importer = ANY($2::text[])`, [id.data, scopes]);
      if (!po.rows[0]) return problem(reply, 404, "RESOURCE_NOT_FOUND", "PO não encontrada.");
      const items = await pool.query<Record<string, unknown>>(
        `SELECT item.id, item.line_number AS "lineNumber",
                item.external_line_reference AS "externalLineReference",
                item.product_code AS "productCode", item.description,
                item.ordered_quantity::text AS "orderedQuantity", item.unit,
                item.unit_price::text AS "unitPrice", item.currency_code AS currency,
                item.necessity_date::text AS "necessityDate", item.priority, item.demand,
                item.requester, item.sc_number AS "scNumber", item.sc_approval_date::text AS "scApprovalDate",
                item.purpose, item.product_group AS "productGroup", item.cost_center AS "costCenter",
                item.draft_po AS "draftPo", item.po_approval_date::text AS "poApprovalDate",
                item.po_sent_date::text AS "poSentDate", item.category, item.ncm, item.remarks,
                item.commercial_plan_received_date::text AS "commercialPlanReceivedDate",
                item.mrp_completed_date::text AS "mrpCompletedDate", item.target_mrp_days AS "targetMrpDays",
                item.target_order_days AS "targetOrderDays", item.target_shipment_days AS "targetShipmentDays",
                item.target_port_days AS "targetPortDays", item.target_transit_days AS "targetTransitDays",
                item.target_customs_days AS "targetCustomsDays",
                item.actual_factory_ship_date::text AS "actualFactoryShipDate",
                item.actual_port_departure_date::text AS "actualPortDepartureDate",
                item.source_kind AS "sourceKind",
                coalesce(sum(a.quantity) FILTER (WHERE a.status = 'ACTIVE'), 0)::text AS "allocatedQuantity",
                (item.ordered_quantity - coalesce(sum(a.quantity) FILTER (WHERE a.status = 'ACTIVE'), 0))::text AS "remainingQuantity"
         FROM procurement.purchase_order_item item
         LEFT JOIN procurement.po_item_allocation a ON a.purchase_order_item_id = item.id
         WHERE item.purchase_order_id = $1 GROUP BY item.id ORDER BY item.line_number`, [id.data]);
      const allocations = await pool.query<Record<string, unknown>>(
        `SELECT a.id, a.purchase_order_item_id AS "itemId", a.process_id AS "processId",
                process.ip_number AS "ipNumber", a.quantity::text, a.notes, a.version::text
         FROM procurement.po_item_allocation a
         JOIN procurement.purchase_order_item item ON item.id = a.purchase_order_item_id
         JOIN imports.import_process process ON process.id = a.process_id
         WHERE item.purchase_order_id = $1 AND a.status = 'ACTIVE'
           AND process.importer = ANY($2::text[])
         ORDER BY process.ip_number, a.id`, [id.data, scopes]);
      reply.header("ETag", `"${po.rows[0].version}"`);
      return { ...po.rows[0], items: items.rows, allocations: allocations.rows };
    });

  app.post("/api/v1/purchase-orders", { config: permissionConfig("purchase-orders.write") },
    async (request, reply) => {
      const parsed = createPo.safeParse(request.body);
      if (!parsed.success) return problem(reply, 400, "INVALID_PO", "Revise a PO e seus campos.");
      let key: string; let auth: ReturnType<typeof actorAndScopes>;
      try { key = keyFrom(request); auth = actorAndScopes(request); inScope(parsed.data.importer, auth.scopes); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      const body = parsed.data;
      return transaction(pool, reply, async client => {
        const claim = await receipt(client, auth.actor.userId, key, "PO", body);
        if (claim.existingId) return { id: claim.existingId, replayed: true };
        await knownImporter(client, body.importer);
        const id = randomUUID();
        const result = await client.query<Record<string, unknown>>(
          `INSERT INTO procurement.purchase_order
           (id,importer,external_number,normalized_number,identity_status,source_kind,version,
            supplier_text,order_date,notes)
           VALUES ($1,$2,$3::text,upper($3::text),'MANUAL_UNVERIFIED','MANUAL_TOTVS_REFERENCE',1,$4,$5,$6)
           RETURNING id, importer, external_number AS number, version::text`,
          [id, body.importer, body.number, body.supplierText, body.orderDate, body.notes]);
        await saveReceipt(client, auth.actor.userId, key, claim.hash, "PO", id);
        await record(client, "PURCHASE_ORDER", id, "PURCHASE_ORDER", id, "CREATE", null, body, auth.actor, body.reason);
        return result.rows[0];
      }, 201);
    });

  app.patch<{ Params: { id: string } }>("/api/v1/purchase-orders/:id",
    { config: permissionConfig("purchase-orders.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id); const parsed = poFields.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_PO", "Revise os campos da PO.");
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const before = await lockedPo(client, id.data, auth.scopes);
        checkVersion(before, expected);
        if (before.source_kind !== "MANUAL_TOTVS_REFERENCE"
          && parsed.data.number !== before.external_number) {
          throw new BusinessError(409, "HISTORICAL_IDENTITY", "A identidade da PO histórica exige reconciliação da origem.");
        }
        const result = await client.query<Record<string, unknown>>(
          `UPDATE procurement.purchase_order SET supplier_text = $2, order_date = $3,
            notes = $4, external_number = $5::text, normalized_number = upper($5::text),
            version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING id, version::text`,
          [id.data, parsed.data.supplierText, parsed.data.orderDate, parsed.data.notes, parsed.data.number]);
        await record(client, "PURCHASE_ORDER", id.data, "PURCHASE_ORDER", id.data, "UPDATE",
          before, parsed.data, auth.actor, parsed.data.reason);
        return result.rows[0];
      });
    });

  app.post<{ Params: { id: string } }>("/api/v1/purchase-orders/:id/items",
    { config: permissionConfig("purchase-orders.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id); const parsed = itemFields.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_ITEM", "Revise o item, quantidade e moeda.");
      let key: string; let auth: ReturnType<typeof actorAndScopes>;
      try { key = keyFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const po = await lockedPo(client, id.data, auth.scopes);
        const claim = await receipt(client, auth.actor.userId, key, "PO_ITEM", { poId: id.data, ...parsed.data });
        if (claim.existingId) return { id: claim.existingId, replayed: true };
        const next = await client.query<{ line_number: number }>(
          `SELECT coalesce(max(line_number),0)::int + 1 AS line_number
           FROM procurement.purchase_order_item WHERE purchase_order_id = $1`, [id.data]);
        const itemId = randomUUID(); const body = parsed.data;
        await client.query(
          `INSERT INTO procurement.purchase_order_item
           (id,purchase_order_id,line_number,external_line_reference,product_code,description,
            ordered_quantity,unit,unit_price,currency_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [itemId, id.data, next.rows[0].line_number, body.externalLineReference,
            body.productCode, body.description, body.orderedQuantity, body.unit, body.unitPrice, body.currency]);
        await client.query("UPDATE procurement.purchase_order SET version = version + 1, updated_at = now() WHERE id = $1", [id.data]);
        await saveReceipt(client, auth.actor.userId, key, claim.hash, "PO_ITEM", itemId);
        await record(client, "PURCHASE_ORDER", id.data, "PURCHASE_ORDER_ITEM", itemId, "CREATE",
          null, body, auth.actor, body.reason);
        return { id: itemId, purchaseOrderId: po.id, lineNumber: next.rows[0].line_number };
      }, 201);
    });

  app.patch<{ Params: { id: string; itemId: string } }>("/api/v1/purchase-orders/:id/items/:itemId",
    { config: permissionConfig("purchase-orders.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id); const itemId = uuid.safeParse(request.params.itemId);
      const parsed = itemFields.safeParse(request.body);
      if (!id.success || !itemId.success || !parsed.success) return problem(reply, 400, "INVALID_ITEM", "Revise o item.");
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const po = await lockedPo(client, id.data, auth.scopes); checkVersion(po, expected);
        const found = await client.query<Record<string, unknown>>(
          `SELECT * FROM procurement.purchase_order_item
           WHERE id = $1 AND purchase_order_id = $2 FOR UPDATE`, [itemId.data, id.data]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Item não encontrado nesta PO.");
        const body = parsed.data;
        await client.query(
          `UPDATE procurement.purchase_order_item SET external_line_reference = $2, product_code = $3,
            description = $4, ordered_quantity = $5, unit = $6, unit_price = $7,
            currency_code = $8, updated_at = now() WHERE id = $1`,
          [itemId.data, body.externalLineReference, body.productCode, body.description,
            body.orderedQuantity, body.unit, body.unitPrice, body.currency]);
        const updated = await client.query<{ version: string }>(
          `UPDATE procurement.purchase_order SET version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING version::text`, [id.data]);
        await record(client, "PURCHASE_ORDER", id.data, "PURCHASE_ORDER_ITEM", itemId.data, "UPDATE",
          found.rows[0], body, auth.actor, body.reason);
        return { id: itemId.data, purchaseOrderVersion: updated.rows[0].version };
      });
    });

  app.post("/api/v1/processes", { config: permissionConfig("processes.write") },
    async (request, reply) => {
      const parsed = createProcess.safeParse(request.body);
      if (!parsed.success) return problem(reply, 400, "INVALID_PROCESS", "Revise o IP.");
      let key: string; let auth: ReturnType<typeof actorAndScopes>;
      try { key = keyFrom(request); auth = actorAndScopes(request); inScope(parsed.data.importer, auth.scopes); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      const body = parsed.data;
      return transaction(pool, reply, async client => {
        const claim = await receipt(client, auth.actor.userId, key, "IP", body);
        if (claim.existingId) return { id: claim.existingId, replayed: true };
        await knownImporter(client, body.importer);
        const id = randomUUID();
        await client.query(
          `INSERT INTO imports.import_process
           (id,importer,ip_number,normalized_ip_number,logistics_status,priority,notes,source_kind,version)
           VALUES ($1,$2,$3::text,upper($3::text),$4,$5,$6,'MANUAL',1)`,
          [id, body.importer, body.ipNumber, body.logisticsStatus, body.priority, body.notes]);
        await saveReceipt(client, auth.actor.userId, key, claim.hash, "IP", id);
        await record(client, "IMPORT_PROCESS", id, "IMPORT_PROCESS", id, "CREATE", null, body, auth.actor, body.reason);
        return { id, ipNumber: body.ipNumber, version: "1" };
      }, 201);
    });

  app.post<{ Params: { id: string } }>("/api/v1/processes/:id/close",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      const parsed = closeProcess.safeParse(request.body);
      if (!id.success || !parsed.success) {
        return problem(reply, 400, "INVALID_CLOSURE", "Informe uma justificativa para encerrar o IP.");
      }
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const found = await client.query<Record<string, unknown>>(
          `SELECT * FROM imports.import_process
           WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE`, [id.data, auth.scopes]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "IP não encontrado.");
        checkVersion(found.rows[0], expected);
        if (found.rows[0].lifecycle_status === "CLOSED") {
          throw new BusinessError(409, "PROCESS_ALREADY_CLOSED", "Este IP já está encerrado.");
        }
        const actor = `${auth.actor.issuer}#${auth.actor.subject}`;
        const closed = await client.query<{ version: string; closed_at: Date }>(
          `UPDATE imports.import_process SET lifecycle_status = 'CLOSED', closed_at = now(),
             closed_by = $2, close_reason = $3, version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING version::text, closed_at`,
          [id.data, actor, parsed.data.reason]);
        await record(client, "IMPORT_PROCESS", id.data, "IMPORT_PROCESS", id.data, "CLOSE",
          found.rows[0], { lifecycleStatus: "CLOSED", closedBy: actor, reason: parsed.data.reason },
          auth.actor, parsed.data.reason);
        return { id: id.data, lifecycleStatus: "CLOSED", version: closed.rows[0].version,
          closedAt: closed.rows[0].closed_at };
      });
    });

  app.post<{ Params: { id: string } }>("/api/v1/processes/:id/reopen",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      const parsed = closeProcess.safeParse(request.body);
      if (!id.success || !parsed.success) {
        return problem(reply, 400, "INVALID_REOPEN", "Informe uma justificativa para reabrir o IP.");
      }
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const found = await client.query<Record<string, unknown>>(
          `SELECT * FROM imports.import_process
           WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE`, [id.data, auth.scopes]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "IP não encontrado.");
        checkVersion(found.rows[0], expected);
        if (found.rows[0].lifecycle_status !== "CLOSED") {
          throw new BusinessError(409, "PROCESS_NOT_CLOSED", "Este IP não está encerrado.");
        }
        const reopened = await client.query<{ version: string }>(
          `UPDATE imports.import_process SET lifecycle_status = 'OPEN', closed_at = NULL,
             closed_by = NULL, close_reason = NULL, version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING version::text`, [id.data]);
        await record(client, "IMPORT_PROCESS", id.data, "IMPORT_PROCESS", id.data, "REOPEN",
          found.rows[0], { lifecycleStatus: "OPEN", reason: parsed.data.reason },
          auth.actor, parsed.data.reason);
        return { id: id.data, lifecycleStatus: "OPEN", version: reopened.rows[0].version };
      });
    });

  app.patch<{ Params: { id: string } }>("/api/v1/processes/:id",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id); const parsed = processFields.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_PROCESS", "Revise o IP.");
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const found = await client.query<Record<string, unknown>>(
          `SELECT * FROM imports.import_process WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE`,
          [id.data, auth.scopes]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "IP não encontrado.");
        checkVersion(found.rows[0], expected);
        if (found.rows[0].lifecycle_status === "CLOSED") {
          throw new BusinessError(409, "PROCESS_CLOSED", "Reabra o IP antes de editar seus dados.");
        }
        const body = parsed.data;
        if (found.rows[0].source_kind !== "MANUAL" && body.ipNumber !== found.rows[0].ip_number) {
          throw new BusinessError(409, "HISTORICAL_IDENTITY", "A identidade do IP histórico exige reconciliação da origem.");
        }
        if (["CANCELLED", "CANCELED"].includes(body.logisticsStatus?.toUpperCase() ?? "")) {
          const active = await client.query(
            `SELECT 1 FROM procurement.po_item_allocation
             WHERE process_id = $1 AND status = 'ACTIVE' LIMIT 1`, [id.data]);
          if (active.rowCount) {
            throw new BusinessError(409, "ACTIVE_ALLOCATIONS", "Cancele ou transfira as distribuições antes de cancelar o IP.");
          }
        }
        const updated = await client.query<{ version: string }>(
          `UPDATE imports.import_process SET logistics_status = $2, priority = $3,
            notes = $4, ip_number = $5::text, normalized_ip_number = upper($5::text),
            version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING version::text`,
          [id.data, body.logisticsStatus, body.priority, body.notes, body.ipNumber]);
        await record(client, "IMPORT_PROCESS", id.data, "IMPORT_PROCESS", id.data, "UPDATE",
          found.rows[0], body, auth.actor, body.reason);
        return { id: id.data, version: updated.rows[0].version };
      });
    });

  app.post<{ Params: { id: string } }>("/api/v1/purchase-orders/:id/allocations",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id); const parsed = createAllocation.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_ALLOCATION", "Revise item, IP e quantidade.");
      let key: string; let auth: ReturnType<typeof actorAndScopes>;
      try { key = keyFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      const body = parsed.data;
      return transaction(pool, reply, async client => {
        const po = await lockedPo(client, id.data, auth.scopes);
        const claim = await receipt(client, auth.actor.userId, key, "ALLOCATION", { poId: id.data, ...body });
        if (claim.existingId) return { id: claim.existingId, replayed: true };
        const item = await client.query(
          `SELECT id FROM procurement.purchase_order_item WHERE id = $1 AND purchase_order_id = $2`,
          [body.itemId, id.data]);
        const process = await client.query(
          `SELECT id FROM imports.import_process WHERE id = $1 AND importer = $2
           AND importer = ANY($3::text[])
           AND lifecycle_status = 'OPEN'
           AND upper(coalesce(logistics_status, '')) NOT IN ('CANCELLED', 'CANCELED')
           FOR UPDATE`,
          [body.processId, po.importer, auth.scopes]);
        if (!item.rowCount || !process.rowCount) {
          throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Item ou IP não pertence a esta importadora.");
        }
        const allocationId = randomUUID();
        await client.query(
          `INSERT INTO procurement.po_item_allocation
           (id,purchase_order_item_id,process_id,quantity,notes)
           VALUES ($1,$2,$3,$4,$5)`,
          [allocationId, body.itemId, body.processId, body.quantity, body.notes]);
        await client.query(
          `INSERT INTO procurement.process_purchase_order (purchase_order_id,process_id,source_kind)
           VALUES ($1,$2,'OPERATIONAL') ON CONFLICT DO NOTHING`, [id.data, body.processId]);
        await client.query("UPDATE procurement.purchase_order SET version = version + 1, updated_at = now() WHERE id = $1", [id.data]);
        await saveReceipt(client, auth.actor.userId, key, claim.hash, "ALLOCATION", allocationId);
        await record(client, "PURCHASE_ORDER", id.data, "PO_ITEM_ALLOCATION", allocationId, "CREATE",
          null, body, auth.actor, body.reason);
        return { id: allocationId, version: "1" };
      }, 201);
    });

  app.patch<{ Params: { id: string; allocationId: string } }>(
    "/api/v1/purchase-orders/:id/allocations/:allocationId",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      const allocationId = uuid.safeParse(request.params.allocationId);
      const parsed = allocationFields.safeParse(request.body);
      if (!id.success || !allocationId.success || !parsed.success) {
        return problem(reply, 400, "INVALID_ALLOCATION", "Revise a quantidade.");
      }
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        await lockedPo(client, id.data, auth.scopes);
        const found = await client.query<Record<string, unknown>>(
          `SELECT a.* FROM procurement.po_item_allocation a
           JOIN procurement.purchase_order_item item ON item.id = a.purchase_order_item_id
           JOIN imports.import_process process ON process.id = a.process_id
           WHERE a.id = $1 AND item.purchase_order_id = $2 AND a.status = 'ACTIVE'
             AND process.lifecycle_status = 'OPEN' FOR UPDATE OF a, process`,
          [allocationId.data, id.data]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Distribuição não encontrada ou IP encerrado.");
        checkVersion(found.rows[0], expected);
        const body = parsed.data;
        const updated = await client.query<{ version: string }>(
          `UPDATE procurement.po_item_allocation SET quantity = $2, notes = $3,
            version = version + 1, updated_at = now() WHERE id = $1 RETURNING version::text`,
          [allocationId.data, body.quantity, body.notes]);
        await client.query("UPDATE procurement.purchase_order SET version = version + 1, updated_at = now() WHERE id = $1", [id.data]);
        await record(client, "PURCHASE_ORDER", id.data, "PO_ITEM_ALLOCATION", allocationId.data,
          "UPDATE", found.rows[0], body, auth.actor, body.reason);
        return { id: allocationId.data, version: updated.rows[0].version };
      });
    });

  app.delete<{ Params: { id: string; allocationId: string } }>(
    "/api/v1/purchase-orders/:id/allocations/:allocationId",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      const allocationId = uuid.safeParse(request.params.allocationId);
      const parsed = cancelAllocation.safeParse(request.body);
      if (!id.success || !allocationId.success || !parsed.success) {
        return problem(reply, 400, "INVALID_ALLOCATION", "Informe uma justificativa para cancelar a distribuição.");
      }
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        await lockedPo(client, id.data, auth.scopes);
        const found = await client.query<Record<string, unknown>>(
          `SELECT a.* FROM procurement.po_item_allocation a
           JOIN procurement.purchase_order_item item ON item.id = a.purchase_order_item_id
           JOIN imports.import_process process ON process.id = a.process_id
           WHERE a.id = $1 AND item.purchase_order_id = $2 AND a.status = 'ACTIVE'
             AND process.lifecycle_status = 'OPEN' FOR UPDATE OF a, process`,
          [allocationId.data, id.data]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Distribuição não encontrada ou IP encerrado.");
        checkVersion(found.rows[0], expected);
        await client.query(
          `UPDATE procurement.po_item_allocation SET status = 'CANCELLED',
            version = version + 1, updated_at = now() WHERE id = $1`, [allocationId.data]);
        await client.query(
          `DELETE FROM procurement.process_purchase_order link
           WHERE link.purchase_order_id = $1 AND link.process_id = $2
             AND link.source_kind = 'OPERATIONAL'
             AND NOT EXISTS (
               SELECT 1 FROM procurement.po_item_allocation a
               JOIN procurement.purchase_order_item item ON item.id = a.purchase_order_item_id
               WHERE item.purchase_order_id = $1 AND a.process_id = $2 AND a.status = 'ACTIVE'
             )`, [id.data, found.rows[0].process_id]);
        await client.query("UPDATE procurement.purchase_order SET version = version + 1, updated_at = now() WHERE id = $1", [id.data]);
        await record(client, "PURCHASE_ORDER", id.data, "PO_ITEM_ALLOCATION", allocationId.data,
          "CANCEL", found.rows[0], { status: "CANCELLED" }, auth.actor, parsed.data.reason);
        return { id: allocationId.data, status: "CANCELLED" };
      });
    });
}
