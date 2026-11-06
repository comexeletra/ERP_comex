import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { shipmentDates, todayInBrasilia } from "./followup-calculations.js";
import { optionalText, POST_SHIPMENT_STATUSES, textList, valueList, type PostShipmentStatus } from "./post-shipment-dashboard.js";
import { decimalQuantity, scaledQuantity, shipmentStatusSql } from "./shipment-lines.js";

/**
 * Clearance estimates: the BI "Import Clearance Estimations" section of the post-shipment dashboard, built only from
 * the post-shipment data of the IP (docs/PLANO_ESTIMATIVA_DESEMBARACO.md). The registration date is the DUIMP date of
 * a registered IP or, before the DUIMP, the ETA at the port; the amount is the taxes of the IP.
 */

/** Period filter of the BI: the next week by the reference date, or every IP. */
export const CLEARANCE_PERIODS = ["nextWeek", "all"] as const;
export type ClearancePeriod = (typeof CLEARANCE_PERIODS)[number];
/** Registered: the IP has a DUIMP. */
export const CLEARANCE_REGISTERED = ["yes", "no"] as const;
/** Where the reference date came from. */
export type ClearanceReferenceSource = "duimp" | "eta";

const dayMs = 86_400_000;
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);

/**
 * Monday to Sunday of the week after the week of `today`, both included. The BI starts the week on Monday
 * (`WEEKDAY(today, 2)`) and keeps the dates from the next Monday until before the Monday after it.
 */
export function nextWeekRange(today: string): { from: string; to: string } {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  const from = shift(today, 7 - weekday);
  return { from, to: shift(from, 6) };
}

export function isRegistered(duimpNumber: string | null, duimpDate: string | null): boolean {
  return Boolean(duimpNumber?.trim()) || Boolean(duimpDate);
}

/**
 * The date the IP is (or was) registered: the DUIMP date once registered; before it, the ETA at the port, since the
 * DUIMP is registered around the arrival. Null without both.
 */
export function referenceDate(duimpDate: string | null, eta: string | null):
  { date: string | null; source: ClearanceReferenceSource | null } {
  if (duimpDate) return { date: duimpDate, source: "duimp" };
  return eta ? { date: eta, source: "eta" } : { date: null, source: null };
}

/** A row of the IP query: dates and money are text (`::text`), so no time zone or float changes them. */
export type ClearanceEstimateRow = {
  id: string; ip_number: string; importer: string | null; analysts: string[] | null; taxes_paid_brl: string | null;
  supplier_name: string | null; transport_mode: string | null; etd: string | null; eta_confirmed: string | null;
  ete_confirmed: string | null; duimp_number: string | null; duimp_date: string | null; status: string;
};

/** A line of the table, as the route returns it. */
export type ClearanceEstimateLine = {
  id: string; ipNumber: string; referenceDate: string | null; referenceSource: ClearanceReferenceSource | null;
  analysts: string[]; importer: string | null; status: PostShipmentStatus; supplier: string | null; eta: string | null;
  registered: boolean; valueBrl: string | null;
};

const nonEmpty = (value: string | null) => value?.trim() ? value.trim() : null;
const collator = new Intl.Collator("pt-BR", { numeric: true });
const distinct = (values: (string | null)[]) => [...new Set(values.filter((value): value is string => value !== null))]
  .sort(collator.compare);

export function clearanceEstimateLine(row: ClearanceEstimateRow): ClearanceEstimateLine {
  const status = (POST_SHIPMENT_STATUSES as readonly string[]).includes(row.status)
    ? row.status as PostShipmentStatus : "AGUARDANDO PRODUÇÃO";
  const { eta } = shipmentDates({ transportMode: nonEmpty(row.transport_mode), etd: row.etd, etaConfirmed: row.eta_confirmed,
    eteConfirmed: row.ete_confirmed });
  const reference = referenceDate(row.duimp_date, eta);
  return {
    id: row.id, ipNumber: row.ip_number, referenceDate: reference.date, referenceSource: reference.source,
    analysts: distinct((row.analysts ?? []).map(nonEmpty)), importer: nonEmpty(row.importer), status,
    supplier: nonEmpty(row.supplier_name), eta, registered: isRegistered(row.duimp_number, row.duimp_date),
    valueBrl: row.taxes_paid_brl,
  };
}

export const clearanceEstimatesQuery = z.object({
  ipNumber: optionalText(80), analysts: textList(160), importers: textList(120), suppliers: textList(200),
  status: valueList(z.enum(POST_SHIPMENT_STATUSES)), registered: valueList(z.enum(CLEARANCE_REGISTERED)),
  period: z.enum(CLEARANCE_PERIODS).optional(),
});
export type ClearanceEstimateFilters = z.infer<typeof clearanceEstimatesQuery>;

const key = (value: string | null) => (value ?? "").trim().toLocaleLowerCase("pt-BR");
const among = (values: readonly string[] | undefined, ...found: (string | null)[]) =>
  !values?.length || values.some(item => found.some(value => key(item) === key(value)));

/**
 * The IPs with a reference date or an amount, of the filters, by the reference date (empty last) and the IP, with the
 * total of the amounts. The options are the values of every IP, so a filter never hides the other choices.
 */
export function selectClearanceEstimates(lines: readonly ClearanceEstimateLine[], filters: Partial<ClearanceEstimateFilters>,
  today: string) {
  const nextWeek = nextWeekRange(today);
  const ipNumber = key(filters.ipNumber ?? null);
  const universe = lines.filter(line => line.referenceDate !== null || line.valueBrl !== null);
  const selected = universe.filter(line => among(filters.analysts, ...line.analysts) && among(filters.importers, line.importer)
    && among(filters.suppliers, line.supplier) && (!filters.status?.length || filters.status.includes(line.status))
    && (!filters.registered?.length || filters.registered.includes(line.registered ? "yes" : "no"))
    && (!ipNumber || key(line.ipNumber).includes(ipNumber))
    && (filters.period !== "nextWeek" || (line.referenceDate !== null
      && line.referenceDate >= nextWeek.from && line.referenceDate <= nextWeek.to)))
    .sort((a, b) => (a.referenceDate ?? "9999-12-31").localeCompare(b.referenceDate ?? "9999-12-31")
      || collator.compare(a.ipNumber, b.ipNumber) || a.id.localeCompare(b.id));
  let total = 0n;
  for (const line of selected) if (line.valueBrl) total += scaledQuantity(line.valueBrl);
  return {
    lines: selected, totalBrl: decimalQuantity(total), nextWeek,
    options: { analysts: distinct(universe.flatMap(line => line.analysts)), importers: distinct(universe.map(line => line.importer)),
      suppliers: distinct(universe.map(line => line.supplier)) },
  };
}

/** Every IP of the user's importers with its post-shipment data and the analysts of its POs; deleted IPs stay out. */
const clearanceEstimatesSql = `WITH clearance_estimate_ip AS (
    SELECT p.id, p.ip_number, p.importer,
      (SELECT array_agg(DISTINCT po.analyst) FROM procurement.po_item_allocation AS a
        JOIN procurement.purchase_order_item AS item ON item.id = a.purchase_order_item_id
        JOIN procurement.purchase_order AS po ON po.id = item.purchase_order_id
        WHERE a.process_id = p.id AND a.status = 'ACTIVE' AND po.analyst IS NOT NULL) AS analysts,
      p.taxes_paid_brl::text AS taxes_paid_brl,
      coalesce(nullif(btrim(supplier.name), ''), nullif(btrim(p.supplier_text), '')) AS supplier_name,
      p.transport_mode, p.etd::text AS etd, p.eta_confirmed::text AS eta_confirmed, p.ete_confirmed::text AS ete_confirmed,
      p.duimp_number, p.duimp_date::text AS duimp_date,
      CASE WHEN p.record_status = 'CANCELLED' THEN 'CANCELADO' ELSE ${shipmentStatusSql("p", null)} END AS status
    FROM imports.import_process AS p
    LEFT JOIN catalog.entry AS supplier ON supplier.id = p.supplier_entry_id
    WHERE p.importer = ANY($1::text[]) AND p.record_status <> 'DELETED'
  )
  SELECT * FROM clearance_estimate_ip`;

export async function queryClearanceEstimates(pool: Pool, scopes: readonly string[], filters: ClearanceEstimateFilters,
  today = todayInBrasilia()) {
  const result = await pool.query<ClearanceEstimateRow>(clearanceEstimatesSql, [scopes]);
  return selectClearanceEstimates(result.rows.map(clearanceEstimateLine), filters, today);
}

function invalidQuery(request: FastifyRequest, reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ type: "about:blank", title: "Parâmetros inválidos", status: 400,
    detail: "Revise os filtros.", instance: request.url.split("?", 1)[0], traceId: request.id,
    code: "INVALID_QUERY", errors: error.flatten().fieldErrors });
}

/**
 * Clearance estimates route. One light query of the IPs (no product line is calculated), so it does not wait in the
 * gate of the heavy calculations.
 */
export async function registerClearanceEstimateRoutes(app: FastifyInstance, pool: Pool,
  today: () => string = () => todayInBrasilia()): Promise<void> {
  app.get("/api/v1/reports/post-shipment/clearance-estimates", { config: permissionConfig("processes.read") },
    async (request, reply) => {
      const parsed = clearanceEstimatesQuery.strict().safeParse(request.query);
      if (!parsed.success) return invalidQuery(request, reply, parsed.error);
      const result = await queryClearanceEstimates(pool, request.authorizationContext?.importerScopes ?? [], parsed.data,
        today());
      reply.header("Cache-Control", "no-store");
      return result;
    });
}
