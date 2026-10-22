import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { actorAndScopes, BusinessError, checkVersion, keyFrom, problem, receipt, record, saveReceipt,
  syncPurchaseRequestItems, transaction, versionFrom } from "./operations.js";

const uuid = z.uuid();
const date = z.iso.date().nullable();
const reason = z.string().trim().min(3).max(1000);
const querySchema = z.object({ importer: z.string().trim().min(1).max(120).optional() }).strict();
const createSchema = z.object({
  importer: z.string().trim().min(1).max(120),
  scNumber: z.string().trim().min(1).max(80),
  supplierText: z.string().trim().min(1).max(240),
  scDate: date,
  commercialPlanReceivedDate: date,
  requester: z.string().trim().min(1).max(160),
  approvalDate: date,
  reason,
}).strict();
const updateSchema = z.object({
  importer: z.string().trim().min(1).max(120),
  scNumber: z.string().trim().min(1).max(80),
  supplierText: z.string().trim().min(1).max(240),
  scDate: date,
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
      `SELECT sc.id, sc.importer, sc.sc_number AS "scNumber", sc.supplier_entry_id AS "supplierEntryId",
              coalesce((SELECT entry.code FROM catalog.entry entry WHERE entry.id = sc.supplier_entry_id),
                sc.supplier_text) AS "supplierText",
              (SELECT entry.name FROM catalog.entry entry WHERE entry.id = sc.supplier_entry_id) AS "supplierName",
              sc.sc_date::text AS "scDate",
              sc.commercial_plan_received_date::text AS "commercialPlanReceivedDate",
              sc.requester, sc.approval_date::text AS "approvalDate", sc.version::text AS version,
              count(po.id)::int AS "purchaseOrderCount"
       FROM procurement.purchase_request sc
       LEFT JOIN procurement.purchase_order po ON po.purchase_request_id = sc.id
       WHERE sc.importer = ANY($1::text[]) AND ($2::text IS NULL OR sc.importer = $2)
       GROUP BY sc.id
       ORDER BY sc.importer, sc.normalized_sc_number, sc.id`,
      [scopes, parsed.data.importer ?? null]);
    return { items: result.rows };
  });

  app.get<{ Params: { id: string } }>("/api/v1/purchase-requests/:id/history",
    { config: permissionConfig("purchase-requests.read") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      if (!id.success) return problem(reply, 400, "INVALID_ID", "Identificador inválido.");
      const scopes = request.authorizationContext?.importerScopes ?? [];
      const visible = await pool.query(
        `SELECT id FROM procurement.purchase_request WHERE id = $1 AND importer = ANY($2::text[])
         UNION ALL
         SELECT aggregate_id AS id FROM audit.purchase_request_history
         WHERE aggregate_id = $1 AND operation = 'DELETE'
           AND old_value->>'importer' = ANY($2::text[])
         LIMIT 1`,
        [id.data, scopes]);
      if (!visible.rows[0]) return problem(reply, 404, "RESOURCE_NOT_FOUND", "SC não encontrada.");
      const result = await pool.query(
        `SELECT id, operation, old_value AS "oldValue", new_value AS "newValue",
                actor_id AS actor, occurred_at AS "occurredAt", reason
         FROM audit.purchase_request_history WHERE aggregate_id = $1
         ORDER BY occurred_at DESC, id DESC LIMIT 100`, [id.data]);
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
          `SELECT id, importer, sc_number AS "scNumber", supplier_entry_id AS "supplierEntryId",
                  coalesce((SELECT entry.code FROM catalog.entry entry WHERE entry.id = supplier_entry_id),
                    supplier_text) AS "supplierText",
                  (SELECT entry.name FROM catalog.entry entry WHERE entry.id = supplier_entry_id) AS "supplierName",
                  sc_date::text AS "scDate",
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
           (id, importer, sc_number, normalized_sc_number, supplier_text, sc_date, commercial_plan_received_date,
            requester, approval_date, created_by)
         VALUES ($1,$2,$3::varchar,upper(btrim($3::varchar)),$4,$5,$6,$7,$8,$9)
         RETURNING id, importer, sc_number AS "scNumber", supplier_entry_id AS "supplierEntryId",
                   supplier_text AS "supplierText", sc_date::text AS "scDate",
                   commercial_plan_received_date::text AS "commercialPlanReceivedDate",
                   requester, approval_date::text AS "approvalDate", version::text`,
        [id, parsed.data.importer, parsed.data.scNumber, parsed.data.supplierText, parsed.data.scDate,
          parsed.data.commercialPlanReceivedDate, parsed.data.requester, parsed.data.approvalDate,
          `${actor.actor.issuer}#${actor.actor.subject}`]);
      await saveReceipt(client, actor.actor.userId, key, claim.hash, "PURCHASE_REQUEST", id);
      await record(client, "PURCHASE_REQUEST", id, "PURCHASE_REQUEST", id, "CREATE", null,
        parsed.data, actor.actor, parsed.data.reason);
      return inserted.rows[0];
    }, 201);
  });

  app.patch<{ Params: { id: string } }>("/api/v1/purchase-requests/:id",
    { config: permissionConfig("purchase-requests.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      const parsed = updateSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_PURCHASE_REQUEST", "Revise os dados da SC.");
      let expected: string;
      let actor: ReturnType<typeof actorAndScopes>;
      try {
        expected = versionFrom(request);
        actor = actorAndScopes(request);
      } catch (error) {
        if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message);
        throw error;
      }

      return transaction(pool, reply, async client => {
        const found = await client.query<Record<string, unknown>>(
          `SELECT id, importer, sc_number, supplier_entry_id, supplier_text, sc_date::text AS sc_date,
                  commercial_plan_received_date::text AS commercial_plan_received_date,
                  requester, approval_date::text AS approval_date, version::text AS version
           FROM procurement.purchase_request
           WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE`, [id.data, actor.scopes]);
        const before = found.rows[0];
        if (!before) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "SC não encontrada.");
        checkVersion(before, expected);

        const body = parsed.data;
        const after = {
          importer: body.importer,
          scNumber: body.scNumber,
          supplierText: body.supplierText,
          scDate: body.scDate,
          commercialPlanReceivedDate: body.commercialPlanReceivedDate,
          requester: body.requester,
          approvalDate: body.approvalDate,
        };
        const beforeAudit = {
          importer: before.importer,
          scNumber: before.sc_number,
          supplierText: before.supplier_text,
          scDate: before.sc_date == null ? null : String(before.sc_date),
          commercialPlanReceivedDate: before.commercial_plan_received_date == null
            ? null : String(before.commercial_plan_received_date),
          requester: before.requester,
          approvalDate: before.approval_date == null ? null : String(before.approval_date),
        };
        if (body.importer === before.importer
          && body.scNumber === before.sc_number
          && body.supplierText === before.supplier_text
          && body.scDate === beforeAudit.scDate
          && body.commercialPlanReceivedDate === beforeAudit.commercialPlanReceivedDate
          && body.requester === before.requester
          && body.approvalDate === beforeAudit.approvalDate) {
          throw new BusinessError(400, "NO_CHANGES", "Nenhuma alteração informada.");
        }
        if (!actor.scopes.includes(body.importer)) {
          throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Importadora fora do seu escopo.");
        }
        const linkedOrders = await client.query<Record<string, unknown>>(
          `SELECT id, supplier_text, lifecycle_status FROM procurement.purchase_order
           WHERE purchase_request_id = $1 ORDER BY id FOR UPDATE`, [id.data]);
        if (linkedOrders.rows.some(po => po.lifecycle_status !== "ACTIVE")) {
          throw new BusinessError(409, "PO_NOT_ACTIVE", "A SC não pode ser alterada enquanto estiver vinculada a uma PO cancelada, encerrada ou excluída.");
        }
        if (body.importer !== before.importer) {
          const knownImporter = await client.query(
            `SELECT importer FROM procurement.purchase_order WHERE importer = $1
             UNION SELECT importer FROM imports.import_process WHERE importer = $1
             UNION SELECT value AS importer FROM catalog.operational_value
               WHERE entity_key = 'IMPORTER' AND value = $1 LIMIT 1`, [body.importer]);
          if (!knownImporter.rowCount) throw new BusinessError(404, "UNKNOWN_IMPORTER", "Importadora ainda não cadastrada.");
          if (linkedOrders.rowCount) {
            throw new BusinessError(409, "PURCHASE_REQUEST_IN_USE", "Remova os vínculos com POs antes de alterar a importadora da SC.");
          }
        }

        const updated = await client.query(
          `UPDATE procurement.purchase_request
           SET importer = $2, sc_number = $3, normalized_sc_number = upper(btrim($3::varchar)), supplier_text = $4, sc_date = $5,
               commercial_plan_received_date = $6, requester = $7, approval_date = $8,
               version = version + 1, updated_at = now()
           WHERE id = $1
           RETURNING id, importer, sc_number AS "scNumber", supplier_entry_id AS "supplierEntryId",
                     supplier_text AS "supplierText", sc_date::text AS "scDate",
                     commercial_plan_received_date::text AS "commercialPlanReceivedDate",
                     requester, approval_date::text AS "approvalDate", version::text AS version`,
          [id.data, body.importer, body.scNumber, body.supplierText, body.scDate, body.commercialPlanReceivedDate, body.requester, body.approvalDate]);
        for (const po of linkedOrders.rows) {
          if (po.supplier_text === body.supplierText) continue;
          await client.query(
            `UPDATE procurement.purchase_order SET supplier_text = $2, version = version + 1, updated_at = now() WHERE id = $1`,
            [po.id, body.supplierText]);
          await record(client, "PURCHASE_ORDER", String(po.id), "PURCHASE_ORDER", String(po.id), "UPDATE",
            { supplierText: po.supplier_text }, { supplierText: body.supplierText }, actor.actor, body.reason);
        }
        const completedIpSuppliers = await client.query<{ id: string }>(
          `UPDATE imports.import_process process
           SET supplier_text = $2, version = version + 1, updated_at = now()
           WHERE process.supplier_text IS NULL
             AND EXISTS (
               SELECT 1 FROM procurement.po_item_allocation allocation
               JOIN procurement.purchase_order_item item ON item.id = allocation.purchase_order_item_id
               JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
               WHERE allocation.process_id = process.id AND allocation.status = 'ACTIVE'
                 AND po.purchase_request_id = $1
             )
             AND NOT EXISTS (
               SELECT 1 FROM procurement.po_item_allocation allocation
               JOIN procurement.purchase_order_item item ON item.id = allocation.purchase_order_item_id
               JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
               WHERE allocation.process_id = process.id AND allocation.status = 'ACTIVE'
                 AND NOT (
                   upper(btrim(po.supplier_text)) = upper(btrim($2::varchar)) OR EXISTS (
                     SELECT 1 FROM catalog.entry supplier
                     WHERE supplier.importer IS NULL AND supplier.kind = 'SUPPLIER'
                       AND upper(btrim(supplier.code)) = upper(btrim(po.supplier_text))
                       AND upper(btrim(supplier.name)) = upper(btrim($2::varchar))
                   )
                 )
             )
           RETURNING id`, [id.data, body.supplierText]);
        for (const process of completedIpSuppliers.rows) {
          await record(client, "IMPORT_PROCESS", process.id, "IMPORT_PROCESS", process.id, "UPDATE",
            { supplierText: null }, { supplierText: body.supplierText }, actor.actor, body.reason);
        }
        await syncPurchaseRequestItems(client, id.data, beforeAudit, body);
        await record(client, "PURCHASE_REQUEST", id.data, "PURCHASE_REQUEST", id.data, "UPDATE",
          beforeAudit, after, actor.actor, body.reason);
        return updated.rows[0];
      });
    });

  app.delete<{ Params: { id: string } }>("/api/v1/purchase-requests/:id",
    { config: permissionConfig("purchase-requests.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      const parsed = z.object({ reason }).strict().safeParse(request.body);
      if (!id.success || !parsed.success) {
        return problem(reply, 400, "INVALID_PURCHASE_REQUEST", "Informe o motivo da exclusão da SC.");
      }
      let expected: string;
      let actor: ReturnType<typeof actorAndScopes>;
      try {
        expected = versionFrom(request);
        actor = actorAndScopes(request);
      } catch (error) {
        if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message);
        throw error;
      }

      return transaction(pool, reply, async client => {
        const found = await client.query<Record<string, unknown>>(
          `SELECT id, importer, sc_number, supplier_text, sc_date::text AS sc_date,
                  commercial_plan_received_date::text AS commercial_plan_received_date,
                  requester, approval_date::text AS approval_date, version::text AS version
           FROM procurement.purchase_request
           WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE`, [id.data, actor.scopes]);
        const before = found.rows[0];
        if (!before) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "SC não encontrada.");
        checkVersion(before, expected);

        const linkedOrders = await client.query<Record<string, unknown>>(
          `SELECT id, external_number, lifecycle_status
           FROM procurement.purchase_order
           WHERE purchase_request_id = $1 ORDER BY id FOR UPDATE`, [id.data]);
        const blockingOrders = linkedOrders.rows.filter(po => po.lifecycle_status !== "DELETED");
        if (blockingOrders.length) {
          const numbers = blockingOrders.map(po => String(po.external_number)).join(", ");
          throw new BusinessError(409, "PURCHASE_REQUEST_IN_USE",
            `A SC ainda está vinculada às POs não excluídas: ${numbers}.`);
        }

        const beforeAudit = {
          importer: before.importer,
          scNumber: before.sc_number,
          supplierText: before.supplier_text,
          scDate: before.sc_date == null ? null : String(before.sc_date),
          commercialPlanReceivedDate: before.commercial_plan_received_date == null
            ? null : String(before.commercial_plan_received_date),
          requester: before.requester,
          approvalDate: before.approval_date == null ? null : String(before.approval_date),
        };
        const unlinked = await client.query<{ id: string }>(
          `UPDATE procurement.purchase_order
           SET purchase_request_id = NULL, version = version + 1, updated_at = now()
           WHERE purchase_request_id = $1 AND lifecycle_status = 'DELETED'
           RETURNING id`, [id.data]);
        for (const po of unlinked.rows) {
          await record(client, "PURCHASE_ORDER", po.id, "PURCHASE_ORDER", po.id, "UPDATE",
            { purchaseRequestId: id.data }, { purchaseRequestId: null }, actor.actor, parsed.data.reason);
        }

        await client.query("DELETE FROM procurement.purchase_request WHERE id = $1", [id.data]);
        await record(client, "PURCHASE_REQUEST", id.data, "PURCHASE_REQUEST", id.data, "DELETE",
          beforeAudit, null, actor.actor, parsed.data.reason);
      }, 204);
    });
}
