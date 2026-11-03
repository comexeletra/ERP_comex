import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { actorAndScopes, BusinessError, keyFrom, problem, receipt, record, saveReceipt,
  setPurchaseOrderObservationActor } from "./operations.js";
import { currentFinding, ruleByCode } from "./quality-rules.js";

// Registration fixes made from the quality cards, one record or many (docs/PLANO_QUALIDADE_DADOS.md, delivery 3).
// A preview runs the same code and always rolls back; each record is fixed under its own savepoint and only
// fills an empty field. Products and official NCMs are registered through the catalog routes instead.
const actions = ["ITEM_CURRENCY", "ITEM_PRICE", "ITEM_NCM", "PO_SUPPLIER"] as const;
type Action = typeof actions[number];
const ruleOf: Record<Action, string> = {
  ITEM_CURRENCY: "ITEM_PRICE_WITHOUT_CURRENCY", ITEM_PRICE: "ITEM_WITHOUT_PRICE", ITEM_NCM: "ITEM_WITHOUT_NCM",
  PO_SUPPLIER: "PO_WITHOUT_SUPPLIER",
};
const productWriters = ["Master", "Administrador", "Compras"];
const commandType = "QUALITY_FIX";

const fixBody = z.object({
  action: z.enum(actions),
  entityIds: z.array(z.uuid()).min(1).max(500).refine(ids => new Set(ids).size === ids.length),
  value: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/u).optional(),
    unitPrice: z.string().regex(/^[0-9]{1,12}(\.[0-9]{1,6})?$/u).refine(price => Number(price) > 0).optional(),
    ncm: z.string().regex(/^[0-9]{8}$/u).optional(),
    alsoProduct: z.boolean().optional(),
    supplierCode: z.string().trim().min(1).max(120).optional(),
  }).strict().default({}),
  reason: z.string().trim().min(8).max(500),
  preview: z.boolean(),
}).strict().refine(body => body.action !== "ITEM_PRICE" || (body.value.unitPrice && body.value.currency))
  .refine(body => body.action !== "PO_SUPPLIER" || body.value.supplierCode);
type FixBody = z.infer<typeof fixBody>;
type Applied = { entityId: string; before: Record<string, unknown>; after: Record<string, unknown> };
type Skipped = { entityId: string; code: string };
type ItemRow = { id: string; purchase_order_id: string; lifecycle_status: string; product_code: string;
  currency_code: string | null; unit_price: string | null; ncm: string | null; supplier_entry_id: string | null };
type PoRow = { id: string; lifecycle_status: string; supplier_text: string | null; purchase_request_id: string | null };

function isMaster(request: FastifyRequest) { return request.authorizationContext?.roles.includes("Master") ?? false; }

async function lockedItem(client: PoolClient, id: string, scopes: string[], master: boolean) {
  const result = await client.query<ItemRow>(
    `SELECT item.id, item.purchase_order_id, po.lifecycle_status, item.product_code, item.currency_code,
            item.unit_price::text AS unit_price, item.ncm, po.supplier_entry_id
     FROM procurement.purchase_order_item AS item JOIN procurement.purchase_order AS po ON po.id = item.purchase_order_id
     WHERE item.id = $1 AND (po.importer = ANY($2::text[]) OR $3::boolean) FOR UPDATE OF item, po`,
    [id, scopes, master]);
  return result.rows[0];
}

async function lockedPurchaseOrder(client: PoolClient, id: string, scopes: string[], master: boolean) {
  const result = await client.query<PoRow>(
    `SELECT po.id, po.lifecycle_status, po.supplier_text, po.purchase_request_id
     FROM procurement.purchase_order AS po
     WHERE po.id = $1 AND (po.importer = ANY($2::text[]) OR $3::boolean) FOR UPDATE`, [id, scopes, master]);
  return result.rows[0];
}

async function registeredCurrency(client: PoolClient, currency: string) {
  return (await client.query(`SELECT 1 FROM catalog.operational_value
    WHERE entity_key = 'CURRENCY' AND normalized_value = upper($1)`, [currency])).rowCount! > 0;
}

async function registeredNcm(client: PoolClient, ncm: string) {
  return (await client.query(`SELECT 1 FROM catalog.entry
    WHERE kind = 'NCM' AND status = 'ACTIVE' AND normalized_code = $1`, [ncm])).rowCount! > 0;
}

/** The only currency used by the items of this supplier, or null. */
async function suggestedCurrency(client: PoolClient, supplierId: string | null) {
  if (!supplierId) return null;
  const result = await client.query<{ suggestion: string | null }>(
    `SELECT CASE WHEN count(DISTINCT other.currency_code) = 1 THEN min(other.currency_code) END AS suggestion
     FROM procurement.purchase_order_item AS other
     JOIN procurement.purchase_order AS other_po ON other_po.id = other.purchase_order_id
     WHERE other_po.supplier_entry_id = $1 AND other_po.lifecycle_status NOT IN ('CANCELLED', 'DELETED')
       AND nullif(btrim(other.currency_code), '') IS NOT NULL`, [supplierId]);
  return result.rows[0]?.suggestion ?? null;
}

/** The NCM of the product, or the only NCM of the other items with the same product code. */
async function suggestedNcm(client: PoolClient, productCode: string) {
  const result = await client.query<{ suggestion: string | null }>(
    `SELECT coalesce(
       (SELECT nullif(btrim(product.product_ncm_code), '') FROM catalog.entry AS product
        WHERE product.kind = 'PRODUCT' AND product.importer IS NULL AND product.status = 'ACTIVE'
          AND product.normalized_code = upper(btrim($1))),
       (SELECT CASE WHEN count(DISTINCT regexp_replace(other.ncm, '[^0-9]', '', 'g')) = 1
               THEN min(regexp_replace(other.ncm, '[^0-9]', '', 'g')) END
        FROM procurement.purchase_order_item AS other
        WHERE upper(btrim(other.product_code)) = upper(btrim($1)) AND nullif(btrim(other.ncm), '') IS NOT NULL)
     ) AS suggestion`, [productCode]);
  return result.rows[0]?.suggestion ?? null;
}

/** Runs one change under a savepoint; a database refusal skips only this record. */
async function guarded(client: PoolClient, change: () => Promise<void>): Promise<boolean> {
  await client.query("SAVEPOINT quality_fix");
  try {
    await change();
    await client.query("RELEASE SAVEPOINT quality_fix");
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (!code.startsWith("23") && code !== "P0001") throw error;
    await client.query("ROLLBACK TO SAVEPOINT quality_fix");
    return false;
  }
}

async function applyFixes(client: PoolClient, body: FixBody, request: FastifyRequest) {
  const { actor, scopes } = actorAndScopes(request);
  const master = isMaster(request);
  const rule = ruleByCode.get(ruleOf[body.action])!;
  const applied: Applied[] = [];
  const skipped: Skipped[] = [];
  const touchedPos = new Set<string>();
  const filledProducts = new Set<string>();
  await setPurchaseOrderObservationActor(client, actor);
  // A stable lock order keeps two batches over the same POs from deadlocking.
  for (const entityId of [...body.entityIds].sort()) {
    const skip = (code: string) => { skipped.push({ entityId, code }); };
    if (body.action === "PO_SUPPLIER") {
      const po = await lockedPurchaseOrder(client, entityId, scopes, master);
      if (!po || !await currentFinding(client, rule, entityId, scopes, master)) { skip("NOT_VIOLATED"); continue; }
      if (po.lifecycle_status !== "ACTIVE") { skip("PO_NOT_ACTIVE"); continue; }
      if (po.purchase_request_id) { skip("PO_HAS_SC"); continue; }
      const supplier = body.value.supplierCode!;
      const done = await guarded(client, async () => {
        await client.query(`UPDATE procurement.purchase_order SET supplier_text = $2, version = version + 1, updated_at = now()
          WHERE id = $1 AND supplier_entry_id IS NULL AND nullif(btrim(supplier_text), '') IS NULL`, [entityId, supplier]);
        await record(client, "PURCHASE_ORDER", entityId, "PURCHASE_ORDER", entityId, "QUALITY_FIX",
          { supplier: po.supplier_text }, { supplier }, actor, body.reason);
      });
      if (done) applied.push({ entityId, before: { supplier: po.supplier_text }, after: { supplier } });
      else skip("DATABASE_REFUSED");
      continue;
    }
    const item = await lockedItem(client, entityId, scopes, master);
    if (!item || !await currentFinding(client, rule, entityId, scopes, master)) { skip("NOT_VIOLATED"); continue; }
    if (item.lifecycle_status !== "ACTIVE") { skip("PO_NOT_ACTIVE"); continue; }
    let change: { sql: string; values: unknown[]; before: Record<string, unknown>; after: Record<string, unknown> };
    if (body.action === "ITEM_CURRENCY") {
      const currency = body.value.currency ?? await suggestedCurrency(client, item.supplier_entry_id);
      if (!currency || (!body.value.currency && !await registeredCurrency(client, currency))) { skip("NO_SUGGESTION"); continue; }
      change = { sql: `UPDATE procurement.purchase_order_item SET currency_code = $2, updated_at = now()
        WHERE id = $1 AND nullif(btrim(currency_code), '') IS NULL`, values: [entityId, currency],
      before: { currency: item.currency_code }, after: { currency } };
    } else if (body.action === "ITEM_PRICE") {
      // An item that already has a currency keeps it.
      const currency = item.currency_code?.trim() || body.value.currency!;
      change = { sql: `UPDATE procurement.purchase_order_item SET unit_price = $2::numeric, currency_code = $3, updated_at = now()
        WHERE id = $1 AND unit_price IS NULL`, values: [entityId, body.value.unitPrice, currency],
      before: { unitPrice: null, currency: item.currency_code }, after: { unitPrice: body.value.unitPrice, currency } };
    } else {
      const ncm = body.value.ncm ?? await suggestedNcm(client, item.product_code);
      if (!ncm || (!body.value.ncm && !await registeredNcm(client, ncm))) { skip("NO_SUGGESTION"); continue; }
      change = { sql: `UPDATE procurement.purchase_order_item SET ncm = $2, updated_at = now()
        WHERE id = $1 AND nullif(btrim(ncm), '') IS NULL`, values: [entityId, ncm],
      before: { ncm: item.ncm }, after: { ncm } };
    }
    const done = await guarded(client, async () => {
      await client.query(change.sql, change.values);
      await record(client, "PURCHASE_ORDER", item.purchase_order_id, "PURCHASE_ORDER_ITEM", entityId, "QUALITY_FIX",
        change.before, change.after, actor, body.reason);
      const product = item.product_code.trim().toUpperCase();
      if (body.action === "ITEM_NCM" && body.value.alsoProduct && !filledProducts.has(product)) {
        const filled = await client.query<{ id: string }>(`UPDATE catalog.entry
          SET product_ncm_code = $2, version = version + 1, updated_at = now(), updated_by = $3
          WHERE kind = 'PRODUCT' AND importer IS NULL AND normalized_code = upper(btrim($1))
            AND nullif(btrim(product_ncm_code), '') IS NULL RETURNING id`, [item.product_code, change.after.ncm, actor.userId]);
        if (filled.rows[0]) {
          await record(client, "CATALOG_ENTRY", filled.rows[0].id, "CATALOG_ENTRY", filled.rows[0].id, "QUALITY_FIX",
            { ncm: null }, { ncm: change.after.ncm }, actor, body.reason);
        }
        filledProducts.add(product);
      }
    });
    if (!done) { skip("DATABASE_REFUSED"); continue; }
    applied.push({ entityId, before: change.before, after: change.after });
    touchedPos.add(item.purchase_order_id);
  }
  if (touchedPos.size) {
    await client.query(`UPDATE procurement.purchase_order SET version = version + 1, updated_at = now()
      WHERE id = ANY($1::uuid[])`, [[...touchedPos]]);
  }
  return { applied, skipped };
}

function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message);
  throw error;
}

export async function registerQualityFixRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.post("/api/v1/quality/current/fixes", { config: permissionConfig("purchase-orders.write") }, async (request, reply) => {
    const parsed = fixBody.safeParse(request.body);
    if (!parsed.success) {
      return problem(reply, 400, "INVALID_QUALITY_FIX", "Revise a correção, os registros e a justificativa (ao menos 8 caracteres).");
    }
    const body = parsed.data;
    let key: string | null = null;
    let actor: ReturnType<typeof actorAndScopes>["actor"];
    try {
      actor = actorAndScopes(request).actor;
      if (!body.preview) key = keyFrom(request);
    } catch (error) { return failure(reply, error); }
    if (body.action === "ITEM_NCM" && body.value.alsoProduct
      && !(request.authorizationContext?.roles ?? []).some(role => productWriters.includes(role))) {
      return problem(reply, 403, "PERMISSION_DENIED", "Perfil sem permissão para alterar o cadastro do produto.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let command: { hash: string; existingId: string | null } | null = null;
      if (key) {
        command = await receipt(client, actor.userId, key, commandType, body);
        if (command.existingId) {
          await client.query("COMMIT");
          return { preview: false, batchId: command.existingId, replayed: true, applied: [], skipped: [] };
        }
      }
      if (body.value.currency && !await registeredCurrency(client, body.value.currency)) {
        throw new BusinessError(400, "UNKNOWN_CURRENCY", "Moeda fora dos valores cadastrados.");
      }
      if (body.value.ncm && !await registeredNcm(client, body.value.ncm)) {
        throw new BusinessError(400, "NCM_NOT_REGISTERED", "Cadastre a NCM antes de usá-la no item.");
      }
      if (body.value.supplierCode && !(await client.query(`SELECT id FROM catalog.entry
        WHERE kind = 'SUPPLIER' AND importer IS NULL AND status = 'ACTIVE' AND normalized_code = upper(btrim($1))`,
      [body.value.supplierCode])).rowCount) {
        throw new BusinessError(400, "UNKNOWN_SUPPLIER", "Fornecedor fora do cadastro global ativo.");
      }
      const result = await applyFixes(client, body, request);
      if (body.preview || !command || !key) {
        await client.query("ROLLBACK");
        return { preview: true, ...result };
      }
      const batchId = randomUUID();
      await saveReceipt(client, actor.userId, key, command.hash, commandType, batchId);
      await client.query("COMMIT");
      return { preview: false, batchId, ...result };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return failure(reply, error);
    } finally { client.release(); }
  });
}
