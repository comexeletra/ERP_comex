import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient, Pool } from "pg";
import { z } from "zod";
import { importerScopePredicate, permissionConfig } from "./authorization.js";
import { actorAndScopes, BusinessError, keyFrom, problem, receipt, record, saveReceipt, transaction } from "./operations.js";

// Data quality rules over the current records (docs/PLANO_QUALIDADE_DADOS.md, delivery 2). They run on
// read and never write; a waiver (M077) hides a finding while the checked values keep the same hash.
export type QualityRuleGroup = "REGISTRATION" | "DATES" | "LINKS";
export type QualityEntityType = "PURCHASE_ORDER" | "PURCHASE_ORDER_ITEM" | "IMPORT_PROCESS" | "PURCHASE_REQUEST";
export type QualityRule = { code: string; group: QualityRuleGroup; entityType: QualityEntityType; sql: string };

// Each rule returns entity_id, importer, labels (what identifies the record), checked (the values the
// rule looked at, hashed for waivers) and links (ids for the screens).
const livePo = "po.lifecycle_status NOT IN ('CANCELLED', 'DELETED')";
const liveItems = `procurement.purchase_order_item AS item
  JOIN procurement.purchase_order AS po ON po.id = item.purchase_order_id
  WHERE ${livePo} AND coalesce(item.source_status, '') <> 'CANCELLED'`;
const liveProcesses = "imports.import_process AS ip WHERE ip.deleted_at IS NULL AND ip.record_status = 'ACTIVE'";

function itemRule(code: string, group: QualityRuleGroup, checked: string, condition: string): QualityRule {
  return { code, group, entityType: "PURCHASE_ORDER_ITEM", sql: `SELECT item.id AS entity_id, po.importer AS importer,
    jsonb_build_object('purchaseOrder', po.external_number, 'line', item.line_number, 'productCode', item.product_code,
      'description', item.description, 'supplier', po.supplier_text) AS labels,
    ${checked} AS checked, jsonb_build_object('purchaseOrderId', po.id) AS links
    FROM ${liveItems} AND (${condition})` };
}

function processRule(code: string, group: QualityRuleGroup, checked: string, condition: string): QualityRule {
  return { code, group, entityType: "IMPORT_PROCESS", sql: `SELECT ip.id AS entity_id, ip.importer AS importer,
    jsonb_build_object('ipNumber', ip.ip_number, 'supplier', ip.supplier_text) AS labels,
    ${checked} AS checked, jsonb_build_object('processId', ip.id) AS links
    FROM ${liveProcesses} AND (${condition})` };
}

const linkedPoSuppliers = `FROM procurement.process_purchase_order AS link
  JOIN procurement.purchase_order AS po ON po.id = link.purchase_order_id
  WHERE link.process_id = ip.id AND ${livePo} AND po.supplier_entry_id IS NOT NULL`;

export const qualityRules: readonly QualityRule[] = [
  itemRule("ITEM_WITHOUT_NCM", "REGISTRATION", "jsonb_build_object('ncm', item.ncm)",
    "nullif(btrim(item.ncm), '') IS NULL"),
  itemRule("ITEM_NCM_NOT_REGISTERED", "REGISTRATION", "jsonb_build_object('ncm', item.ncm)",
    `nullif(btrim(item.ncm), '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM catalog.entry AS ncm
      WHERE ncm.kind = 'NCM' AND ncm.status = 'ACTIVE' AND ncm.normalized_code = regexp_replace(item.ncm, '[^0-9]', '', 'g'))`),
  itemRule("ITEM_PRODUCT_NOT_REGISTERED", "REGISTRATION", "jsonb_build_object('productCode', item.product_code)",
    `NOT EXISTS (SELECT 1 FROM catalog.entry AS product
      WHERE product.kind = 'PRODUCT' AND product.importer IS NULL AND product.status = 'ACTIVE'
      AND product.normalized_code = upper(btrim(item.product_code)))`),
  itemRule("ITEM_PRICE_WITHOUT_CURRENCY", "REGISTRATION",
    "jsonb_build_object('unitPrice', item.unit_price::text, 'currency', item.currency_code)",
    "item.unit_price IS NOT NULL AND nullif(btrim(item.currency_code), '') IS NULL"),
  itemRule("ITEM_WITHOUT_PRICE", "REGISTRATION", "jsonb_build_object('unitPrice', item.unit_price::text)",
    "item.unit_price IS NULL"),
  { code: "PO_WITHOUT_SUPPLIER", group: "REGISTRATION", entityType: "PURCHASE_ORDER", sql: `SELECT po.id AS entity_id,
    po.importer AS importer, jsonb_build_object('purchaseOrder', po.external_number) AS labels,
    jsonb_build_object('supplier', po.supplier_text, 'supplierId', po.supplier_entry_id) AS checked,
    jsonb_build_object('purchaseOrderId', po.id) AS links
    FROM procurement.purchase_order AS po
    WHERE ${livePo} AND po.supplier_entry_id IS NULL AND nullif(btrim(po.supplier_text), '') IS NULL` },
  itemRule("ITEM_PO_APPROVED_BEFORE_SC", "DATES",
    "jsonb_build_object('poApprovalDate', item.po_approval_date, 'scApprovalDate', item.sc_approval_date, 'scNumber', item.sc_number)",
    "item.po_approval_date < item.sc_approval_date"),
  processRule("IP_CLEARED_BEFORE_ARRIVAL", "DATES",
    "jsonb_build_object('clearanceDate', ip.clearance_date, 'arrivalDate', ip.arrival_date)",
    "ip.clearance_date < ip.arrival_date"),
  processRule("IP_WITHOUT_PO", "LINKS", "jsonb_build_object('linkedPurchaseOrders', 0)",
    "NOT EXISTS (SELECT 1 FROM procurement.process_purchase_order AS link WHERE link.process_id = ip.id)"),
  itemRule("ITEM_SHIPPED_WITHOUT_IP", "LINKS", "jsonb_build_object('sourceStatus', item.source_status)",
    `item.source_status IN ('WAITING SHIPMENT', 'WAITING ARRIVAL', 'CUSTOMS CLEARANCE', 'DELIVERED')
      AND NOT EXISTS (SELECT 1 FROM procurement.po_item_allocation AS allocation
        WHERE allocation.purchase_order_item_id = item.id AND allocation.status = 'ACTIVE')`),
  processRule("IP_PO_SUPPLIER_MISMATCH", "LINKS",
    `jsonb_build_object('ipSupplierId', ip.supplier_entry_id,
      'poSuppliers', (SELECT jsonb_agg(DISTINCT po.supplier_text ORDER BY po.supplier_text) ${linkedPoSuppliers}))`,
    `ip.supplier_entry_id IS NOT NULL AND EXISTS (SELECT 1 ${linkedPoSuppliers}
      AND po.supplier_entry_id <> ip.supplier_entry_id)`),
  { code: "SC_MULTIPLE_SUPPLIERS", group: "LINKS", entityType: "PURCHASE_REQUEST", sql: `SELECT sc.id AS entity_id,
    sc.importer AS importer, jsonb_build_object('scNumber', sc.sc_number) AS labels,
    jsonb_build_object('suppliers', (SELECT jsonb_agg(DISTINCT po.supplier_text ORDER BY po.supplier_text)
      FROM procurement.purchase_order AS po WHERE po.purchase_request_id = sc.id AND ${livePo}
        AND po.supplier_entry_id IS NOT NULL)) AS checked,
    '{}'::jsonb AS links
    FROM procurement.purchase_request AS sc
    WHERE (SELECT count(DISTINCT po.supplier_entry_id) FROM procurement.purchase_order AS po
      WHERE po.purchase_request_id = sc.id AND ${livePo} AND po.supplier_entry_id IS NOT NULL) > 1` },
];

const ruleCodes = qualityRules.map(rule => rule.code) as [string, ...string[]];
export const ruleByCode = new Map(qualityRules.map(rule => [rule.code, rule]));
const valuesHash = "encode(sha256(convert_to(found.checked::text, 'UTF8')), 'hex')";

const listQuery = z.object({
  rule: z.enum(ruleCodes).optional(),
  group: z.enum(["REGISTRATION", "DATES", "LINKS"]).optional(),
  search: z.string().trim().max(80).optional(),
  includeWaived: z.enum(["true", "false"]).default("false"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const reason = z.string().trim().min(8).max(2000);
const waiverBody = z.object({ rule: z.enum(ruleCodes), entityId: z.uuid(), reason }).strict();
const revokeBody = z.object({ reason }).strict();
const waiverCommand = "QUALITY_RULE_WAIVER";
const waiverColumns = `id, rule_code AS rule, entity_type AS "entityType", entity_id AS "entityId", importer, status,
  reason, version::text AS version, created_by AS "createdBy", created_at AS "createdAt", revoked_by AS "revokedBy",
  revoked_at AS "revokedAt", revoke_reason AS "revokeReason"`;

function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message);
  throw error;
}
function isMaster(request: FastifyRequest) { return request.authorizationContext?.roles.includes("Master") ?? false; }
function author(actor: { issuer: string; subject: string }) { return `${actor.issuer}#${actor.subject}`; }

/** Rows of every rule, labelled with the rule, its group and the entity type. */
export function qualityFindingsSql(rules: readonly QualityRule[] = qualityRules): string {
  return rules.map(rule => `SELECT '${rule.code}'::text AS rule, '${rule.group}'::text AS rule_group,
    '${rule.entityType}'::text AS entity_type, found.* FROM (${rule.sql}) AS found`).join("\nUNION ALL\n");
}

/** Re-runs one rule for one record inside a write transaction. */
export async function currentFinding(client: PoolClient, rule: QualityRule, entityId: string, scopes: string[], master: boolean) {
  const scope = master ? { sql: "TRUE", values: [] } : importerScopePredicate("found.importer", 2, scopes);
  const result = await client.query<{ entity_id: string; importer: string | null; checked: Record<string, unknown>;
    values_sha256: string }>(
    `SELECT found.entity_id, found.importer, found.checked, ${valuesHash} AS values_sha256
     FROM (${rule.sql}) AS found WHERE found.entity_id = $1 AND (${scope.sql})`, [entityId, ...scope.values]);
  return result.rows[0];
}

export async function registerQualityRuleRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/quality/current", { config: permissionConfig("quality.read") }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Os filtros ou a paginação são inválidos.");
    const { rule, group, search, includeWaived, page, pageSize } = parsed.data;
    const scope = isMaster(request) ? { sql: "TRUE", values: [] }
      : importerScopePredicate("finding.importer", 1, request.authorizationContext?.importerScopes ?? []);
    const at = (offset: number) => `$${scope.values.length + offset}`;
    const order = "rule_group, rule, labels->>'purchaseOrder', labels->>'ipNumber', labels->>'scNumber', (labels->>'line')::int, entity_id";
    const result = await pool.query<{ total_count: number; counts_by_rule: unknown[] | null; items: unknown[] | null }>(
      `WITH findings AS MATERIALIZED (
         ${qualityFindingsSql()}
       ), scoped AS MATERIALIZED (
         SELECT finding.*, encode(sha256(convert_to(finding.checked::text, 'UTF8')), 'hex') AS values_sha256
         FROM findings AS finding
         WHERE (${scope.sql})
           AND (${at(1)}::text IS NULL OR strpos(lower(finding.labels::text || finding.checked::text), lower(${at(1)})) > 0)
       ), marked AS MATERIALIZED (
         SELECT scoped.*, waiver.id AS waiver_id, waiver.reason AS waiver_reason, waiver.created_by AS waiver_by,
                waiver.created_at AS waiver_at
         FROM scoped
         LEFT JOIN migration.quality_rule_waiver AS waiver
           ON waiver.status = 'ACTIVE' AND waiver.rule_code = scoped.rule AND waiver.entity_id = scoped.entity_id
          AND waiver.values_sha256 = scoped.values_sha256
       ), filtered AS MATERIALIZED (
         SELECT * FROM marked
         WHERE (${at(2)}::text IS NULL OR rule = ${at(2)}) AND (${at(3)}::text IS NULL OR rule_group = ${at(3)})
           AND (${at(4)}::boolean OR waiver_id IS NULL)
       ), page AS (
         SELECT filtered.*, row_number() OVER (ORDER BY ${order}) AS position
         FROM filtered ORDER BY ${order} LIMIT ${at(5)} OFFSET ${at(6)}
       )
       SELECT (SELECT count(*)::int FROM filtered) AS total_count,
              (SELECT jsonb_agg(jsonb_build_object('rule', counted.rule, 'group', counted.rule_group,
                 'open', counted.open, 'waived', counted.waived) ORDER BY counted.rule_group, counted.rule)
               FROM (SELECT rule, rule_group, count(*) FILTER (WHERE waiver_id IS NULL)::int AS open,
                       count(*) FILTER (WHERE waiver_id IS NOT NULL)::int AS waived
                     FROM marked GROUP BY rule, rule_group) AS counted) AS counts_by_rule,
              (SELECT jsonb_agg(jsonb_build_object('rule', page.rule, 'group', page.rule_group,
                 'entityType', page.entity_type, 'entityId', page.entity_id, 'importer', page.importer,
                 'labels', page.labels, 'values', page.checked, 'links', jsonb_strip_nulls(page.links),
                 'waiver', CASE WHEN page.waiver_id IS NULL THEN NULL ELSE jsonb_build_object('id', page.waiver_id,
                   'reason', page.waiver_reason, 'createdBy', page.waiver_by, 'createdAt', page.waiver_at) END)
                 ORDER BY page.position) FROM page) AS items`,
      [...scope.values, search || null, rule ?? null, group ?? null, includeWaived === "true", pageSize,
        (page - 1) * pageSize]);
    reply.header("cache-control", "no-store");
    return { page, pageSize, totalCount: Number(result.rows[0]?.total_count ?? 0),
      countsByRule: result.rows[0]?.counts_by_rule ?? [], items: result.rows[0]?.items ?? [] };
  });

  app.post("/api/v1/quality/current/waivers", { config: permissionConfig("quality.resolve") }, async (request, reply) => {
    const parsed = waiverBody.safeParse(request.body);
    if (!parsed.success) {
      return problem(reply, 400, "INVALID_QUALITY_WAIVER", "Informe a regra, o registro e a justificativa (ao menos 8 caracteres).");
    }
    let auth: ReturnType<typeof actorAndScopes>; let key: string;
    try { auth = actorAndScopes(request); key = keyFrom(request); } catch (error) { return failure(reply, error); }
    const { actor, scopes } = auth;
    const master = isMaster(request);
    const rule = ruleByCode.get(parsed.data.rule)!;
    return transaction(pool, reply, async client => {
      const command = await receipt(client, actor.userId, key, waiverCommand, parsed.data);
      if (command.existingId) {
        const previous = await client.query(`SELECT ${waiverColumns} FROM migration.quality_rule_waiver WHERE id = $1`,
          [command.existingId]);
        return previous.rows[0];
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`quality-waiver:${rule.code}:${parsed.data.entityId}`]);
      const finding = await currentFinding(client, rule, parsed.data.entityId, scopes, master);
      if (!finding) {
        throw new BusinessError(409, "QUALITY_RULE_NOT_VIOLATED",
          "O registro não está mais em erro nesta regra ou não está no seu escopo. Recarregue a lista.");
      }
      const active = await client.query<{ id: string; values_sha256: string }>(
        `SELECT id, values_sha256 FROM migration.quality_rule_waiver
         WHERE rule_code = $1 AND entity_id = $2 AND status = 'ACTIVE' FOR UPDATE`, [rule.code, parsed.data.entityId]);
      const previous = active.rows[0];
      if (previous?.values_sha256 === finding.values_sha256) {
        throw new BusinessError(409, "QUALITY_RULE_ALREADY_WAIVED", "Este registro já foi dispensado com os mesmos valores.");
      }
      if (previous) {
        const why = "Os valores conferidos mudaram desde a dispensa anterior.";
        await client.query(`UPDATE migration.quality_rule_waiver
          SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoke_reason = $3, version = version + 1
          WHERE id = $1`, [previous.id, author(actor), why]);
        await record(client, rule.entityType, parsed.data.entityId, "QUALITY_RULE_WAIVER", previous.id, "REVOKE",
          { status: "ACTIVE" }, { status: "REVOKED" }, actor, why);
      }
      const inserted = await client.query(`INSERT INTO migration.quality_rule_waiver
          (id, rule_code, entity_type, entity_id, importer, checked_values, values_sha256, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9) RETURNING ${waiverColumns}`,
      [randomUUID(), rule.code, rule.entityType, parsed.data.entityId, finding.importer, JSON.stringify(finding.checked),
        finding.values_sha256, parsed.data.reason, author(actor)]);
      const waiver = inserted.rows[0] as { id: string };
      await record(client, rule.entityType, parsed.data.entityId, "QUALITY_RULE_WAIVER", waiver.id, "CREATE", null,
        { rule: rule.code, checked: finding.checked }, actor, parsed.data.reason);
      await saveReceipt(client, actor.userId, key, command.hash, waiverCommand, waiver.id);
      return waiver;
    }, 201);
  });

  app.post<{ Params: { id: string } }>("/api/v1/quality/current/waivers/:id/revoke",
    { config: permissionConfig("quality.resolve") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id), parsed = revokeBody.safeParse(request.body);
      if (!id.success || !parsed.success) {
        return problem(reply, 400, "INVALID_QUALITY_WAIVER", "Informe a dispensa e o motivo (ao menos 8 caracteres).");
      }
      let auth: ReturnType<typeof actorAndScopes>;
      try { auth = actorAndScopes(request); } catch (error) { return failure(reply, error); }
      const { actor, scopes } = auth;
      const master = isMaster(request);
      return transaction(pool, reply, async client => {
        const current = await client.query<{ id: string; status: string; importer: string | null; rule_code: string;
          entity_type: string; entity_id: string }>(
          `SELECT id, status, importer, rule_code, entity_type, entity_id FROM migration.quality_rule_waiver
           WHERE id = $1 FOR UPDATE`, [id.data]);
        const waiver = current.rows[0];
        if (!waiver || (!master && !scopes.includes(waiver.importer ?? ""))) {
          throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Dispensa não encontrada.");
        }
        if (waiver.status !== "ACTIVE") throw new BusinessError(409, "QUALITY_WAIVER_REVOKED", "Esta dispensa já foi desfeita.");
        const updated = await client.query(`UPDATE migration.quality_rule_waiver
          SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoke_reason = $3, version = version + 1
          WHERE id = $1 RETURNING ${waiverColumns}`, [waiver.id, author(actor), parsed.data.reason]);
        await record(client, waiver.entity_type, waiver.entity_id, "QUALITY_RULE_WAIVER", waiver.id, "REVOKE",
          { status: "ACTIVE" }, { status: "REVOKED" }, actor, parsed.data.reason);
        return updated.rows[0];
      });
    });
}
