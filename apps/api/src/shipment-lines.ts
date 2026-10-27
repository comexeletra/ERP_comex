import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { loadE2eTargetSets } from "./e2e-targets.js";
import { calculateE2e, calculateFollowup, E2E_STAGE_CODES, e2eDeadlineStatus, e2eTargetSetFor, todayInBrasilia,
  type E2eDeadlineStatus, type E2eStageCode } from "./followup-calculations.js";

type Row = Record<string, unknown>;

/** Status of a product line: its IP shipment status, or A DISTRIBUIR for the balance without IP. */
export const shipmentLineStatuses = ["A DISTRIBUIR", "AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE",
  "AGUARDANDO CHEGADA", "DESEMBARAÇO", "ENTREGUE", "CANCELADO"] as const;

export type ShipmentLineFilters = {
  importer?: string; purchaseOrder?: string; ipNumber?: string; product?: string;
  status?: (typeof shipmentLineStatuses)[number]; etaFrom?: string; etaTo?: string; situation: "open" | "all";
  /** E2E stage: the lines now in it (`current`) or those that already have its actual date (`reached`). */
  stage?: E2eStageCode; view?: "current" | "reached"; late?: "true";
};

// IP columns repeated on every product line. Costs stay on the IP: repeating them per
// product would duplicate the shipment totals.
const processLineColumns = ["id", "ip_number", "importer", "record_status", "lifecycle_status", "logistics_status",
  "priority", "ip_totvs_date", "transport_mode", "incoterm", "broker", "port_loading", "port_discharge", "etd",
  "actual_port_departure_date", "bl_number", "bl_date", "eta_confirmed", "arrival_date", "duimp_number", "duimp_date",
  "customs_channel", "clearance_date", "ete_confirmed", "nf_request_date", "delivery_date", "container_number",
  "container_type", "forwarder", "documents_ok", "storage_due_override"];

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
        'demand', item.demand, 'demandType', item.demand_type, 'purpose', item.purpose, 'costCenter', item.cost_center, 'draftPo', item.draft_po,
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
  ), filtered AS MATERIALIZED (
    SELECT * FROM enriched
    WHERE ($6::text IS NULL OR line_status = $6)
      AND ($7::date IS NULL OR line_eta >= $7::date) AND ($8::date IS NULL OR line_eta <= $8::date)
      AND ($9::text = 'all' OR line_status NOT IN ('ENTREGUE', 'CANCELADO'))
  ), page AS (
    SELECT * FROM filtered
    ORDER BY normalized_number, po_id, line_number, line_kind, sort_ip_number NULLS LAST, line_id
    LIMIT $10 OFFSET $11
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
const deadlineStatuses: readonly E2eDeadlineStatus[] = ["onTime", "onLimit", "late", "noData"];
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

/** Lines in each E2E stage and lines that already passed it, with the late ones, for the animated flow. */
export function summarizeE2eStages(lines: ShipmentLine[]) {
  const flow = lines.filter(inFlow);
  const stages = Object.fromEntries(E2E_STAGE_CODES.map(stage => {
    const count = (view: "current" | "reached", late?: "true") =>
      flow.filter(line => matchesE2eStage(line, { situation: "all", stage, view, late })).length;
    return [stage, { current: count("current"), currentLate: count("current", "true"),
      reached: count("reached"), reachedLate: count("reached", "true") }];
  })) as Record<E2eStageCode, { current: number; currentLate: number; reached: number; reachedLate: number }>;
  const delivered = flow.filter(line => { const e2e = lineE2e(line); return e2e !== null && e2e.currentStage === null; }).length;
  const emptyParts = <Key extends string>(keys: readonly Key[]) => Object.fromEntries(keys.map(key =>
    [key, { quantity: 0n, lines: 0 }])) as Record<Key, { quantity: bigint; lines: number }>;
  const byStatus = emptyParts(overviewStatuses);
  const byDeadline = emptyParts(deadlineStatuses);
  for (const line of flow) {
    const quantity = scaledQuantity(line.quantity);
    const status = (line.calculated as { status: keyof typeof byStatus }).status;
    byStatus[status].quantity += quantity;
    byStatus[status].lines += 1;
    const deadline = e2eDeadlineStatus(lineE2e(line));
    byDeadline[deadline].quantity += quantity;
    byDeadline[deadline].lines += 1;
  }
  const serialize = <Key extends string>(parts: Record<Key, { quantity: bigint; lines: number }>) => {
    const result = Object.fromEntries(Object.entries(parts).map(([key, part]) => [key,
      { quantity: decimalQuantity((part as { quantity: bigint }).quantity), lines: (part as { lines: number }).lines }]));
    return result as Record<Key, { quantity: string; lines: number }>;
  };
  return { totalCount: flow.length, delivered, stages,
    overview: { byStatus: serialize(byStatus), byDeadline: serialize(byDeadline) } };
}

async function queryLineRows(pool: Pool, scopes: readonly string[], filters: ShipmentLineFilters,
  limit: number | null, offset: number) {
  const result = await pool.query<{ total_count: number; items: Row[] }>(linesSql, [scopes,
    filters.importer || null, filters.purchaseOrder || null, filters.ipNumber || null, filters.product || null,
    filters.status ?? null, filters.etaFrom ?? null, filters.etaTo ?? null, filters.situation, limit, offset]);
  return { totalCount: Number(result.rows[0]?.total_count ?? 0), rows: result.rows[0]?.items ?? [] };
}

/**
 * Product lines (one per active allocation plus the balance without IP) with their IP data.
 * The E2E stage filters depend on the calculation, so with them every line is calculated
 * before paging.
 */
export async function queryShipmentLines(pool: Pool, scopes: readonly string[], filters: ShipmentLineFilters,
  limit: number, offset: number) {
  if (!filters.stage && !filters.late) {
    const { totalCount, rows } = await queryLineRows(pool, scopes, filters, limit, offset);
    return { totalCount, lines: await calculateLines(pool, rows) };
  }
  const { rows } = await queryLineRows(pool, scopes, filters, null, 0);
  const lines = (await calculateLines(pool, rows)).filter(line => matchesE2eStage(line, filters));
  return { totalCount: lines.length, lines: lines.slice(offset, offset + limit) };
}

/** Every line matching the filters, summarized by E2E stage. */
export async function queryE2eStageSummary(pool: Pool, scopes: readonly string[], filters: ShipmentLineFilters) {
  const { rows } = await queryLineRows(pool, scopes, filters, null, 0);
  return summarizeE2eStages(await calculateLines(pool, rows));
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
const lineFilterQuery = z.object({
  importer: optionalText(120), purchaseOrder: optionalText(80), ipNumber: optionalText(80), product: optionalText(200),
  status: z.enum(shipmentLineStatuses).optional(), etaFrom: z.iso.date().optional(), etaTo: z.iso.date().optional(),
  situation: z.enum(["open", "all"]).default("open"),
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

  app.get("/api/v1/purchase-order-lines/e2e-stages", { config: permissionConfig("purchase-orders.read") },
    async (request, reply) => {
      const parsed = lineFilterQuery.strict().safeParse(request.query);
      if (!parsed.success) return invalidQuery(request, reply, parsed.error);
      const result = await queryE2eStageSummary(pool, request.authorizationContext?.importerScopes ?? [], parsed.data);
      reply.header("Cache-Control", "no-store");
      return result;
    });
}
