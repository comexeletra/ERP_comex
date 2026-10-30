/**
 * End to End of the original spreadsheet, as calculated by the API for each product line
 * (`calculated.e2e`): T0 due four months before the need date plus four days, each later stage due at the
 * previous actual end plus its target, delay = actual days − target days. This module only
 * formats and aggregates those lines; it never recalculates the rules.
 */
export const E2E_STAGE_CODES = ["T0", "T1", "T2", "T3", "T4", "T5"] as const;
export type E2eStageCode = typeof E2E_STAGE_CODES[number];
export type E2eSource = "actual" | "forecast";
export type E2eDemandKind = "mts" | "notMts" | "unknown";
export type E2eStage = {
  deadline: string | null; actual: string | null; source: E2eSource | null;
  targetDays: number | null; actualDays: number | null; delayDays: number | null;
  /** Sum of the stage delays from T0 up to this stage; null once one of them is unknown. */
  accumulatedDelayDays?: number | null;
};
export type E2eResult = {
  targetSetValidFrom: string; demandType: E2eDemandKind; air: boolean | null; stages: Record<E2eStageCode, E2eStage>;
  totalTargetDays: number | null; totalActualDays: number | null; totalDelayDays: number | null;
  bottleneck: E2eStageCode | null; currentStatus: string; arrivalYearMonth: string | null;
  /** Stage after the last actual date (null when delivered or cancelled) and whether its deadline has passed. */
  currentStage?: E2eStageCode | null; currentStageLate?: boolean;
};

export type E2eAnalysisInput = {
  items: { id: string; orderedQuantity: string; necessityDate?: string | null }[];
  processes: { process: { id: string; ipNumber: string }; calculated: { status: string } }[];
  shipments: { itemId: string; allocationQuantity: string; process: { id: string }; calculated: { e2e?: E2eResult | null } }[];
};
export type E2eBar = { code: E2eStageCode; source: E2eSource; left: number; width: number };
export type E2eIpStage = { code: E2eStageCode; targetDays: number | null; delayDays: number | null };
export type E2eIpAnalysis = {
  processId: string; ipNumber: string; status: string; air: boolean | null; demandType: E2eDemandKind;
  lines: number; e2e: E2eResult; stages: E2eIpStage[]; slack: number | null; late: boolean;
  currentStage: E2eStageCode | null; bars: E2eBar[]; plannedBar: { left: number; width: number } | null;
};

const dayMs = 86_400_000;
function isoDate(value: string | null | undefined): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(0, 10) : null;
}
function time(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}
function addDays(value: string | null, days: number | null): string | null {
  return value === null || days === null ? null : new Date(time(value) + days * dayMs).toISOString().slice(0, 10);
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
/**
 * Class of a stage's actual date: italic when forecast, blue up to the deadline shown beside it and red after it,
 * neutral without one of the two dates. It compares the dates instead of reading the delay because the T0 delay
 * subtracts the target from the days past the deadline.
 */
export function e2eDateClass(stage: E2eStage | null | undefined): string {
  const actual = isoDate(stage?.actual); const deadline = isoDate(stage?.deadline);
  const status = actual === null || deadline === null ? "" : actual > deadline ? " is-late" : " is-on-time";
  return `e2e-date${stage?.source === "forecast" ? " is-forecast" : ""}${status}`;
}
/** Today in Brasília, the reference for what is actual and what is still a forecast. */
export function e2eToday(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const earliest = (values: (string | null | undefined)[]) => values.map(isoDate).filter((value): value is string => value !== null).sort()[0] ?? null;
const latest = (values: (string | null | undefined)[]) => values.map(isoDate).filter((value): value is string => value !== null).sort().at(-1) ?? null;
const average = (values: (number | null)[]) => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
};

// The stage an IP is in, from the status the API calculates.
const stageByStatus: Record<string, E2eStageCode> = {
  "AGUARDANDO PRODUÇÃO": "T3", "AGUARDANDO EMBARQUE": "T3", "AGUARDANDO CHEGADA": "T4", "DESEMBARAÇO": "T5", // i18n-ignore: API values
};

/** Aggregates the E2E of every product line of a PO by IP, against the need date of each line. */
export function analyzePurchaseOrderE2e(input: E2eAnalysisInput, today: string) {
  const need = new Map(input.items.map(item => [item.id, isoDate(item.necessityDate)]));
  const lines = input.shipments.filter(shipment => shipment.calculated.e2e).map(shipment => {
    const e2e = shipment.calculated.e2e as E2eResult;
    return { shipment, e2e, slack: e2eDaysBetween(e2e.stages.T5.actual, need.get(shipment.itemId) ?? null) };
  });
  const allocated = new Map<string, number>();
  for (const shipment of input.shipments) {
    allocated.set(shipment.itemId, (allocated.get(shipment.itemId) ?? 0) + Number(shipment.allocationQuantity));
  }

  const ips: E2eIpAnalysis[] = input.processes.flatMap(({ process, calculated }) => {
    const mine = lines.filter(line => line.shipment.process.id === process.id);
    if (!mine.length) return [];
    // The line that reaches the factory last speaks for the IP; ties go to the larger delay.
    const representative = [...mine].sort((left, right) =>
      (right.e2e.stages.T5.actual ?? "").localeCompare(left.e2e.stages.T5.actual ?? "")
      || (right.e2e.totalDelayDays ?? 0) - (left.e2e.totalDelayDays ?? 0))[0];
    const slacks = mine.map(line => line.slack).filter((value): value is number => value !== null);
    const slack = slacks.length ? Math.min(...slacks) : null;
    return [{
      processId: process.id, ipNumber: process.ipNumber, status: calculated.status,
      air: representative.e2e.air, demandType: representative.e2e.demandType, lines: mine.length, e2e: representative.e2e,
      stages: E2E_STAGE_CODES.map(code => ({ code, targetDays: representative.e2e.stages[code].targetDays,
        delayDays: average(mine.map(line => line.e2e.stages[code].delayDays)) })),
      slack, late: slack !== null && slack < 0,
      currentStage: representative.e2e.stages.T5.source === "actual" ? null : stageByStatus[calculated.status] ?? null,
      bars: [], plannedBar: null,
    }];
  });

  // Timeline from the earliest T0 date to the latest date shown, as percentages.
  const dates = lines.flatMap(line => [line.e2e.stages.T0.deadline, line.e2e.stages.T0.actual, line.e2e.stages.T5.actual,
    addDays(line.e2e.stages.T0.deadline, line.e2e.totalTargetDays)]);
  const start = earliest(dates);
  const end = latest([...dates, ...input.items.map(item => item.necessityDate)]);
  const span = start && end ? Math.max(1, e2eDaysBetween(start, end) ?? 1) : 1;
  const position = (date: string | null) => start && date ? (e2eDaysBetween(start, date) ?? 0) / span * 100 : 0;
  for (const ip of ips) {
    const stages = ip.e2e.stages;
    ip.bars = E2E_STAGE_CODES.slice(1).flatMap((code, index) => {
      const from = stages[E2E_STAGE_CODES[index]].actual; const to = stages[code].actual; const source = stages[code].source;
      return from && to && source ? [{ code, source: stages[E2E_STAGE_CODES[index]].source === "forecast" ? "forecast" as const : source,
        left: position(from), width: Math.max(0, position(to) - position(from)) }] : [];
    });
    const plannedEnd = addDays(stages.T0.deadline, ip.e2e.totalTargetDays);
    ip.plannedBar = stages.T0.deadline && plannedEnd
      ? { left: position(stages.T0.deadline), width: position(plannedEnd) - position(stages.T0.deadline) } : null;
  }

  const necessityDate = earliest(input.items.map(item => item.necessityDate));
  const worst = ips.filter(ip => ip.slack !== null).sort((left, right) => (left.slack ?? 0) - (right.slack ?? 0))[0];
  const stageDeviation = Object.fromEntries(E2E_STAGE_CODES.map(code =>
    [code, average(lines.map(line => line.e2e.stages[code].delayDays))])) as Record<E2eStageCode, number | null>;
  const worstStage = E2E_STAGE_CODES.filter(code => (stageDeviation[code] ?? 0) > 0)
    .sort((left, right) => (stageDeviation[right] ?? 0) - (stageDeviation[left] ?? 0))[0] ?? null;
  return {
    necessityDate, ips,
    summary: {
      lines: lines.length,
      onTimeLines: lines.filter(line => line.slack !== null && line.slack >= 0).length,
      lateLines: lines.filter(line => line.slack !== null && line.slack < 0).length,
      unallocatedItems: input.items.filter(item => (allocated.get(item.id) ?? 0) < Number(item.orderedQuantity)).length,
      deliveredIps: ips.filter(ip => ip.e2e.stages.T5.source === "actual").length, ips: ips.length,
      worstIp: worst?.ipNumber ?? null, worstSlack: worst?.slack ?? null,
      leadTime: e2eDaysBetween(earliest(lines.map(line => line.e2e.stages.T0.actual)), latest(lines.map(line => line.e2e.stages.T5.actual))),
      stageDeviation, worstStage,
    },
    timeline: { start, end, today, position,
      todayPosition: start && end && today >= start && today <= end ? position(today) : null,
      needPosition: necessityDate && start ? position(necessityDate) : null },
  };
}
export type E2ePoAnalysis = ReturnType<typeof analyzePurchaseOrderE2e>;
