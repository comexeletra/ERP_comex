import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { todayInBrasilia } from "./followup-calculations.js";
import { decimalQuantity, E2E_CALCULATION_CONCURRENCY, scaledQuantity, shipmentLineStatuses,
  shipmentStatusSql } from "./shipment-lines.js";
import { createWorkGate, WorkCancelledError, type WorkGate } from "./work-gate.js";

type Status = (typeof shipmentLineStatuses)[number];

/**
 * Ranges of the BI "Aging days since PO" chart, in days since the PO was sent to the supplier. The upper bound
 * belongs to the range: 45 days is "≤ 45", 46 is "45–60". `max: null` is the open last range.
 */
export const PRE_SHIPMENT_AGING_RANGES = [
  { key: "upTo45", max: 45 }, { key: "days45To60", max: 60 }, { key: "days60To90", max: 90 },
  { key: "days90To120", max: 120 }, { key: "days120Plus", max: null },
] as const;
export type PreShipmentAgingRange = (typeof PRE_SHIPMENT_AGING_RANGES)[number]["key"];
const agingKeys = PRE_SHIPMENT_AGING_RANGES.map(range => range.key) as [PreShipmentAgingRange, ...PreShipmentAgingRange[]];

/** Lines still waiting for the factory or the shipment: the only ones the aging chart counts. */
export const PRE_SHIPMENT_AGING_STATUSES = ["A DISTRIBUIR", "AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE"] as const satisfies readonly Status[];

/** Purposes of the BI "Direct" filter (user decision of 2026-11-05). */
export const PRE_SHIPMENT_DIRECT_PURPOSES = ["Estoque Insumos (Componente)", "Estoque Insumos (Policarbonato)"] as const;

/** Range of an elapsed number of days, or null without a PO sent date (BLANK() in the BI). */
export function agingRange(days: number | null): PreShipmentAgingRange | null {
  if (days === null) return null;
  return PRE_SHIPMENT_AGING_RANGES.find(range => range.max === null || days <= range.max)!.key;
}

/** SQL condition: the aging days of the dashboard line fall in one of the ranges (bounds from the constant above). */
function agingRangeSql(ranges: readonly PreShipmentAgingRange[]): string {
  const conditions = ranges.map(key => {
    const index = agingKeys.indexOf(key);
    const lower = index > 0 ? PRE_SHIPMENT_AGING_RANGES[index - 1].max : null;
    const upper = PRE_SHIPMENT_AGING_RANGES[index].max;
    return [lower === null ? null : `aging_days > ${lower}`, upper === null ? null : `aging_days <= ${upper}`]
      .filter(Boolean).join(" AND ") || "TRUE";
  });
  const waiting = PRE_SHIPMENT_AGING_STATUSES.map(status => `'${status}'`).join(", ");
  return `(line_status IN (${waiting}) AND aging_days IS NOT NULL AND ((${conditions.join(") OR (")})))`;
}

const optionalText = (max: number) => z.string().trim().max(max).optional().transform(value => value || undefined);
/** One or more values: a key repeated in the query string (a string when it has one value); empty ones dropped. */
const valueList = <T extends string>(value: z.ZodType<T>) => z.preprocess(input => {
  const list = typeof input === "string" ? [input] : input;
  return Array.isArray(list) ? list.filter(item => item !== "") : list;
}, z.array(value).max(500).transform(list => [...new Set(list.filter(item => item !== ""))])).optional();
const textList = (max: number) => valueList(z.string().trim().max(max));

/** Filters of the dashboard: the same for the summary and the table. */
export const preShipmentQuery = z.object({
  status: valueList(z.enum(shipmentLineStatuses)), aging: valueList(z.enum(agingKeys)),
  priority: z.enum(["priority", "normal"]).optional(), direct: z.enum(["direct", "notDirect"]).optional(),
  demand: textList(200), requester: textList(200), group: textList(120), supplier: textList(240), purpose: textList(160),
  importers: textList(120), modes: textList(40),
  scNumber: optionalText(80), ipNumber: optionalText(80), purchaseOrder: optionalText(80), productCode: optionalText(200),
  productDescription: optionalText(200),
  necessityFrom: z.iso.date().optional(), necessityTo: z.iso.date().optional(),
});
export type PreShipmentFilters = z.infer<typeof preShipmentQuery>;

const linesQuery = preShipmentQuery.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

/**
 * Dashboard lines: one per active allocation plus the balance without IP, as the product lines, and also the
 * cancelled ones (user decision of 2026-11-05): every line of a cancelled PO and the balance of an item cancelled
 * in TOTVS are CANCELADO. Deleted POs stay out. The filters other than the chart selections are applied here.
 * Returns the CTE and its parameters; `$1` is the importer scope and `$2` today in Brasília.
 */
function dashboardSql(scopes: readonly string[], filters: PreShipmentFilters, today: string) {
  const params: unknown[] = [scopes, today];
  const param = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const where: string[] = [];
  const anyOf = (column: string, values: readonly string[] | undefined) => {
    if (values?.length) where.push(`lower(btrim(coalesce(${column}, ''))) IN (SELECT lower(value) FROM unnest(${param(values)}::text[]) AS value)`);
  };
  const contains = (column: string, value: string | undefined) => {
    if (value) where.push(`strpos(lower(coalesce(${column}, '')), lower(${param(value)})) > 0`);
  };
  anyOf("item.demand", filters.demand);
  anyOf("item.requester", filters.requester);
  anyOf("to_jsonb(item)->>'item_group'", filters.group);
  anyOf("coalesce(supplier.name, po.supplier_text)", filters.supplier);
  anyOf("item.purpose", filters.purpose);
  anyOf("po.importer", filters.importers);
  anyOf("p.transport_mode", filters.modes);
  contains("item.sc_number", filters.scNumber);
  contains("p.ip_number", filters.ipNumber);
  contains("po.external_number", filters.purchaseOrder);
  contains("item.product_code", filters.productCode);
  contains("item.description", filters.productDescription);
  if (filters.priority === "priority") where.push("nullif(btrim(item.priority), '') IS NOT NULL");
  if (filters.priority === "normal") where.push("nullif(btrim(item.priority), '') IS NULL");
  if (filters.direct) {
    const direct = `lower(btrim(coalesce(item.purpose, ''))) IN (SELECT lower(value) FROM unnest(${param([...PRE_SHIPMENT_DIRECT_PURPOSES])}::text[]) AS value)`;
    where.push(filters.direct === "direct" ? direct : `NOT ${direct}`);
  }
  if (filters.necessityFrom) where.push(`item.necessity_date >= ${param(filters.necessityFrom)}::date`);
  if (filters.necessityTo) where.push(`item.necessity_date <= ${param(filters.necessityTo)}::date`);

  const sql = `WITH balance AS (
    SELECT item.id AS item_id,
           item.ordered_quantity - coalesce(sum(a.quantity) FILTER (WHERE a.status = 'ACTIVE'), 0) AS remaining
    FROM procurement.purchase_order_item AS item
    LEFT JOIN procurement.po_item_allocation AS a ON a.purchase_order_item_id = item.id
    GROUP BY item.id
  ), lines AS (
    SELECT a.id AS line_id, 'ALLOCATION'::text AS line_kind, a.purchase_order_item_id AS item_id,
           a.process_id, a.quantity AS line_quantity
    FROM procurement.po_item_allocation AS a WHERE a.status = 'ACTIVE'
    UNION ALL
    SELECT b.item_id, 'BALANCE', b.item_id, NULL::uuid, b.remaining
    FROM balance AS b WHERE b.remaining > 0
  ), dashboard AS MATERIALIZED (
    SELECT l.line_id, l.line_kind, l.line_quantity, item.line_number, item.necessity_date, po.id AS po_id,
      po.normalized_number, p.ip_number AS sort_ip_number,
      CASE WHEN po.lifecycle_status = 'CANCELLED' THEN 'CANCELADO'
        WHEN l.line_kind = 'BALANCE' AND upper(coalesce(item.source_status, '')) IN ('CANCELLED', 'CANCELED') THEN 'CANCELADO'
        WHEN l.line_kind = 'BALANCE' THEN 'A DISTRIBUIR'
        ELSE ${shipmentStatusSql("p", "l.item_id")} END AS line_status,
      CASE WHEN item.po_sent_date IS NULL THEN NULL ELSE $2::date - item.po_sent_date END AS aging_days,
      jsonb_build_object('lineId', l.line_id, 'lineKind', l.line_kind, 'quantity', l.line_quantity::text, 'unit', item.unit,
        'necessityDate', item.necessity_date, 'mode', p.transport_mode, 'requester', item.requester,
        'scNumber', item.sc_number, 'purchaseOrder', jsonb_build_object('id', po.id, 'number', po.external_number),
        'process', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id', p.id, 'ipNumber', p.ip_number) END,
        'etd', p.etd,
        'eta', CASE WHEN p.id IS NULL THEN NULL ELSE coalesce(p.eta_confirmed,
          CASE WHEN nullif(btrim(p.transport_mode), '') IS NULL THEN NULL
            WHEN upper(btrim(p.transport_mode)) IN ('SEA', 'MARITIMO', 'MARÍTIMO') THEN p.etd + 55
            ELSE p.etd + 10 END) END,
        'ete', p.ete_confirmed, 'productCode', item.product_code, 'description', item.description,
        'supplier', coalesce(supplier.name, po.supplier_text), 'importer', po.importer, 'purpose', item.purpose,
        'poSentDate', item.po_sent_date, 'priority', nullif(btrim(item.priority), ''), 'demand', item.demand,
        'group', to_jsonb(item)->>'item_group') AS line
    FROM lines AS l
    JOIN procurement.purchase_order_item AS item ON item.id = l.item_id
    JOIN procurement.purchase_order AS po ON po.id = item.purchase_order_id
    LEFT JOIN catalog.entry AS supplier ON supplier.id = po.supplier_entry_id
    LEFT JOIN imports.import_process AS p ON p.id = l.process_id
    WHERE po.importer = ANY($1::text[])
      AND (l.line_kind = 'ALLOCATION' AND po.lifecycle_status IN ('ACTIVE', 'CLOSED', 'CANCELLED')
        OR l.line_kind = 'BALANCE' AND po.lifecycle_status IN ('ACTIVE', 'CANCELLED'))${where.map(condition => `
      AND ${condition}`).join("")}
  )`;
  return { sql, params, param };
}

/** A line of the dashboard table, as GET /lines returns it (and the pre-shipment export writes it). */
export type PreShipmentLine = {
  lineId: string; lineKind: "ALLOCATION" | "BALANCE"; status: string; quantity: string; unit: string | null;
  necessityDate: string | null; mode: string | null; requester: string | null; scNumber: string | null;
  purchaseOrder: { id: string; number: string | null }; process: { id: string; ipNumber: string | null } | null;
  etd: string | null; eta: string | null; ete: string | null; productCode: string | null; description: string | null;
  supplier: string | null; importer: string | null; purpose: string | null; poSentDate: string | null;
  priority: string | null; demand: string | null; group: string | null;
};

type SummaryRow = { line_status: string; aging_days: number | null; products: number; quantity: string | null };
type Part = { products: number; quantity: string };

function totals<Key extends string>(keys: readonly Key[], rows: readonly SummaryRow[], keyOf: (row: SummaryRow) => Key | null) {
  const parts = new Map(keys.map(key => [key, { products: 0, quantity: 0n }]));
  for (const row of rows) {
    const part = parts.get(keyOf(row) as Key);
    if (!part) continue;
    part.products += Number(row.products);
    part.quantity += scaledQuantity(row.quantity ?? "0");
  }
  return Object.fromEntries(keys.map(key => {
    const part = parts.get(key)!;
    return [key, { products: part.products, quantity: decimalQuantity(part.quantity) }];
  })) as Record<Key, Part>;
}

const isAgingStatus = (status: string) => (PRE_SHIPMENT_AGING_STATUSES as readonly string[]).includes(status);
const rowRange = (row: SummaryRow) => isAgingStatus(row.line_status)
  ? agingRange(row.aging_days === null ? null : Number(row.aging_days)) : null;

/**
 * Products (lines) and exact quantities by status and by aging range. The charts cross-filter as in the End to
 * End: the status cards and donuts ignore the status selection and follow the aging one, the aging chart the
 * opposite; the total follows both.
 */
export function summarizePreShipment(rows: readonly SummaryRow[], { status, aging }: Pick<PreShipmentFilters, "status" | "aging">) {
  const ofStatus = (row: SummaryRow) => !status?.length || (status as string[]).includes(row.line_status);
  const ofAging = (row: SummaryRow) => {
    if (!aging?.length) return true;
    const range = rowRange(row);
    return range !== null && aging.includes(range);
  };
  const selected = rows.filter(row => ofStatus(row) && ofAging(row));
  const all = totals(["all"], selected, () => "all").all;
  const waiting = rows.filter(row => ofStatus(row) && isAgingStatus(row.line_status));
  return {
    totalProducts: all.products, totalQuantity: all.quantity,
    byStatus: totals(shipmentLineStatuses, rows.filter(ofAging), row => row.line_status as Status),
    aging: totals(agingKeys, waiting, rowRange),
    agingWithoutSentDate: totals(["none"], waiting.filter(row => row.aging_days === null), () => "none").none,
  };
}

export async function queryPreShipmentSummary(pool: Pool, scopes: readonly string[], filters: PreShipmentFilters,
  today = todayInBrasilia()) {
  const { sql, params } = dashboardSql(scopes, filters, today);
  const result = await pool.query<SummaryRow>(`${sql}
  SELECT line_status, aging_days, count(*)::int AS products, sum(line_quantity)::text AS quantity
  FROM dashboard GROUP BY line_status, aging_days`, params);
  return summarizePreShipment(result.rows, filters);
}

export async function queryPreShipmentLines(pool: Pool, scopes: readonly string[], filters: PreShipmentFilters,
  limit: number, offset: number, today = todayInBrasilia()) {
  const { sql, params, param } = dashboardSql(scopes, filters, today);
  const selection: string[] = [];
  if (filters.status?.length) selection.push(`line_status = ANY(${param(filters.status)}::text[])`);
  if (filters.aging?.length) selection.push(agingRangeSql(filters.aging));
  const order = "necessity_date NULLS LAST, normalized_number, po_id, line_number, line_kind, sort_ip_number NULLS LAST, line_id";
  const result = await pool.query<{ total_count: number; lines: PreShipmentLine[] }>(`${sql}, filtered AS MATERIALIZED (
    SELECT * FROM dashboard${selection.length ? ` WHERE ${selection.join(" AND ")}` : ""}
  ), page AS (
    SELECT * FROM filtered ORDER BY ${order} LIMIT ${param(limit)} OFFSET ${param(offset)}
  )
  SELECT (SELECT count(*)::int FROM filtered) AS total_count,
    coalesce((SELECT jsonb_agg(line || jsonb_build_object('status', line_status) ORDER BY ${order}) FROM page), '[]'::jsonb)
      AS lines`, params);
  return { totalCount: Number(result.rows[0]?.total_count ?? 0), lines: result.rows[0]?.lines ?? [] };
}

const filterOptionsSql = `WITH scoped AS (
    SELECT item.id AS item_id, item.demand, item.requester, to_jsonb(item)->>'item_group' AS item_group, item.purpose,
      coalesce(supplier.name, po.supplier_text) AS supplier, po.importer
    FROM procurement.purchase_order_item AS item
    JOIN procurement.purchase_order AS po ON po.id = item.purchase_order_id
    LEFT JOIN catalog.entry AS supplier ON supplier.id = po.supplier_entry_id
    WHERE po.importer = ANY($1::text[]) AND po.lifecycle_status IN ('ACTIVE', 'CLOSED', 'CANCELLED')
  )
  SELECT
    coalesce(array_agg(DISTINCT btrim(demand)) FILTER (WHERE nullif(btrim(demand), '') IS NOT NULL), '{}') AS option_demands,
    coalesce(array_agg(DISTINCT btrim(requester)) FILTER (WHERE nullif(btrim(requester), '') IS NOT NULL), '{}') AS option_requesters,
    coalesce(array_agg(DISTINCT btrim(item_group)) FILTER (WHERE nullif(btrim(item_group), '') IS NOT NULL), '{}') AS option_groups,
    coalesce(array_agg(DISTINCT btrim(supplier)) FILTER (WHERE nullif(btrim(supplier), '') IS NOT NULL), '{}') AS option_suppliers,
    coalesce(array_agg(DISTINCT btrim(purpose)) FILTER (WHERE nullif(btrim(purpose), '') IS NOT NULL), '{}') AS option_purposes,
    coalesce(array_agg(DISTINCT importer), '{}') AS option_importers,
    (SELECT coalesce(array_agg(DISTINCT upper(btrim(p.transport_mode))) FILTER (WHERE nullif(btrim(p.transport_mode), '') IS NOT NULL), '{}')
      FROM procurement.po_item_allocation AS a JOIN imports.import_process AS p ON p.id = a.process_id
      WHERE a.status = 'ACTIVE' AND a.purchase_order_item_id IN (SELECT item_id FROM scoped)) AS option_modes
  FROM scoped`;

type OptionRow = Record<"option_demands" | "option_requesters" | "option_groups" | "option_suppliers" | "option_purposes"
  | "option_importers" | "option_modes", string[] | null>;

const sorted = (values: string[] | null | undefined) =>
  [...(values ?? [])].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

export async function queryPreShipmentFilterOptions(pool: Pool, scopes: readonly string[]) {
  const row = (await pool.query<OptionRow>(filterOptionsSql, [scopes])).rows[0];
  return { demands: sorted(row?.option_demands), requesters: sorted(row?.option_requesters), groups: sorted(row?.option_groups),
    suppliers: sorted(row?.option_suppliers), purposes: sorted(row?.option_purposes), importers: sorted(row?.option_importers),
    modes: sorted(row?.option_modes) };
}

function invalidQuery(request: FastifyRequest, reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ type: "about:blank", title: "Parâmetros inválidos", status: 400,
    detail: "Revise os filtros e a paginação.", instance: request.url.split("?", 1)[0], traceId: request.id,
    code: "INVALID_QUERY", errors: error.flatten().fieldErrors });
}

function cancelled(request: FastifyRequest, reply: FastifyReply) {
  return reply.code(503).send({ type: "about:blank", title: "Requisição cancelada", status: 503,
    detail: "A tela fez uma consulta mais nova antes desta ser processada.", instance: request.url.split("?", 1)[0],
    traceId: request.id, code: "REQUEST_CANCELLED" });
}

/** Aborts when the connection closes before the reply was sent: the screen already replaced the request. */
function clientGone(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.once("close", () => { if (!reply.raw.writableFinished) controller.abort(); });
  return controller.signal;
}

/**
 * Pre-shipment dashboard (the BI "Pré Embarque" metrics). The summary and the table recalculate every line of the
 * filters, so they wait in the same gate as the End to End calculations (server.ts shares it).
 */
export async function registerPreShipmentDashboardRoutes(app: FastifyInstance, pool: Pool,
  gate: WorkGate = createWorkGate(E2E_CALCULATION_CONCURRENCY)): Promise<void> {
  const scopesOf = (request: FastifyRequest) => request.authorizationContext?.importerScopes ?? [];

  app.get("/api/v1/reports/pre-shipment/summary", { config: permissionConfig("purchase-orders.read") }, async (request, reply) => {
    const parsed = preShipmentQuery.strict().safeParse(request.query);
    if (!parsed.success) return invalidQuery(request, reply, parsed.error);
    let result;
    try {
      result = await gate.run(() => queryPreShipmentSummary(pool, scopesOf(request), parsed.data), clientGone(reply));
    } catch (error) {
      if (error instanceof WorkCancelledError) return cancelled(request, reply);
      throw error;
    }
    reply.header("Cache-Control", "no-store");
    return result;
  });

  app.get("/api/v1/reports/pre-shipment/lines", { config: permissionConfig("purchase-orders.read") }, async (request, reply) => {
    const parsed = linesQuery.safeParse(request.query);
    if (!parsed.success) return invalidQuery(request, reply, parsed.error);
    const { page, pageSize, ...filters } = parsed.data;
    let result;
    try {
      result = await gate.run(() => queryPreShipmentLines(pool, scopesOf(request), filters, pageSize, (page - 1) * pageSize),
        clientGone(reply));
    } catch (error) {
      if (error instanceof WorkCancelledError) return cancelled(request, reply);
      throw error;
    }
    reply.header("Cache-Control", "no-store");
    return { page, pageSize, ...result };
  });

  app.get("/api/v1/reports/pre-shipment/filter-options", { config: permissionConfig("purchase-orders.read") },
    async (request, reply) => {
      const result = await queryPreShipmentFilterOptions(pool, scopesOf(request));
      reply.header("Cache-Control", "no-store");
      return result;
    });
}
