import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { shipmentDates, todayInBrasilia } from "./followup-calculations.js";
import { decimalQuantity, E2E_CALCULATION_CONCURRENCY, scaledQuantity, shipmentStatusSql } from "./shipment-lines.js";
import { createWorkGate, WorkCancelledError, type WorkGate } from "./work-gate.js";

/**
 * Post-shipment dashboard: the BI "Pós Embarque" metrics, one line per IP, from the post-shipment data of the IP
 * (rules and user decisions in docs/PLANO_DASHBOARD_POS_EMBARQUE.md).
 */

/** Status of the IP from its own dates (`shipmentStatusSql`), in the order of the flow. */
export const POST_SHIPMENT_STATUSES = ["AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE", "AGUARDANDO CHEGADA",
  "DESEMBARAÇO", "ENTREGUE", "CANCELADO"] as const;
export type PostShipmentStatus = (typeof POST_SHIPMENT_STATUSES)[number];
/** Customs channel of the IP; `other` is a value outside the known ones and `none` an empty channel. */
export const POST_SHIPMENT_CHANNELS = ["green", "yellow", "red", "gray", "other", "none"] as const;
export type PostShipmentChannel = (typeof POST_SHIPMENT_CHANNELS)[number];
export const POST_SHIPMENT_PRIORITIES = ["priority", "normal"] as const;
export type PostShipmentPriority = (typeof POST_SHIPMENT_PRIORITIES)[number];
/** BI "Clearense_water": the DUIMP registered while the cargo was on water, or the normal clearance. */
export const POST_SHIPMENT_CLEARANCE_TYPES = ["onWater", "normal"] as const;
export type PostShipmentClearanceType = (typeof POST_SHIPMENT_CLEARANCE_TYPES)[number];

/** Targets of the BI: DSA ≥ 70%, average LT DOC ≤ 7 days and LT Clearance ≤ 7 days (green up to the target). */
export const POST_SHIPMENT_TARGETS = { dsa: 0.7, avgLtDoc: 7, leadTime: 7 } as const;

const channelNames: Record<Exclude<PostShipmentChannel, "other" | "none">, readonly string[]> = {
  green: ["GREEN", "VERDE"], yellow: ["YELLOW", "AMARELO"], red: ["RED", "VERMELHO"], gray: ["GRAY", "GREY", "CINZA"],
};

export function channelKey(value: string | null): PostShipmentChannel {
  const name = (value ?? "").trim().toUpperCase();
  if (!name) return "none";
  const found = (Object.keys(channelNames) as (keyof typeof channelNames)[]).find(key => channelNames[key].includes(name));
  return found ?? "other";
}

/** BI "LeadTime_doc Status": Air up to 2 days, Sea up to 7; another mode has no target. */
export function ltDocTarget(mode: string | null): number | null {
  const name = (mode ?? "").trim().toUpperCase();
  if (["SEA", "MARITIMO", "MARÍTIMO"].includes(name)) return 7;
  if (["AIR", "AEREO", "AÉREO"].includes(name)) return 2;
  return null;
}

/**
 * On water when the DUIMP was registered before the arrival, or registered while the IP has not arrived yet. The BI
 * compares blank dates as the smallest date and so counts an IP arrived without a DUIMP as on water; the user chose
 * the rule above (2026-11-06).
 */
export function clearanceType(duimpDate: string | null, arrivalDate: string | null): PostShipmentClearanceType {
  if (!duimpDate) return "normal";
  return arrivalDate === null || duimpDate < arrivalDate ? "onWater" : "normal";
}

const dayMs = 86_400_000;
/** Days from `start` to `end`, as the BI DATEDIFF(start, end, DAY); null when a date is missing. */
function days(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / dayMs);
}

/** A row of the IP query: the dates are text (`::text`), so no time zone moves them. */
export type PostShipmentIpRow = {
  id: string; ip_number: string; importer: string | null; priority: string | null; incoterm: string | null;
  transport_mode: string | null; etd: string | null; eta_confirmed: string | null; ete_confirmed: string | null;
  arrival_date: string | null; documents_ok_date: string | null; duimp_date: string | null; delivery_date: string | null;
  ip_totvs_date: string | null; customs_channel: string | null; container_quantity: string | null;
  necessity_date: string | null; status: string;
};

/** A line of the dashboard table, as GET /lines returns it. */
export type PostShipmentIp = {
  id: string; ipNumber: string; importer: string | null; necessityDate: string | null;
  priority: string | null; priorityKey: PostShipmentPriority; incoterm: string | null; mode: string | null;
  status: PostShipmentStatus; duimpDate: string | null; documentsOkDate: string | null; arrivalDate: string | null;
  /** BI "LeadTime_doc Status": days from the arrival to the documents (or today), with the target of the mode. */
  ltDoc: number | null; ltDocTarget: number | null; ltDocOnTarget: boolean | null;
  etd: string | null; eta: string | null; ete: string | null; deliveryDate: string | null;
  containerQuantity: string | null;
  /** BI "lead_time" (LT Clearance): days from the arrival to the delivery (or today). */
  leadTime: number | null;
  clearanceType: PostShipmentClearanceType;
  /** BI "arm_time" (SLA TXT): days from the IP date in TOTVS (BI "TXT date") to the arrival. */
  txtDate: string | null; slaTxt: number | null;
  channel: string | null; channelKey: PostShipmentChannel;
  /** The delivery, or today without it (the active relationship of the BI calendar). */
  referenceDate: string;
};

const nonEmpty = (value: string | null) => value?.trim() ? value.trim() : null;

export function postShipmentIp(row: PostShipmentIpRow, today: string): PostShipmentIp {
  const status = (POST_SHIPMENT_STATUSES as readonly string[]).includes(row.status)
    ? row.status as PostShipmentStatus : "AGUARDANDO PRODUÇÃO";
  const mode = nonEmpty(row.transport_mode);
  const { eta, ete } = shipmentDates({ transportMode: mode, etd: row.etd, etaConfirmed: row.eta_confirmed,
    eteConfirmed: row.ete_confirmed });
  const ltDoc = row.arrival_date ? days(row.arrival_date, row.documents_ok_date ?? today) : null;
  const target = ltDocTarget(mode);
  const priority = nonEmpty(row.priority);
  return {
    id: row.id, ipNumber: row.ip_number, importer: row.importer, necessityDate: row.necessity_date,
    priority, priorityKey: priority ? "priority" : "normal", incoterm: nonEmpty(row.incoterm), mode, status,
    duimpDate: row.duimp_date, documentsOkDate: row.documents_ok_date, arrivalDate: row.arrival_date,
    ltDoc, ltDocTarget: target, ltDocOnTarget: ltDoc === null || target === null ? null : ltDoc <= target,
    etd: row.etd, eta, ete, deliveryDate: row.delivery_date, containerQuantity: row.container_quantity,
    leadTime: row.arrival_date ? days(row.arrival_date, row.delivery_date ?? today) : null,
    clearanceType: clearanceType(row.duimp_date, row.arrival_date),
    txtDate: row.ip_totvs_date, slaTxt: days(row.ip_totvs_date, row.arrival_date),
    channel: nonEmpty(row.customs_channel), channelKey: channelKey(row.customs_channel),
    referenceDate: row.delivery_date ?? today,
  };
}

const optionalText = (max: number) => z.string().trim().max(max).optional().transform(value => value || undefined);
/** One or more values: a key repeated in the query string (a string when it has one value); empty ones dropped. */
const valueList = <T extends string>(value: z.ZodType<T>) => z.preprocess(input => {
  const list = typeof input === "string" ? [input] : input;
  return Array.isArray(list) ? list.filter(item => item !== "") : list;
}, z.array(value).max(500).transform(list => [...new Set(list.filter(item => item !== ""))])).optional();
const textList = (max: number) => valueList(z.string().trim().max(max));

/** Filters of the dashboard, the same for the summary and the table. `status` to `clearance` are chart selections. */
export const postShipmentQuery = z.object({
  status: valueList(z.enum(POST_SHIPMENT_STATUSES)), channel: valueList(z.enum(POST_SHIPMENT_CHANNELS)),
  priority: valueList(z.enum(POST_SHIPMENT_PRIORITIES)), clearance: valueList(z.enum(POST_SHIPMENT_CLEARANCE_TYPES)),
  importers: textList(120), modes: textList(40), ipNumber: optionalText(80),
  dateFrom: z.iso.date().optional(), dateTo: z.iso.date().optional(),
});
export type PostShipmentFilters = z.infer<typeof postShipmentQuery>;
type Selection = "status" | "channel" | "priority" | "clearance";

const linesQuery = postShipmentQuery.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

const inPeriod = (ip: PostShipmentIp, { dateFrom, dateTo }: Pick<PostShipmentFilters, "dateFrom" | "dateTo">) =>
  (!dateFrom || ip.referenceDate >= dateFrom) && (!dateTo || ip.referenceDate <= dateTo);

/**
 * The IPs of the period and of every chart selection, except those `ignored`: a chart ignores its own selection
 * (the cross-filter), and the monthly charts ignore the date.
 */
function selected(ips: readonly PostShipmentIp[], filters: Partial<PostShipmentFilters>,
  ignored: readonly (Selection | "date")[] = []) {
  const keep = (selection: Selection, value: string) => {
    const chosen = ignored.includes(selection) ? undefined : filters[selection] as readonly string[] | undefined;
    return !chosen?.length || chosen.includes(value);
  };
  return ips.filter(ip => (ignored.includes("date") || inPeriod(ip, filters)) && keep("status", ip.status)
    && keep("channel", ip.channelKey) && keep("priority", ip.priorityKey) && keep("clearance", ip.clearanceType));
}

function counts<Key extends string>(keys: readonly Key[], ips: readonly PostShipmentIp[], keyOf: (ip: PostShipmentIp) => Key) {
  const result = Object.fromEntries(keys.map(key => [key, 0])) as Record<Key, number>;
  for (const ip of ips) result[keyOf(ip)] += 1;
  return result;
}

function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

const change = (current: number | null, previous: number | null) =>
  current === null || previous === null || previous === 0 ? null : (current - previous) / previous;

const monthOf = (date: string) => date.slice(0, 7);
function nextMonth(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return value === 12 ? `${year + 1}-01` : `${year}-${String(value + 1).padStart(2, "0")}`;
}

/**
 * Months of the monthly charts: the whole history, from the month of the earliest reference date to the month of
 * today, whatever the date filter (user decision of 2026-11-06). No IP, no month.
 */
export function postShipmentMonths(referenceDates: readonly string[], today: string) {
  if (!referenceDates.length) return [];
  const last = monthOf(today);
  const first = referenceDates.reduce((earliest, date) => date < earliest ? date : earliest).slice(0, 7);
  const months: string[] = [];
  for (let month = first < last ? first : last; month <= last; month = nextMonth(month)) months.push(month);
  return months;
}

export function summarizePostShipment(ips: readonly PostShipmentIp[], filters: Partial<PostShipmentFilters>, today: string) {
  const all = selected(ips, filters);
  // The on water card is the clearance chart: its count and the DSA keep the IPs of the other clearance type.
  const anyClearance = selected(ips, filters, ["clearance"]);
  const onWater = anyClearance.filter(ip => ip.clearanceType === "onWater").length;
  let containers = 0n;
  for (const ip of all) if (ip.containerQuantity) containers += scaledQuantity(ip.containerQuantity);

  // The monthly charts always show the whole history: they follow every filter and selection but the date.
  const history = selected(ips, filters, ["date"]);
  const historyAnyClearance = selected(ips, filters, ["date", "clearance"]);
  const months = postShipmentMonths(historyAnyClearance.map(ip => ip.referenceDate), today).map(month => {
    const ofMonth = historyAnyClearance.filter(ip => monthOf(ip.referenceDate) === month);
    const monthOnWater = ofMonth.filter(ip => ip.clearanceType === "onWater").length;
    return { month, ips: ofMonth.length, onWater: monthOnWater, dsa: ofMonth.length ? monthOnWater / ofMonth.length : null,
      leadTimeRealTime: mean(history.filter(ip => monthOf(ip.referenceDate) === month).map(ip => ip.leadTime)),
      leadTimeDelivered: mean(history.filter(ip => ip.deliveryDate !== null && monthOf(ip.deliveryDate) === month)
        .map(ip => ip.leadTime)) };
  }).map((month, index, list) => ({ ...month,
    leadTimeRealTimeChange: change(month.leadTimeRealTime, list[index - 1]?.leadTimeRealTime ?? null),
    leadTimeDeliveredChange: change(month.leadTimeDelivered, list[index - 1]?.leadTimeDelivered ?? null) }));

  return {
    totalIps: all.length, containers: decimalQuantity(containers), onWater,
    dsa: anyClearance.length ? onWater / anyClearance.length : null,
    avgLtDoc: mean(all.map(ip => ip.ltDoc)), avgSlaTxt: mean(all.map(ip => ip.slaTxt)),
    byStatus: counts(POST_SHIPMENT_STATUSES, selected(ips, filters, ["status"]), ip => ip.status),
    byChannel: counts(POST_SHIPMENT_CHANNELS, selected(ips, filters, ["channel"]), ip => ip.channelKey),
    byPriority: counts(POST_SHIPMENT_PRIORITIES, selected(ips, filters, ["priority"]), ip => ip.priorityKey),
    months,
    // The dashed line of each monthly chart: the average of the months that have a value.
    monthlyAverages: { dsa: mean(months.map(month => month.dsa)),
      leadTimeRealTime: mean(months.map(month => month.leadTimeRealTime)),
      leadTimeDelivered: mean(months.map(month => month.leadTimeDelivered)) },
    targets: { ...POST_SHIPMENT_TARGETS },
  };
}

const ipCollator = new Intl.Collator("pt-BR", { numeric: true });
/** The IPs of every filter and selection, in the order of the flow, then the necessity (empty last) and the IP. */
export function selectPostShipmentLines(ips: readonly PostShipmentIp[], filters: Partial<PostShipmentFilters>) {
  const rank = (ip: PostShipmentIp) => POST_SHIPMENT_STATUSES.indexOf(ip.status);
  return selected(ips, filters).sort((a, b) => rank(a) - rank(b)
    || (a.necessityDate ?? "9999-12-31").localeCompare(b.necessityDate ?? "9999-12-31")
    || ipCollator.compare(a.ipNumber, b.ipNumber) || a.id.localeCompare(b.id));
}

/**
 * The IPs of the user's importers with the filters that are not chart selections nor the date; deleted IPs stay out,
 * as in the reports summary. A cancelled IP record is CANCELADO, like a cancelled logistics status.
 */
async function queryIps(pool: Pool, scopes: readonly string[], filters: PostShipmentFilters, today: string) {
  const params: unknown[] = [scopes];
  const param = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const where: string[] = [];
  const anyOf = (column: string, values: readonly string[] | undefined) => {
    if (values?.length) where.push(`lower(btrim(coalesce(${column}, ''))) IN (SELECT lower(value) FROM unnest(${param(values)}::text[]) AS value)`);
  };
  anyOf("p.importer", filters.importers);
  anyOf("p.transport_mode", filters.modes);
  if (filters.ipNumber) where.push(`strpos(lower(p.ip_number), lower(${param(filters.ipNumber)})) > 0`);
  const result = await pool.query<PostShipmentIpRow>(`WITH post_shipment_ip AS (
    SELECT p.id, p.ip_number, p.importer, p.priority, p.incoterm, p.transport_mode, p.etd::text AS etd,
      p.eta_confirmed::text AS eta_confirmed, p.ete_confirmed::text AS ete_confirmed, p.arrival_date::text AS arrival_date,
      p.documents_ok_date::text AS documents_ok_date, p.duimp_date::text AS duimp_date,
      p.delivery_date::text AS delivery_date, p.ip_totvs_date::text AS ip_totvs_date, p.customs_channel,
      p.container_quantity::text AS container_quantity,
      (SELECT min(item.necessity_date) FROM procurement.po_item_allocation AS a
        JOIN procurement.purchase_order_item AS item ON item.id = a.purchase_order_item_id
        WHERE a.process_id = p.id AND a.status = 'ACTIVE')::text AS necessity_date,
      CASE WHEN p.record_status = 'CANCELLED' THEN 'CANCELADO' ELSE ${shipmentStatusSql("p", null)} END AS status
    FROM imports.import_process AS p
    WHERE p.importer = ANY($1::text[]) AND p.record_status <> 'DELETED'${where.map(condition => `
      AND ${condition}`).join("")}
  )
  SELECT * FROM post_shipment_ip`, params);
  return result.rows.map(row => postShipmentIp(row, today));
}

export async function queryPostShipmentSummary(pool: Pool, scopes: readonly string[], filters: PostShipmentFilters,
  today = todayInBrasilia()) {
  return summarizePostShipment(await queryIps(pool, scopes, filters, today), filters, today);
}

export async function queryPostShipmentLines(pool: Pool, scopes: readonly string[], filters: PostShipmentFilters,
  limit: number, offset: number, today = todayInBrasilia()) {
  const lines = selectPostShipmentLines(await queryIps(pool, scopes, filters, today), filters);
  return { totalCount: lines.length, lines: lines.slice(offset, offset + limit) };
}

const filterOptionsSql = `SELECT
    coalesce(array_agg(DISTINCT upper(btrim(p.transport_mode))) FILTER (WHERE nullif(btrim(p.transport_mode), '') IS NOT NULL), '{}') AS option_modes,
    coalesce(array_agg(DISTINCT btrim(p.importer)) FILTER (WHERE nullif(btrim(p.importer), '') IS NOT NULL), '{}') AS option_importers
  FROM imports.import_process AS p
  WHERE p.importer = ANY($1::text[]) AND p.record_status <> 'DELETED'`;

const sorted = (values: string[] | null | undefined) =>
  [...(values ?? [])].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

export async function queryPostShipmentFilterOptions(pool: Pool, scopes: readonly string[]) {
  const row = (await pool.query<{ option_modes: string[] | null; option_importers: string[] | null }>(filterOptionsSql, [scopes])).rows[0];
  return { modes: sorted(row?.option_modes), importers: sorted(row?.option_importers) };
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
 * Post-shipment dashboard routes. The summary and the table read every IP of the filters, so they wait in the gate
 * shared with the End to End and pre-shipment calculations (server.ts).
 */
export async function registerPostShipmentDashboardRoutes(app: FastifyInstance, pool: Pool,
  gate: WorkGate = createWorkGate(E2E_CALCULATION_CONCURRENCY)): Promise<void> {
  const scopesOf = (request: FastifyRequest) => request.authorizationContext?.importerScopes ?? [];

  app.get("/api/v1/reports/post-shipment/summary", { config: permissionConfig("processes.read") }, async (request, reply) => {
    const parsed = postShipmentQuery.strict().safeParse(request.query);
    if (!parsed.success) return invalidQuery(request, reply, parsed.error);
    let result;
    try {
      result = await gate.run(() => queryPostShipmentSummary(pool, scopesOf(request), parsed.data), clientGone(reply));
    } catch (error) {
      if (error instanceof WorkCancelledError) return cancelled(request, reply);
      throw error;
    }
    reply.header("Cache-Control", "no-store");
    return result;
  });

  app.get("/api/v1/reports/post-shipment/lines", { config: permissionConfig("processes.read") }, async (request, reply) => {
    const parsed = linesQuery.safeParse(request.query);
    if (!parsed.success) return invalidQuery(request, reply, parsed.error);
    const { page, pageSize, ...filters } = parsed.data;
    let result;
    try {
      result = await gate.run(() => queryPostShipmentLines(pool, scopesOf(request), filters, pageSize, (page - 1) * pageSize),
        clientGone(reply));
    } catch (error) {
      if (error instanceof WorkCancelledError) return cancelled(request, reply);
      throw error;
    }
    reply.header("Cache-Control", "no-store");
    return { page, pageSize, ...result };
  });

  app.get("/api/v1/reports/post-shipment/filter-options", { config: permissionConfig("processes.read") },
    async (request, reply) => {
      const result = await queryPostShipmentFilterOptions(pool, scopesOf(request));
      reply.header("Cache-Control", "no-store");
      return result;
    });
}
