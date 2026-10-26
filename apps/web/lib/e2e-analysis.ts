import type { E2eFlowConfig } from "./e2e-flow";

/**
 * End-to-end analysis of one PO: the E2E model (T0 plan at D-horizon, then T1–T5) is laid
 * out forward from the plan date for each IP and compared with the dates the PO and the
 * IP actually reached. Forecasts (ETD, ETA, ETE) stand in for steps not reached yet.
 */
export type E2eStageCode = "T1" | "T2" | "T3" | "T4" | "T5";
export type E2eMilestoneKey = "plan" | "sc" | "po" | "shipment" | "arrival" | "delivery";
export type E2eDemandKind = "mts" | "notMts" | "unknown";
export type E2eSource = "actual" | "forecast";

export type E2eAnalysisItem = {
  id: string; productCode: string; orderedQuantity: string; demandType?: string | null;
  necessityDate?: string | null; commercialPlanReceivedDate?: string | null;
  scApprovalDate?: string | null; poSentDate?: string | null;
};
export type E2eAnalysisProcess = {
  id: string; ipNumber: string; transportMode?: string | null; etd?: string | null; blDate?: string | null;
  actualPortDepartureDate?: string | null; arrivalDate?: string | null; deliveryDate?: string | null;
};
export type E2eAnalysisInput = {
  items: E2eAnalysisItem[];
  processes: { process: E2eAnalysisProcess; calculated: { status: string; eta?: string | null; ete?: string | null } }[];
  shipments: { itemId: string; allocationQuantity: string; factoryShipDate?: string | null; process: { id: string } }[];
};

export type E2ePoint = { planned: string | null; date: string | null; source: E2eSource | null; deviation: number | null };
export type E2eStage = { code: E2eStageCode; planned: number; actual: number | null; deviation: number | null; source: E2eSource | null };
export type E2eBar = { code: E2eStageCode; source: E2eSource; left: number; width: number };
export type E2eIpAnalysis = {
  processId: string; ipNumber: string; status: string; air: boolean; demandType: E2eDemandKind;
  missingDemandType: number; lines: number; necessityDate: string | null;
  milestones: Record<E2eMilestoneKey, E2ePoint>; stages: E2eStage[]; bars: E2eBar[]; plannedBar: { left: number; width: number } | null;
  slack: number | null; plannedSlack: number | null; late: boolean; currentStage: E2eStageCode | null;
};

export const E2E_STAGE_CODES: readonly E2eStageCode[] = ["T1", "T2", "T3", "T4", "T5"];
const milestoneKeys: readonly E2eMilestoneKey[] = ["plan", "sc", "po", "shipment", "arrival", "delivery"];
const dayMs = 86_400_000;

function isoDate(value: string | null | undefined): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(0, 10) : null;
}
function time(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}
function addDays(value: string | null, days: number): string | null {
  return value === null ? null : new Date(time(value) + days * dayMs).toISOString().slice(0, 10);
}
/** Whole days from `from` to `to` (negative when `to` comes first); null when a date is missing. */
export function e2eDaysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const start = isoDate(from); const end = isoDate(to);
  return start === null || end === null ? null : Math.round((time(end) - time(start)) / dayMs);
}
/** Short date in the reader's language (dd/mm/aa in pt-BR); the API dates carry no time zone. */
export function formatE2eDate(value: string | null | undefined, locale: string): string {
  const date = isoDate(value);
  return date === null ? "—" : new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" })
    .format(new Date(time(date)));
}
/** Today in Brasília, the reference for what is actual and what is still a forecast. */
export function e2eToday(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const earliest = (values: (string | null | undefined)[]) => values.map(isoDate).filter((value): value is string => value !== null).sort()[0] ?? null;
const latest = (values: (string | null | undefined)[]) => values.map(isoDate).filter((value): value is string => value !== null).sort().at(-1) ?? null;

/** MTS or Não MTS from the DEMAND_TYPE list; anything else is unknown. */
export function demandTypeKind(value: string | null | undefined): E2eDemandKind {
  const text = (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase();
  return text === "MTS" ? "mts" : text === "NAO MTS" ? "notMts" : "unknown";
}

// The stage an IP is in, from the status the API calculates.
const stageByStatus: Record<string, E2eStageCode> = {
  "AGUARDANDO PRODUÇÃO": "T3", "AGUARDANDO EMBARQUE": "T3", "AGUARDANDO CHEGADA": "T4", "DESEMBARAÇO": "T5", // i18n-ignore: API values
};

function point(planned: string | null, actual: string | null, forecast: string | null): E2ePoint {
  const date = actual ?? forecast;
  return { planned, date, source: actual ? "actual" : forecast ? "forecast" : null, deviation: e2eDaysBetween(planned, date) };
}

export function analyzePurchaseOrderE2e(input: E2eAnalysisInput, config: E2eFlowConfig, today: string) {
  const itemsById = new Map(input.items.map(item => [item.id, item]));
  const necessityDate = earliest(input.items.map(item => item.necessityDate));
  const allocated = new Map<string, number>();
  for (const shipment of input.shipments) {
    allocated.set(shipment.itemId, (allocated.get(shipment.itemId) ?? 0) + Number(shipment.allocationQuantity));
  }

  const ips = input.processes.map(({ process, calculated }) => {
    const shipments = input.shipments.filter(shipment => shipment.process.id === process.id);
    const items = shipments.map(shipment => itemsById.get(shipment.itemId)).filter((item): item is E2eAnalysisItem => Boolean(item));
    const kinds = items.map(item => demandTypeKind(item.demandType));
    // The IP leaves the HQ when its slowest item is ready; an unknown type is planned as Não MTS.
    const demandType: E2eDemandKind = kinds.length && kinds.every(kind => kind === "mts") ? "mts"
      : kinds.some(kind => kind === "notMts") ? "notMts" : "unknown";
    const air = /^(AIR|AEREO|AÉREO|COURIER)$/iu.test((process.transportMode ?? "").trim());
    const ipNeed = earliest(items.map(item => item.necessityDate)) ?? necessityDate;
    const production = demandType === "mts" ? config.prodMts : config.prodNaoMts;
    const durations = [config.sc, config.po, production, air ? config.aereo : config.maritimo, config.desembaraco];

    const planned: Partial<Record<E2eMilestoneKey, string | null>> = { plan: addDays(ipNeed, -config.horizonte) };
    durations.forEach((days, index) => { planned[milestoneKeys[index + 1]] = addDays(planned[milestoneKeys[index]] ?? null, days); });
    const shipped = isoDate(process.actualPortDepartureDate) ?? (isoDate(process.blDate) ? isoDate(process.etd) ?? isoDate(process.blDate) : null);
    const milestones: Record<E2eMilestoneKey, E2ePoint> = {
      plan: point(planned.plan ?? null, earliest(items.map(item => item.commercialPlanReceivedDate)), null),
      sc: point(planned.sc ?? null, latest(items.map(item => item.scApprovalDate)), null),
      po: point(planned.po ?? null, latest(items.map(item => item.poSentDate)), null),
      shipment: point(planned.shipment ?? null, shipped, isoDate(process.etd) ?? latest(shipments.map(shipment => shipment.factoryShipDate))),
      arrival: point(planned.arrival ?? null, isoDate(process.arrivalDate), isoDate(calculated.eta)),
      delivery: point(planned.delivery ?? null, isoDate(process.deliveryDate), isoDate(calculated.ete)),
    };
    const stages: E2eStage[] = E2E_STAGE_CODES.map((code, index) => {
      const from = milestones[milestoneKeys[index]]; const to = milestones[milestoneKeys[index + 1]];
      const actual = e2eDaysBetween(from.date, to.date);
      return { code, planned: durations[index], actual, deviation: actual === null ? null : actual - durations[index],
        source: actual === null ? null : from.source === "forecast" || to.source === "forecast" ? "forecast" : "actual" };
    });
    const slack = e2eDaysBetween(milestones.delivery.date, ipNeed);
    const ip: E2eIpAnalysis = {
      processId: process.id, ipNumber: process.ipNumber, status: calculated.status, air, demandType,
      missingDemandType: kinds.filter(kind => kind === "unknown").length, lines: shipments.length, necessityDate: ipNeed,
      milestones, stages, bars: [], plannedBar: null, slack, plannedSlack: e2eDaysBetween(planned.delivery ?? null, ipNeed),
      late: slack !== null && slack < 0, currentStage: isoDate(process.deliveryDate) ? null : stageByStatus[calculated.status] ?? null,
    };
    return ip;
  });

  // Timeline from the earliest plan date to the latest date shown, as percentages.
  const dates = ips.flatMap(ip => milestoneKeys.flatMap(key => [ip.milestones[key].planned, ip.milestones[key].date]));
  const start = earliest(dates); const end = latest([...dates, necessityDate]);
  const span = start && end ? Math.max(1, e2eDaysBetween(start, end) ?? 1) : 1;
  const position = (date: string | null) => start && date ? (e2eDaysBetween(start, date) ?? 0) / span * 100 : 0;
  for (const ip of ips) {
    ip.bars = E2E_STAGE_CODES.flatMap((code, index) => {
      const from = ip.milestones[milestoneKeys[index]].date; const to = ip.milestones[milestoneKeys[index + 1]].date;
      const source = ip.stages[index].source;
      return from && to && source ? [{ code, source, left: position(from), width: Math.max(0, position(to) - position(from)) }] : [];
    });
    const plannedFrom = ip.milestones.plan.planned; const plannedTo = ip.milestones.delivery.planned;
    ip.plannedBar = plannedFrom && plannedTo ? { left: position(plannedFrom), width: position(plannedTo) - position(plannedFrom) } : null;
  }

  const lineSlack = input.shipments.map(shipment => ips.find(ip => ip.processId === shipment.process.id)?.slack ?? null);
  const worst = ips.filter(ip => ip.slack !== null).sort((left, right) => (left.slack ?? 0) - (right.slack ?? 0))[0];
  const stageDeviation = Object.fromEntries(E2E_STAGE_CODES.map((code, index) => {
    const values = ips.map(ip => ip.stages[index].deviation).filter((value): value is number => value !== null);
    return [code, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null];
  })) as Record<E2eStageCode, number | null>;
  const worstStage = E2E_STAGE_CODES.filter(code => (stageDeviation[code] ?? 0) > 0)
    .sort((left, right) => (stageDeviation[right] ?? 0) - (stageDeviation[left] ?? 0))[0] ?? null;
  const firstPlan = earliest(ips.map(ip => ip.milestones.plan.date));
  const lastDelivery = latest(ips.map(ip => ip.milestones.delivery.date));

  return {
    necessityDate, ips,
    summary: {
      lines: input.shipments.length,
      onTimeLines: lineSlack.filter(value => value !== null && value >= 0).length,
      lateLines: lineSlack.filter(value => value !== null && value < 0).length,
      unallocatedItems: input.items.filter(item => (allocated.get(item.id) ?? 0) < Number(item.orderedQuantity)).length,
      deliveredIps: ips.filter(ip => ip.milestones.delivery.source === "actual").length, ips: ips.length,
      worstIp: worst?.ipNumber ?? null, worstSlack: worst?.slack ?? null,
      leadTime: e2eDaysBetween(firstPlan, lastDelivery), stageDeviation, worstStage,
    },
    timeline: { start, end, today, position, todayPosition: start && end && today >= start && today <= end ? position(today) : null,
      needPosition: necessityDate && start ? position(necessityDate) : null },
  };
}
export type E2ePoAnalysis = ReturnType<typeof analyzePurchaseOrderE2e>;
