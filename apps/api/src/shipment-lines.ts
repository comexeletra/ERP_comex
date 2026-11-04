import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { loadE2eTargetSets } from "./e2e-targets.js";
import { calculateE2e, calculateFollowup, E2E_DELAY_RANGES, E2E_STAGE_CODES, e2eDeadlineStatus, e2eDelayRange,
  e2eTargetSetFor, todayInBrasilia, type E2eDeadlineStatus, type E2eDelayRange, type E2eStageCode } from "./followup-calculations.js";

type Row = Record<string, unknown>;

/** Status of a product line: its IP shipment status, or A DISTRIBUIR for the balance without IP. */
export const shipmentLineStatuses = ["A DISTRIBUIR", "AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE",
  "AGUARDANDO CHEGADA", "DESEMBARAÇO", "ENTREGUE", "CANCELADO"] as const;

export type ShipmentLineFilters = {
  /** Parts of the importer, PO number, IP number and product code or description (the product lines screen). */
  importer?: string; purchaseOrder?: string; ipNumber?: string; product?: string;
  /** Any of the statuses. */
  status?: (typeof shipmentLineStatuses)[number][]; etaFrom?: string; etaTo?: string; situation: "open" | "all";
  /**
   * Any of the values (exact, ignoring case and outer spaces): group and purpose of the PO product, importers,
   * PO numbers, IP numbers and product codes (the End to End screen); and the necessity period.
   */
  group?: string[]; purpose?: string[]; importers?: string[]; purchaseOrders?: string[]; ipNumbers?: string[];
  productCodes?: string[]; necessityFrom?: string; necessityTo?: string;
  /** E2E stage: the lines now in it (`current`) or those that already have its actual date (`reached`). */
  stage?: E2eStageCode; view?: "current" | "reached"; late?: "true";
  /** Total End to End delay status (Power BI in_time_late) of the line. */
  deadline?: E2eDeadlineStatus;
  /** Range of the total End to End delay (Power BI "Faixa de atraso total") of the line. */
  delayRange?: E2eDelayRange;
  /** Demand type and transport mode of the End to End scenario; lines without them pass only when unset. */
  demandType?: "mts" | "notMts"; modal?: "sea" | "air";
};

// IP columns repeated on every product line. Costs stay on the IP: repeating them per
// product would duplicate the shipment totals.
const processLineColumns = ["id", "ip_number", "importer", "record_status", "lifecycle_status", "logistics_status",
  "priority", "ip_totvs_date", "transport_mode", "incoterm", "broker", "port_loading", "port_discharge", "etd",
  "actual_port_departure_date", "bl_number", "bl_date", "eta_confirmed", "arrival_date", "duimp_number", "duimp_date",
  "customs_channel", "clearance_date", "ete_confirmed", "nf_request_date", "delivery_date", "container_number",
  "container_type", "forwarder", "documents_ok_date", "storage_due_override"];

const camelKey = (key: string) => key.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase());

function processView(process: unknown): Row | null {
  if (!process || typeof process !== "object") return null;
  const source = process as Row;
  return Object.fromEntries(processLineColumns.filter(column => column in source)
    .map(column => [camelKey(column), source[column]]));
}

/** Statuses an IP can have; product lines add A DISTRIBUIR for the balance without IP. */
export const processStatuses = shipmentLineStatuses.filter(status => status !== "A DISTRIBUIR");

/**
 * SQL for the status calculated from the IP dates. It mirrors shipmentStatus() in
 * followup-calculations.ts so filters select what the API labels; the HML integration
 * test checks the parity. `itemColumn` limits invoices to those of one PO item.
 */
export function shipmentStatusSql(process: string, itemColumn: string | null): string {
  const identifier = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/u;
  if (!identifier.test(process) || (itemColumn !== null && !identifier.test(itemColumn))) {
    throw new Error("Identificador SQL inválido para o status do IP.");
  }
  const itemInvoices = itemColumn
    ? ` AND (document.purchase_order_item_id IS NULL OR document.purchase_order_item_id = ${itemColumn})` : "";
  return `CASE WHEN upper(btrim(coalesce(${process}.logistics_status, ''))) IN ('CANCELLED', 'CANCELED', 'CANCELADO') THEN 'CANCELADO'
      WHEN ${process}.delivery_date IS NOT NULL THEN 'ENTREGUE'
      WHEN NOT EXISTS (SELECT 1 FROM imports.process_document AS document
        WHERE document.process_id = ${process}.id AND document.kind = 'INVOICE' AND document.status = 'ACTIVE'${itemInvoices})
        THEN 'AGUARDANDO PRODUÇÃO'
      WHEN ${process}.bl_date IS NULL THEN 'AGUARDANDO EMBARQUE'
      WHEN ${process}.arrival_date IS NULL THEN 'AGUARDANDO CHEGADA'
      ELSE 'DESEMBARAÇO' END`;
}

/** SQL condition: `column` equals any value of the text array parameter `index`, ignoring case and outer spaces. */
const anyValue = (column: string, index: number) =>
  `($${index}::text[] IS NULL OR lower(btrim(coalesce(${column}, ''))) IN (SELECT lower(value) FROM unnest($${index}::text[]) AS value))`;

const linesSql = `WITH balance AS (
    SELECT item.id AS item_id,
           item.ordered_quantity - coalesce(sum(a.quantity) FILTER (WHERE a.status = 'ACTIVE'), 0) AS remaining
    FROM procurement.purchase_order_item AS item
    LEFT JOIN procurement.po_item_allocation AS a ON a.purchase_order_item_id = item.id
    GROUP BY item.id
  ), lines AS (
    SELECT a.id AS line_id, 'ALLOCATION'::text AS line_kind, a.purchase_order_item_id AS item_id,
           a.process_id, a.quantity AS line_quantity, a.factory_ship_date
    FROM procurement.po_item_allocation AS a WHERE a.status = 'ACTIVE'
    UNION ALL
    SELECT b.item_id, 'BALANCE', b.item_id, NULL::uuid, b.remaining, NULL::date
    FROM balance AS b WHERE b.remaining > 0
  ), enriched AS MATERIALIZED (
    SELECT l.line_id, l.line_kind, l.line_quantity, l.factory_ship_date, item.line_number, po.id AS po_id,
      po.normalized_number, p.ip_number AS sort_ip_number,
      CASE WHEN l.line_kind = 'BALANCE' THEN 'A DISTRIBUIR' ELSE ${shipmentStatusSql("p", "l.item_id")} END AS line_status,
      CASE WHEN p.id IS NULL THEN NULL ELSE coalesce(p.eta_confirmed,
        CASE WHEN nullif(btrim(p.transport_mode), '') IS NULL THEN NULL
          WHEN upper(btrim(p.transport_mode)) IN ('SEA', 'MARITIMO', 'MARÍTIMO') THEN p.etd + 55
          ELSE p.etd + 10 END) END AS line_eta,
      jsonb_build_object('id', po.id, 'number', po.external_number, 'importer', po.importer,
        'supplierText', coalesce(supplier.code, po.supplier_text),
        'orderDate', coalesce(po.order_date, CASE WHEN po.source_kind = 'MANUAL_TOTVS_REFERENCE'
          THEN (po.created_at AT TIME ZONE 'America/Sao_Paulo')::date END)) AS purchase_order,
      jsonb_build_object('id', item.id, 'lineNumber', item.line_number, 'productCode', item.product_code,
        'description', item.description, 'orderedQuantity', item.ordered_quantity::text, 'unit', item.unit,
        'unitPrice', item.unit_price::text, 'currencyCode', item.currency_code, 'ncm', item.ncm,
        'priority', item.priority, 'requester', item.requester, 'scNumber', item.sc_number,
        'demand', item.demand, 'demandType', po.demand_type, 'purpose', item.purpose, 'costCenter', item.cost_center, 'draftPo', item.draft_po,
        'category', item.category, 'group', to_jsonb(item)->>'item_group', 'remarks', item.remarks,
        'necessityDate', item.necessity_date, 'scApprovalDate', item.sc_approval_date,
        'poApprovalDate', item.po_approval_date, 'poSentDate', item.po_sent_date,
        'commercialPlanReceivedDate', item.commercial_plan_received_date, 'mrpCompletedDate', item.mrp_completed_date,
        'targetMrpDays', item.target_mrp_days, 'targetOrderDays', item.target_order_days,
        'targetShipmentDays', item.target_shipment_days, 'targetPortDays', item.target_port_days,
        'targetTransitDays', item.target_transit_days, 'targetCustomsDays', item.target_customs_days,
        'sourceStatus', item.source_status) AS item,
      CASE WHEN p.id IS NULL THEN NULL ELSE to_jsonb(p) END AS process
    FROM lines AS l
    JOIN procurement.purchase_order_item AS item ON item.id = l.item_id
    JOIN procurement.purchase_order AS po ON po.id = item.purchase_order_id
    LEFT JOIN catalog.entry AS supplier ON supplier.id = po.supplier_entry_id
    LEFT JOIN imports.import_process AS p ON p.id = l.process_id
    WHERE po.importer = ANY($1::text[])
      AND (l.line_kind = 'ALLOCATION' AND po.lifecycle_status IN ('ACTIVE', 'CLOSED')
        OR l.line_kind = 'BALANCE' AND po.lifecycle_status = 'ACTIVE'
          AND upper(coalesce(item.source_status, '')) NOT IN ('CANCELLED', 'CANCELED'))
      AND ($2::text IS NULL OR strpos(lower(po.importer), lower($2)) > 0)
      AND ($3::text IS NULL OR strpos(po.normalized_number, upper($3)) > 0)
      AND ($4::text IS NULL OR strpos(lower(coalesce(p.ip_number, '')), lower($4)) > 0)
      AND ($5::text IS NULL OR strpos(lower(item.product_code), lower($5)) > 0
        OR strpos(lower(item.description), lower($5)) > 0)
      AND ${anyValue("to_jsonb(item)->>'item_group'", 10)} AND ${anyValue("item.purpose", 11)}
      AND ($12::date IS NULL OR item.necessity_date >= $12::date)
      AND ($13::date IS NULL OR item.necessity_date <= $13::date)
      AND ${anyValue("po.importer", 14)} AND ${anyValue("po.external_number", 15)}
      AND ${anyValue("p.ip_number", 16)} AND ${anyValue("item.product_code", 17)}
  ), filtered AS MATERIALIZED (
    SELECT * FROM enriched
    WHERE ($6::text[] IS NULL OR line_status = ANY($6::text[]))
      AND ($7::date IS NULL OR line_eta >= $7::date) AND ($8::date IS NULL OR line_eta <= $8::date)
      AND ($9::text = 'all' OR line_status NOT IN ('ENTREGUE', 'CANCELADO'))
  ), page AS (
    SELECT * FROM filtered
    ORDER BY normalized_number, po_id, line_number, line_kind, sort_ip_number NULLS LAST, line_id
    LIMIT $18 OFFSET $19
  )
  SELECT (SELECT count(*)::int FROM filtered) AS total_count,
    coalesce(jsonb_agg(jsonb_build_object('line_id', page.line_id, 'line_kind', page.line_kind,
      'line_quantity', page.line_quantity::text, 'factory_ship_date', page.factory_ship_date,
      'line_status', page.line_status, 'purchase_order', page.purchase_order, 'item', page.item,
      'process', page.process)
      ORDER BY page.normalized_number, page.po_id, page.line_number, page.line_kind,
        page.sort_ip_number NULLS LAST, page.line_id) FILTER (WHERE page.line_id IS NOT NULL), '[]'::jsonb) AS items
  FROM page`;

export type ShipmentLine = Awaited<ReturnType<typeof calculateLines>>[number];
type LineE2e = ReturnType<typeof calculateE2e>;

const lineE2e = (line: ShipmentLine) => (line.calculated as { e2e?: LineE2e | null }).e2e ?? null;
const inFlow = (line: ShipmentLine) => (line.calculated as { status?: unknown }).status !== "CANCELADO";
const overviewStatuses = shipmentLineStatuses.slice(0, -1) as readonly Exclude<(typeof shipmentLineStatuses)[number], "CANCELADO">[];
const deadlineStatuses = ["onTime", "onLimit", "late", "noData"] as const satisfies readonly E2eDeadlineStatus[];
const quantityScale = 100_000_000n; // procurement quantities are numeric(24,8)

function scaledQuantity(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value);
  if (!match) throw new Error("Quantidade inválida no resumo End to End.");
  return BigInt(match[1]) * quantityScale + BigInt((match[2] ?? "").padEnd(8, "0"));
}

function decimalQuantity(value: bigint): string {
  const fraction = String(value % quantityScale).padStart(8, "0").replace(/0+$/u, "");
  return `${value / quantityScale}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Whether a line passes the E2E stage filters. `current`: the line is now in the stage (and
 * late there). `reached`: the stage already has its actual date (and had a delay); without a
 * stage, any stage with a delay. Cancelled lines never pass.
 */
export function matchesE2eStage(line: ShipmentLine, { stage, view = "current", late }: ShipmentLineFilters): boolean {
  const e2e = lineE2e(line);
  if (!e2e || !inFlow(line)) return false;
  if (view === "current") return (!stage || e2e.currentStage === stage) && (!late || e2e.currentStageLate);
  if (!stage) return !late || e2e.bottleneck !== null;
  return e2e.stages[stage].source === "actual" && (!late || (e2e.stages[stage].delayDays ?? 0) > 0);
}

/** Whether a line has the requested total deadline status. Cancelled lines never pass a deadline filter. */
function matchesDeadline(line: ShipmentLine, deadline: E2eDeadlineStatus | undefined): boolean {
  return !deadline || (inFlow(line) && e2eDeadlineStatus(lineE2e(line)) === deadline);
}

/** Whether a line has the demand type and transport mode of the chosen scenario. */
function matchesScenario(line: ShipmentLine, { demandType, modal }: Pick<ShipmentLineFilters, "demandType" | "modal">): boolean {
  if (!demandType && !modal) return true;
  const e2e = lineE2e(line);
  if (!e2e || !inFlow(line)) return false;
  return (!demandType || e2e.demandType === demandType) && (!modal || e2e.air === (modal === "air"));
}

/** Whether a line has the requested total delay range. Cancelled lines never pass a delay range filter. */
function matchesDelayRange(line: ShipmentLine, delayRange: E2eDelayRange | undefined): boolean {
  return !delayRange || (inFlow(line) && e2eDelayRange(lineE2e(line)) === delayRange);
}

const lineStatus = (line: ShipmentLine) => (line.calculated as { status: string }).status;

/** Exact item quantity and line count per key, every key present in the given order. */
function quantityTotals<Key extends string>(keys: readonly Key[], lines: ShipmentLine[], keyOf: (line: ShipmentLine) => Key) {
  const totals = new Map(keys.map(key => [key, { quantity: 0n, lines: 0 }]));
  for (const line of lines) {
    const part = totals.get(keyOf(line))!;
    part.quantity += scaledQuantity(line.quantity);
    part.lines += 1;
  }
  return Object.fromEntries(keys.map(key => {
    const part = totals.get(key)!;
    return [key, { quantity: decimalQuantity(part.quantity), lines: part.lines }];
  })) as Record<Key, { quantity: string; lines: number }>;
}

/**
 * Lines in each E2E stage and lines that already passed it, with the late ones, for the animated flow,
 * and the item quantities by line status, by total deadline status and by total delay range.
 * - The demand type and transport mode filter everything.
 * - The charts show the lines of the table: they follow the stage, the view and the late toggle,
 *   which the stage cards ignore so that they keep the count of every stage.
 * - The charts cross-filter: each one ignores its own filter (status, deadline or delay range) and
 *   follows the others; the stage cards follow all of them.
 */
export function summarizeE2eStages(lines: ShipmentLine[], filters: Partial<ShipmentLineFilters> = {}) {
  const { status, deadline, delayRange, stage, view, late } = filters;
  const flow = lines.filter(line => inFlow(line) && matchesScenario(line, filters));
  const ofTable = (line: ShipmentLine) => (!stage && !late) || matchesE2eStage(line, { situation: "all", stage, view, late });
  const charts = flow.filter(ofTable);
  const ofStatus = (line: ShipmentLine) => !status?.length || (status as string[]).includes(lineStatus(line));
  const ofDeadline = (line: ShipmentLine) => matchesDeadline(line, deadline);
  const ofDelayRange = (line: ShipmentLine) => matchesDelayRange(line, delayRange);
  const selected = flow.filter(line => ofStatus(line) && ofDeadline(line) && ofDelayRange(line));
  const stages = Object.fromEntries(E2E_STAGE_CODES.map(stage => {
    const count = (view: "current" | "reached", late?: "true") =>
      selected.filter(line => matchesE2eStage(line, { situation: "all", stage, view, late })).length;
    return [stage, { current: count("current"), currentLate: count("current", "true"),
      reached: count("reached"), reachedLate: count("reached", "true") }];
  })) as Record<E2eStageCode, { current: number; currentLate: number; reached: number; reachedLate: number }>;
  const delivered = selected.filter(line => { const e2e = lineE2e(line); return e2e !== null && e2e.currentStage === null; }).length;
  return { totalCount: selected.length, delivered, stages, overview: {
    byStatus: quantityTotals(overviewStatuses, charts.filter(line => ofDeadline(line) && ofDelayRange(line)),
      line => lineStatus(line) as typeof overviewStatuses[number]),
    byDeadline: quantityTotals(deadlineStatuses, charts.filter(line => ofStatus(line) && ofDelayRange(line)),
      line => e2eDeadlineStatus(lineE2e(line))),
    byDelayRange: quantityTotals(E2E_DELAY_RANGES, charts.filter(line => ofStatus(line) && ofDeadline(line)),
      line => e2eDelayRange(lineE2e(line))),
  } };
}

/** A delivered or cancelled status among the chosen ones asks for closed lines, so it overrides the open lines default. */
export function lineSituation({ status, situation }: Pick<ShipmentLineFilters, "status" | "situation">): "open" | "all" {
  return status?.includes("ENTREGUE") || status?.includes("CANCELADO") ? "all" : situation;
}

const values = (list: readonly string[] | undefined) => list?.length ? list : null;

async function queryLineRows(pool: Pool, scopes: readonly string[], filters: ShipmentLineFilters,
  limit: number | null, offset: number) {
  const result = await pool.query<{ total_count: number; items: Row[] }>(linesSql, [scopes,
    filters.importer || null, filters.purchaseOrder || null, filters.ipNumber || null, filters.product || null,
    values(filters.status), filters.etaFrom ?? null, filters.etaTo ?? null, lineSituation(filters),
    values(filters.group), values(filters.purpose), filters.necessityFrom ?? null, filters.necessityTo ?? null,
    values(filters.importers), values(filters.purchaseOrders), values(filters.ipNumbers), values(filters.productCodes),
    limit, offset]);
  return { totalCount: Number(result.rows[0]?.total_count ?? 0), rows: result.rows[0]?.items ?? [] };
}

/**
 * Product lines (one per active allocation plus the balance without IP) with their IP data.
 * The E2E stage, deadline, delay range and scenario filters depend on the calculation, so with
 * them every line is calculated before paging.
 */
export async function queryShipmentLines(pool: Pool, scopes: readonly string[], filters: ShipmentLineFilters,
  limit: number, offset: number) {
  if (!filters.stage && !filters.late && !filters.deadline && !filters.delayRange && !filters.demandType && !filters.modal) {
    const { totalCount, rows } = await queryLineRows(pool, scopes, filters, limit, offset);
    return { totalCount, lines: await calculateLines(pool, rows) };
  }
  const { rows } = await queryLineRows(pool, scopes, filters, null, 0);
  const lines = (await calculateLines(pool, rows))
    .filter(line => matchesE2eStage(line, filters) && matchesDeadline(line, filters.deadline)
      && matchesDelayRange(line, filters.delayRange) && matchesScenario(line, filters));
  return { totalCount: lines.length, lines: lines.slice(offset, offset + limit) };
}

// Values of every product line of the importers for the End to End filter form; they do not
// depend on the filters, so choosing one does not hide the others.
const filterOptionsSql = `WITH scoped AS (
    SELECT item.id AS item_id, po.importer, po.external_number, item.product_code, item.description,
      to_jsonb(item)->>'item_group' AS item_group, item.purpose
    FROM procurement.purchase_order_item AS item
    JOIN procurement.purchase_order AS po ON po.id = item.purchase_order_id
    WHERE po.importer = ANY($1::text[]) AND po.lifecycle_status IN ('ACTIVE', 'CLOSED')
  )
  SELECT
    coalesce(array_agg(DISTINCT btrim(item_group)) FILTER (WHERE nullif(btrim(item_group), '') IS NOT NULL), '{}') AS filter_groups,
    coalesce(array_agg(DISTINCT btrim(purpose)) FILTER (WHERE nullif(btrim(purpose), '') IS NOT NULL), '{}') AS filter_purposes,
    coalesce(array_agg(DISTINCT importer), '{}') AS filter_importers,
    coalesce(array_agg(DISTINCT btrim(external_number)) FILTER (WHERE nullif(btrim(external_number), '') IS NOT NULL), '{}')
      AS filter_purchase_orders,
    (SELECT coalesce(array_agg(DISTINCT btrim(p.ip_number)) FILTER (WHERE nullif(btrim(p.ip_number), '') IS NOT NULL), '{}')
      FROM procurement.po_item_allocation AS a JOIN imports.import_process AS p ON p.id = a.process_id
      WHERE a.status = 'ACTIVE' AND a.purchase_order_item_id IN (SELECT item_id FROM scoped)) AS filter_ip_numbers,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('code', product.code, 'description', product.description)), '[]')
      FROM (SELECT btrim(product_code) AS code, min(description) AS description FROM scoped
        WHERE nullif(btrim(product_code), '') IS NOT NULL GROUP BY 1) AS product) AS filter_products
  FROM scoped`;

type FilterOptionRow = { filter_groups: string[] | null; filter_purposes: string[] | null; filter_importers: string[] | null;
  filter_purchase_orders: string[] | null; filter_ip_numbers: string[] | null;
  filter_products: { code: string; description: string | null }[] | null };

const byText = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });

/** Groups, purposes, importers, POs, IPs and products (code and one description) of the importers, sorted. */
export async function queryShipmentLineFilterOptions(pool: Pool, scopes: readonly string[]) {
  const row = (await pool.query<FilterOptionRow>(filterOptionsSql, [scopes])).rows[0];
  const sorted = (values: string[] | null | undefined) => [...(values ?? [])].sort(byText);
  return { groups: sorted(row?.filter_groups), purposes: sorted(row?.filter_purposes), importers: sorted(row?.filter_importers),
    purchaseOrders: sorted(row?.filter_purchase_orders), ipNumbers: sorted(row?.filter_ip_numbers),
    products: [...(row?.filter_products ?? [])].sort((a, b) => byText(a.code, b.code)) };
}

/**
 * Every line matching the filters, summarized by E2E stage. The status chart ignores the status
 * filter, so the database returns every status (in the situation the status implies) and the summary
 * applies it to the calculated status.
 */
export async function queryE2eStageSummary(pool: Pool, scopes: readonly string[], filters: ShipmentLineFilters) {
  const { rows } = await queryLineRows(pool, scopes, { ...filters, status: undefined, situation: lineSituation(filters) },
    null, 0);
  return summarizeE2eStages(await calculateLines(pool, rows), filters);
}

async function calculateLines(pool: Pool, rows: Row[]) {
  const processIds = [...new Set(rows.map(row => (row.process as Row | null)?.id).filter((id): id is string =>
    typeof id === "string"))];
  const documents = processIds.length ? (await pool.query<Row>(`SELECT * FROM imports.process_document
    WHERE process_id = ANY($1::uuid[]) AND status = 'ACTIVE'`, [processIds])).rows
    .map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [camelKey(key), value]))) : [];
  const targetSets = await loadE2eTargetSets(pool);
  const today = todayInBrasilia();
  return rows.map(row => {
    const process = processView(row.process);
    const item = row.item as Row;
    const quantity = String(row.line_quantity);
    const factoryShipDate = (row.factory_ship_date as string | null) ?? null;
    const calculated: Row = process
      ? calculateFollowup({ ...item, allocationQuantity: quantity, actualFactoryShipDate: factoryShipDate }, process,
        documents.filter(document => document.processId === process.id), today, targetSets)
      // The balance without IP still runs the stages up to the HQ shipment deadline.
      : { status: "A DISTRIBUIR", e2e: calculateE2e(item, {}, "A DISTRIBUIR", // i18n-ignore: API status
        e2eTargetSetFor(targetSets, item.necessityDate, today), null, today) };
    return {
      lineId: row.line_id, lineKind: row.line_kind, quantity, factoryShipDate,
      purchaseOrder: row.purchase_order as Row, item, process, calculated,
    };
  });
}

const optionalText = (max: number) => z.string().trim().max(max).optional();
/**
 * One or more values: a key repeated in the query string (a string when it has one value) or an array
 * in the export body. Values are trimmed; empty and repeated ones are dropped.
 */
const valueList = <T extends string>(value: z.ZodType<T>) => z.preprocess(input => typeof input === "string" ? [input] : input,
  z.array(value).max(500).transform(list => [...new Set(list.filter(item => item !== ""))])).optional();
const textList = (max: number) => valueList(z.string().trim().max(max));
const lineFilterQuery = z.object({
  importer: optionalText(120), purchaseOrder: optionalText(80), ipNumber: optionalText(80), product: optionalText(200),
  status: valueList(z.enum(shipmentLineStatuses)), etaFrom: z.iso.date().optional(), etaTo: z.iso.date().optional(),
  situation: z.enum(["open", "all"]).default("open"), deadline: z.enum(deadlineStatuses).optional(),
  group: textList(120), purpose: textList(160), importers: textList(120), purchaseOrders: textList(80),
  ipNumbers: textList(80), productCodes: textList(200),
  necessityFrom: z.iso.date().optional(), necessityTo: z.iso.date().optional(),
  delayRange: z.enum(E2E_DELAY_RANGES).optional(),
  demandType: z.enum(["mts", "notMts"]).optional(), modal: z.enum(["sea", "air"]).optional(),
});
export const shipmentLineQuery = lineFilterQuery.extend({
  stage: z.enum(E2E_STAGE_CODES).optional(), view: z.enum(["current", "reached"]).optional(),
  late: z.enum(["true"]).optional(),
});

function invalidQuery(request: FastifyRequest, reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ type: "about:blank", title: "Parâmetros inválidos", status: 400,
    detail: "Revise os filtros e a paginação.", instance: request.url.split("?", 1)[0], traceId: request.id,
    code: "INVALID_QUERY", errors: error.flatten().fieldErrors });
}

export async function registerShipmentLineRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/purchase-order-lines", { config: permissionConfig("purchase-orders.read") }, async (request, reply) => {
    const parsed = shipmentLineQuery.extend({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    }).strict().safeParse(request.query);
    if (!parsed.success) return invalidQuery(request, reply, parsed.error);
    const { page, pageSize, ...filters } = parsed.data;
    const result = await queryShipmentLines(pool, request.authorizationContext?.importerScopes ?? [], filters,
      pageSize, (page - 1) * pageSize);
    reply.header("Cache-Control", "no-store");
    return { page, pageSize, ...result };
  });

  app.get("/api/v1/purchase-order-lines/filter-options", { config: permissionConfig("purchase-orders.read") },
    async (request, reply) => {
      const result = await queryShipmentLineFilterOptions(pool, request.authorizationContext?.importerScopes ?? []);
      reply.header("Cache-Control", "no-store");
      return result;
    });

  app.get("/api/v1/purchase-order-lines/e2e-stages", { config: permissionConfig("purchase-orders.read") },
    async (request, reply) => {
      const parsed = shipmentLineQuery.strict().safeParse(request.query);
      if (!parsed.success) return invalidQuery(request, reply, parsed.error);
      const result = await queryE2eStageSummary(pool, request.authorizationContext?.importerScopes ?? [], parsed.data);
      reply.header("Cache-Control", "no-store");
      return result;
    });
}
