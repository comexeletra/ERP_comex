import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { calculateFollowup, invoiceTotals } from "./followup-calculations.js";
import { actorAndScopes, BusinessError, checkVersion, keyFrom, lockedPo, problem,
  receipt, record, saveReceipt, transaction, versionFrom } from "./operations.js";

type FieldType = "text" | "date" | "integer" | "money" | "boolean";
const itemFields: Record<string, [string, FieldType, number?]> = {
  necessityDate: ["necessity_date", "date"], priority: ["priority", "text", 20],
  demand: ["demand", "text", 160], requester: ["requester", "text", 160],
  scNumber: ["sc_number", "text", 80], scApprovalDate: ["sc_approval_date", "date"],
  purpose: ["purpose", "text", 160], productGroup: ["product_group", "text", 120], costCenter: ["cost_center", "text", 80],
  draftPo: ["draft_po", "text", 80], poApprovalDate: ["po_approval_date", "date"],
  poSentDate: ["po_sent_date", "date"], category: ["category", "text", 120],
  ncm: ["ncm", "text", 16], remarks: ["remarks", "text", 4000],
  commercialPlanReceivedDate: ["commercial_plan_received_date", "date"],
  mrpCompletedDate: ["mrp_completed_date", "date"],
  targetMrpDays: ["target_mrp_days", "integer"], targetOrderDays: ["target_order_days", "integer"],
  targetShipmentDays: ["target_shipment_days", "integer"], targetPortDays: ["target_port_days", "integer"],
  targetTransitDays: ["target_transit_days", "integer"], targetCustomsDays: ["target_customs_days", "integer"],
  actualFactoryShipDate: ["actual_factory_ship_date", "date"],
  actualPortDepartureDate: ["actual_port_departure_date", "date"],
};
const processFields: Record<string, [string, FieldType, number?]> = {
  logisticsStatus: ["logistics_status", "text", 40],
  priority: ["priority", "text", 20], ipTotvsDate: ["ip_totvs_date", "date"],
  transportMode: ["transport_mode", "text", 40],
  incoterm: ["incoterm", "text", 20], broker: ["broker", "text", 160],
  portLoading: ["port_loading", "text", 160], portDischarge: ["port_discharge", "text", 160],
  etd: ["etd", "date"], etaConfirmed: ["eta_confirmed", "date"],
  arrivalDate: ["arrival_date", "date"], duimpNumber: ["duimp_number", "text", 100],
  duimpDate: ["duimp_date", "date"], customsChannel: ["customs_channel", "text", 80],
  clearanceDate: ["clearance_date", "date"], eteConfirmed: ["ete_confirmed", "date"],
  nfRequestDate: ["nf_request_date", "date"], deliveryDate: ["delivery_date", "date"],
  freightCurrency: ["freight_currency", "text", 3], freightCost: ["freight_cost", "money"],
  containerNumber: ["container_number", "text", 120], containerType: ["container_type", "text", 80],
  containerQuantity: ["container_quantity", "integer"], forwarder: ["forwarder", "text", 160],
  documentsOk: ["documents_ok", "boolean"], storageDueOverride: ["storage_due_override", "date"],
  taxesPaidBrl: ["taxes_paid_brl", "money"], fineBrl: ["fine_brl", "money"],
  storageBrl: ["storage_brl", "money"], demurrageBrl: ["demurrage_brl", "money"],
  demurrageContainerQuantity: ["demurrage_container_quantity", "integer"],
};
const dateSchema = z.iso.date();
const moneySchema = z.string().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,8})?$/);
function validateFields(value: unknown, definition: Record<string, [string, FieldType, number?]>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length) return null;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of entries) {
    const field = definition[key];
    if (!field) return null;
    if (raw === null) { result[key] = null; continue; }
    if (field[1] === "text" && typeof raw === "string" && raw.trim().length <= (field[2] ?? 0)) {
      result[key] = raw.trim() || null; continue;
    }
    if (field[1] === "date" && dateSchema.safeParse(raw).success) { result[key] = String(raw); continue; }
    if (field[1] === "integer" && typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 100000) {
      result[key] = raw; continue;
    }
    if (field[1] === "money" && moneySchema.safeParse(raw).success) { result[key] = String(raw); continue; }
    if (field[1] === "boolean" && typeof raw === "boolean") { result[key] = raw; continue; }
    return null;
  }
  if (result.freightCurrency != null && !/^[A-Z]{3}$/.test(String(result.freightCurrency))) return null;
  return result;
}
function camel(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    value instanceof Date ? value.toISOString().slice(0, 10) : value,
  ]));
}
function context(request: FastifyRequest, ifMatch = false, idempotency = false) {
  return { ...actorAndScopes(request), version: ifMatch ? versionFrom(request) : null,
    key: idempotency ? keyFrom(request) : null };
}
const reason = z.string().trim().min(3).max(1000);
const documentBase = z.object({
  kind: z.enum(["INVOICE", "BL", "NF"]), number: z.string().trim().min(1).max(120),
  purchaseOrderItemId: z.uuid().nullable(), issueDate: dateSchema.nullable(),
  homologationDate: dateSchema.nullable(), quantity: moneySchema.nullable(),
  unitPrice: moneySchema.nullable(), amount: moneySchema.nullable(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  notes: z.string().max(4000), reason,
}).strict();
const docSchema = documentBase.refine(data => ((data.unitPrice !== null || data.amount !== null) === (data.currencyCode !== null)))
  .refine(data => data.quantity === null || !/^0(?:\.0+)?$/.test(data.quantity))
  .refine(data => data.kind === "INVOICE" || (data.quantity === null && data.unitPrice === null && data.amount === null && data.currencyCode === null))
  .refine(data => data.kind === "NF" || data.homologationDate === null);
const docPatch = documentBase.omit({ kind: true, purchaseOrderItemId: true })
  .refine(data => ((data.unitPrice !== null || data.amount !== null) === (data.currencyCode !== null)))
  .refine(data => data.quantity === null || !/^0(?:\.0+)?$/.test(data.quantity));

export async function registerFollowupRoutes(app: FastifyInstance, pool: Pool) {
  app.get<{ Params: { id: string } }>("/api/v1/purchase-orders/:id/followup",
    { config: permissionConfig("purchase-orders.read") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id);
      if (!id.success) return problem(reply, 400, "INVALID_ID", "PO inválida.");
      const scopes = request.authorizationContext?.importerScopes ?? [];
      const po = await pool.query(`SELECT id, importer, external_number AS number, version::text
        FROM procurement.purchase_order WHERE id=$1 AND importer=ANY($2::text[])`, [id.data, scopes]);
      if (!po.rows[0]) return problem(reply, 404, "RESOURCE_NOT_FOUND", "PO não encontrada.");
      const items = await pool.query(`SELECT * FROM procurement.purchase_order_item WHERE purchase_order_id=$1 ORDER BY line_number`, [id.data]);
      const links = await pool.query(`SELECT a.id AS allocation_id, a.purchase_order_item_id AS item_id,
        a.quantity::text AS allocation_quantity, p.* FROM procurement.po_item_allocation a
        JOIN procurement.purchase_order_item i ON i.id=a.purchase_order_item_id
        JOIN imports.import_process p ON p.id=a.process_id
        WHERE i.purchase_order_id=$1 AND a.status='ACTIVE' AND p.importer=ANY($2::text[])
        ORDER BY p.ip_number,i.line_number`, [id.data, scopes]);
      const linked = await pool.query(`SELECT p.* FROM imports.import_process p WHERE p.importer=ANY($2::text[])
        AND p.importer=$3
        AND p.id IN (SELECT process_id FROM procurement.process_purchase_order WHERE purchase_order_id=$1
          UNION SELECT a.process_id FROM procurement.po_item_allocation a
            JOIN procurement.purchase_order_item i ON i.id=a.purchase_order_item_id
            WHERE i.purchase_order_id=$1 AND a.status='ACTIVE') ORDER BY p.ip_number`,
        [id.data, scopes, po.rows[0].importer]);
      const processIds = linked.rows.map(row => row.id as string);
      const docs = processIds.length ? await pool.query(`SELECT d.* FROM imports.process_document d
        WHERE d.process_id=ANY($1::uuid[]) AND d.status='ACTIVE' ORDER BY d.kind,d.number,d.id`, [processIds]) : { rows: [] };
      const allocationProcessRows = await pool.query(`SELECT DISTINCT p.id, p.ip_number
        FROM procurement.po_item_allocation a
        JOIN procurement.purchase_order_item i ON i.id=a.purchase_order_item_id
        JOIN imports.import_process p ON p.id=a.process_id
        WHERE i.purchase_order_id=$1 AND p.importer=ANY($2::text[])`, [id.data, scopes]);
      const eventProcessIds = [...new Set([...processIds, ...allocationProcessRows.rows.map(row => row.id as string)])];
      const poEvents = await pool.query(`SELECT event.id, event.entity_type, event.entity_id, event.operation,
          event.old_value, event.new_value, event.actor_id, event.occurred_at, event.reason,
          allocation_process.ip_number AS related_ip_number,
          coalesce(allocation_item.product_code, item.product_code) AS related_product_code
        FROM audit.purchase_order_operational_history event
        LEFT JOIN procurement.po_item_allocation allocation
          ON event.entity_type='PO_ITEM_ALLOCATION' AND allocation.id=event.entity_id
        LEFT JOIN procurement.purchase_order_item allocation_item ON allocation_item.id=allocation.purchase_order_item_id
        LEFT JOIN imports.import_process allocation_process ON allocation_process.id=allocation.process_id
        LEFT JOIN procurement.purchase_order_item item
          ON event.entity_type='PURCHASE_ORDER_ITEM' AND item.id=event.entity_id
        WHERE event.aggregate_id=$1
        ORDER BY event.occurred_at DESC, event.id DESC`, [id.data]);
      const processEvents = eventProcessIds.length ? await pool.query(`SELECT id, aggregate_id, entity_type, entity_id,
          operation, old_value, new_value, actor_id, occurred_at, reason
        FROM audit.import_process_operational_history WHERE aggregate_id=ANY($1::uuid[])
        ORDER BY occurred_at DESC, id DESC`, [eventProcessIds]) : { rows: [] };
      const processNames = new Map([...linked.rows, ...allocationProcessRows.rows]
        .map(row => [row.id as string, row.ip_number as string]));
      const events = [
        ...poEvents.rows.map(row => ({ id: row.id, entityType: row.entity_type, entityId: row.entity_id,
          operation: row.operation, oldValue: row.old_value, newValue: row.new_value, actorId: row.actor_id,
          occurredAt: row.occurred_at, reason: row.reason,
          aggregateType: "PURCHASE_ORDER", aggregateLabel: po.rows[0].number,
          relatedLabel: row.related_ip_number && row.related_product_code
            ? `IP ${row.related_ip_number} · ${row.related_product_code}`
            : row.related_product_code ? `Item ${row.related_product_code}` : null })),
        ...processEvents.rows.map(row => ({ id: row.id, entityType: row.entity_type, entityId: row.entity_id,
          operation: row.operation, oldValue: row.old_value, newValue: row.new_value, actorId: row.actor_id,
          occurredAt: row.occurred_at, reason: row.reason, aggregateType: "IMPORT_PROCESS",
          aggregateLabel: processNames.get(row.aggregate_id as string) ?? "IP", relatedLabel: null })),
      ].sort((left, right) => new Date(right.occurredAt as string | Date).getTime() - new Date(left.occurredAt as string | Date).getTime());
      const itemRows = items.rows.map(camel);
      const processes = linked.rows.map(row => {
        const process = camel(row);
        const documents = docs.rows.filter(doc => doc.process_id === row.id).map(camel);
        return { process, documents, invoiceTotals: invoiceTotals(documents) };
      });
      const shipments = links.rows.map(row => {
        const process = camel(row);
        const item = itemRows.find(entry => entry.id === process.itemId)!;
        const documents = docs.rows.filter(doc => doc.process_id === row.id).map(camel);
        return { allocationId: process.allocationId, allocationQuantity: process.allocationQuantity,
          itemId: process.itemId, process,
          calculated: calculateFollowup({ ...item, allocationQuantity: process.allocationQuantity }, process, documents) };
      });
      reply.header("ETag", `"${po.rows[0].version}"`);
      return { ...po.rows[0], items: itemRows, processes, shipments, events };
    });

  app.patch<{ Params: { id: string; itemId: string } }>("/api/v1/purchase-orders/:id/items/:itemId/followup",
    { config: permissionConfig("purchase-orders.write") }, async (request, reply) => {
      const poId = z.uuid().safeParse(request.params.id); const itemId = z.uuid().safeParse(request.params.itemId);
      const body = request.body as { fields?: unknown; reason?: unknown } | null;
      const fields = validateFields(body?.fields, itemFields); const why = reason.safeParse(body?.reason);
      if (!poId.success || !itemId.success || !fields || !why.success) return problem(reply, 400, "INVALID_FOLLOWUP", "Revise os campos do item.");
      let auth: ReturnType<typeof context>;
      try { auth = context(request, true); } catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const po = await lockedPo(client, poId.data, auth.scopes); checkVersion(po, auth.version!);
        const found = await client.query(`SELECT * FROM procurement.purchase_order_item WHERE id=$1 AND purchase_order_id=$2 FOR UPDATE`, [itemId.data, poId.data]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Item não encontrado nesta PO.");
        const keys = Object.keys(fields); const sql = keys.map((key, index) => `${itemFields[key][0]}=$${index + 2}`).join(",");
        await client.query(`UPDATE procurement.purchase_order_item SET ${sql},updated_at=now() WHERE id=$1`,
          [itemId.data, ...keys.map(key => fields[key])]);
        const changed = await client.query(`UPDATE procurement.purchase_order SET version=version+1,updated_at=now() WHERE id=$1 RETURNING version::text`, [poId.data]);
        await record(client, "PURCHASE_ORDER", poId.data, "PURCHASE_ORDER_ITEM", itemId.data, "FOLLOWUP_UPDATE",
          found.rows[0], fields, auth.actor, why.data);
        return { id: itemId.data, purchaseOrderVersion: changed.rows[0].version };
      });
    });

  app.patch<{ Params: { id: string } }>("/api/v1/processes/:id/followup",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id); const body = request.body as { fields?: unknown; reason?: unknown } | null;
      const fields = validateFields(body?.fields, processFields); const why = reason.safeParse(body?.reason);
      if (!id.success || !fields || !why.success) return problem(reply, 400, "INVALID_FOLLOWUP", "Revise os campos do IP.");
      let auth: ReturnType<typeof context>;
      try { auth = context(request, true); } catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const found = await client.query(`SELECT * FROM imports.import_process WHERE id=$1 AND importer=ANY($2::text[]) FOR UPDATE`, [id.data, auth.scopes]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "IP não encontrado.");
        checkVersion(found.rows[0], auth.version!);
        const keys = Object.keys(fields); const sql = keys.map((key, index) => `${processFields[key][0]}=$${index + 2}`).join(",");
        const changed = await client.query(`UPDATE imports.import_process SET ${sql},version=version+1,updated_at=now() WHERE id=$1 RETURNING version::text`,
          [id.data, ...keys.map(key => fields[key])]);
        await record(client, "IMPORT_PROCESS", id.data, "IMPORT_PROCESS", id.data, "FOLLOWUP_UPDATE", found.rows[0], fields, auth.actor, why.data);
        return { id: id.data, version: changed.rows[0].version };
      });
    });

  app.post<{ Params: { id: string } }>("/api/v1/processes/:id/documents",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id); const body = docSchema.safeParse(request.body);
      if (!id.success || !body.success) return problem(reply, 400, "INVALID_DOCUMENT", "Revise o documento.");
      let auth: ReturnType<typeof context>;
      try { auth = context(request, false, true); } catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const process = await client.query(`SELECT * FROM imports.import_process WHERE id=$1 AND importer=ANY($2::text[]) FOR UPDATE`, [id.data, auth.scopes]);
        if (!process.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "IP não encontrado.");
        const claim = await receipt(client, auth.actor.userId, auth.key!, "PROCESS_DOCUMENT", { processId: id.data, ...body.data });
        if (claim.existingId) return { id: claim.existingId, replayed: true };
        const d = body.data; const docId = randomUUID();
        await client.query(`INSERT INTO imports.process_document
          (id,process_id,purchase_order_item_id,kind,number,issue_date,homologation_date,quantity,unit_price,amount,currency_code,notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [docId, id.data, d.purchaseOrderItemId, d.kind, d.number, d.issueDate, d.homologationDate,
            d.quantity, d.unitPrice, d.amount, d.currencyCode, d.notes]);
        await client.query(`UPDATE imports.import_process SET version=version+1,updated_at=now() WHERE id=$1`, [id.data]);
        await saveReceipt(client, auth.actor.userId, auth.key!, claim.hash, "PROCESS_DOCUMENT", docId);
        await record(client, "IMPORT_PROCESS", id.data, "PROCESS_DOCUMENT", docId, "CREATE", null, d, auth.actor, d.reason);
        return { id: docId, version: "1" };
      }, 201);
    });

  app.patch<{ Params: { id: string; docId: string } }>("/api/v1/processes/:id/documents/:docId",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id); const docId = z.uuid().safeParse(request.params.docId);
      const body = docPatch.safeParse(request.body);
      if (!id.success || !docId.success || !body.success) return problem(reply, 400, "INVALID_DOCUMENT", "Revise o documento.");
      let auth: ReturnType<typeof context>;
      try { auth = context(request, true); } catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const found = await client.query(`SELECT d.* FROM imports.process_document d JOIN imports.import_process p ON p.id=d.process_id
          WHERE d.id=$1 AND d.process_id=$2 AND d.status='ACTIVE' AND p.importer=ANY($3::text[]) FOR UPDATE OF d`, [docId.data, id.data, auth.scopes]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Documento não encontrado.");
        checkVersion(found.rows[0], auth.version!);
        const d = body.data;
        if (found.rows[0].kind !== "INVOICE" && (d.quantity !== null || d.unitPrice !== null || d.amount !== null || d.currencyCode !== null))
          throw new BusinessError(400, "INVALID_DOCUMENT", "Somente Invoice aceita quantidade e preço.");
        if (found.rows[0].kind !== "NF" && d.homologationDate !== null)
          throw new BusinessError(400, "INVALID_DOCUMENT", "Homologação é própria da NF.");
        const changed = await client.query(`UPDATE imports.process_document SET number=$2,issue_date=$3,homologation_date=$4,
          quantity=$5,unit_price=$6,amount=$7,currency_code=$8,notes=$9,version=version+1,updated_at=now()
          WHERE id=$1 RETURNING version::text`, [docId.data, d.number, d.issueDate, d.homologationDate,
            d.quantity, d.unitPrice, d.amount, d.currencyCode, d.notes]);
        await client.query(`UPDATE imports.import_process SET version=version+1,updated_at=now() WHERE id=$1`, [id.data]);
        await record(client, "IMPORT_PROCESS", id.data, "PROCESS_DOCUMENT", docId.data, "UPDATE", found.rows[0], d, auth.actor, d.reason);
        return { id: docId.data, version: changed.rows[0].version };
      });
    });

  app.delete<{ Params: { id: string; docId: string } }>("/api/v1/processes/:id/documents/:docId",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id); const docId = z.uuid().safeParse(request.params.docId);
      const why = z.object({ reason }).strict().safeParse(request.body);
      if (!id.success || !docId.success || !why.success) return problem(reply, 400, "INVALID_DOCUMENT", "Informe a justificativa.");
      let auth: ReturnType<typeof context>;
      try { auth = context(request, true); } catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const found = await client.query(`SELECT d.* FROM imports.process_document d JOIN imports.import_process p ON p.id=d.process_id
          WHERE d.id=$1 AND d.process_id=$2 AND d.status='ACTIVE' AND p.importer=ANY($3::text[]) FOR UPDATE OF d`, [docId.data, id.data, auth.scopes]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Documento não encontrado.");
        checkVersion(found.rows[0], auth.version!);
        await client.query(`UPDATE imports.process_document SET status='CANCELLED',version=version+1,updated_at=now() WHERE id=$1`, [docId.data]);
        await client.query(`UPDATE imports.import_process SET version=version+1,updated_at=now() WHERE id=$1`, [id.data]);
        await record(client, "IMPORT_PROCESS", id.data, "PROCESS_DOCUMENT", docId.data, "CANCEL", found.rows[0], { status: "CANCELLED" }, auth.actor, why.data.reason);
        return { id: docId.data, status: "CANCELLED" };
      });
    });
}
