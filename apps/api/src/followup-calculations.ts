type Row = Record<string, unknown>;
const dayMs = 86_400_000;
function date(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  return null;
}
function epoch(value: unknown): number | null {
  const day = date(value);
  if (!day) return null;
  const parsed = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}
function addDays(value: unknown, days: number | null): string | null {
  const start = epoch(value);
  if (start === null || days === null) return null;
  return new Date(start + days * dayMs).toISOString().slice(0, 10);
}
function daysBetween(start: unknown, end: unknown): number | null {
  const first = epoch(start); const last = epoch(end);
  return first === null || last === null ? null : Math.round((last - first) / dayMs);
}
function monthShift(value: unknown, months: number): string | null {
  const original = date(value);
  if (!original) return null;
  const [year, month, day] = original.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay)))
    .toISOString().slice(0, 10);
}
function fixed8(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(String(value));
  return match ? BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? "").padEnd(8, "0")) : null;
}
export function moneyProduct(quantity: unknown, price: unknown): string | null {
  const q = fixed8(quantity); const p = fixed8(price);
  if (q === null || p === null) return null;
  const value = (q * p + 50_000_000n) / 100_000_000n;
  return `${value / 100_000_000n}.${String(value % 100_000_000n).padStart(8, "0")}`;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
/** Status comes from the IP dates; an informed status only prevails when it cancels the shipment. */
function shipmentStatus(process: Row, hasInvoice: boolean) {
  const informedStatus = text(process.logisticsStatus);
  if (informedStatus && /^(CANCELLED|CANCELED|CANCELADO)$/i.test(informedStatus)) {
    return { status: "CANCELADO", statusSource: "informed", informedStatus, cancelled: true, delivered: false };
  }
  const delivered = Boolean(date(process.deliveryDate));
  const status = delivered ? "ENTREGUE" : !hasInvoice ? "AGUARDANDO PRODUÇÃO" :
    !date(process.blDate) ? "AGUARDANDO EMBARQUE" : !date(process.arrivalDate) ? "AGUARDANDO CHEGADA" : "DESEMBARAÇO";
  return { status, statusSource: "calculated", informedStatus, cancelled: false, delivered };
}
function shipmentDates(process: Row) {
  const mode = text(process.transportMode) ?? "";
  const sea = /^(SEA|MARITIMO|MARÍTIMO)$/i.test(mode);
  const etaConfirmed = date(process.etaConfirmed);
  const eta = etaConfirmed ?? (mode ? addDays(process.etd, sea ? 55 : 10) : null);
  const eteConfirmed = date(process.eteConfirmed);
  const ete = eteConfirmed ?? addDays(eta, 10);
  return {
    eta, etaSource: eta === null ? null : etaConfirmed ? "confirmed" : "calculated",
    ete, eteSource: ete === null ? null : eteConfirmed ? "confirmed" : "calculated",
    transitDays: daysBetween(process.etd, eta),
    storageDueDate: date(process.storageDueOverride) ?? (mode ? addDays(process.arrivalDate, sea ? 9 : 5) : null),
  };
}

/** Status and projected dates of the IP itself, shared by every product line in it. */
export function calculateProcess(process: Row, documents: Row[]) {
  const hasInvoice = documents.some(doc => doc.status === "ACTIVE" && doc.kind === "INVOICE");
  const { status, statusSource, informedStatus } = shipmentStatus(process, hasInvoice);
  return { status, statusSource, informedStatus, ...shipmentDates(process) };
}

// Effective dates that cannot happen out of order block an edit; estimates and
// steps that may legitimately overlap (early customs registration) only warn.
const shipmentDateRules: { earlier: string; later: string; message: string; blocking: boolean }[] = [
  { earlier: "etd", later: "etaConfirmed", message: "ETA confirmada antes do ETD", blocking: true },
  { earlier: "actualPortDepartureDate", later: "arrivalDate",
    message: "Chegada efetiva antes da saída do porto (Departure)", blocking: true },
  { earlier: "arrivalDate", later: "deliveryDate", message: "Entrega efetiva antes da chegada efetiva", blocking: true },
  { earlier: "etd", later: "arrivalDate", message: "Chegada efetiva antes do ETD", blocking: false },
  { earlier: "arrivalDate", later: "clearanceDate", message: "Desembaraço antes da chegada efetiva", blocking: false },
  { earlier: "etaConfirmed", later: "eteConfirmed", message: "ETE confirmada antes da ETA confirmada", blocking: false },
];

/**
 * Checks the IP dates after applying `changes` to `current`. A blocking rule only
 * rejects the edit when the edit changes one of its dates, so IPs that already hold
 * an inconsistent pair can still be updated; those pairs come back as warnings.
 */
export function checkShipmentDates(current: Row, changes: Row) {
  const next = { ...current, ...changes };
  const changed = (key: string) => key in changes && date(changes[key]) !== date(current[key]);
  const errors: string[] = []; const warnings: string[] = [];
  for (const rule of shipmentDateRules) {
    const earlier = date(next[rule.earlier]); const later = date(next[rule.later]);
    if (!earlier || !later || later >= earlier) continue;
    if (rule.blocking && (changed(rule.earlier) || changed(rule.later))) errors.push(rule.message);
    else warnings.push(rule.message);
  }
  return { errors, warnings };
}

/** Days each End to End stage may take; the administrator keeps sets valid from a necessity date. */
export type E2eTargetSet = {
  validFrom: string; t0Days: number; t1Days: number; t2Days: number; t3MtsDays: number; t3NotMtsDays: number;
  t4SeaDays: number; t4AirDays: number; t5Days: number;
};
export const DEFAULT_E2E_TARGET_SET: E2eTargetSet = Object.freeze({
  validFrom: "2000-01-01", t0Days: 8, t1Days: 8, t2Days: 7, t3MtsDays: 30, t3NotMtsDays: 45,
  t4SeaDays: 55, t4AirDays: 10, t5Days: 10,
});
export const E2E_STAGE_CODES = ["T0", "T1", "T2", "T3", "T4", "T5"] as const;
export type E2eStageCode = typeof E2E_STAGE_CODES[number];
export type E2eDeadlineStatus = "onTime" | "onLimit" | "late" | "noData";

/** Power BI's in_time_late rule, applied to the total End to End delay. */
export function e2eDeadlineStatus(e2e: { totalDelayDays: number | null } | null): E2eDeadlineStatus {
  if (e2e?.totalDelayDays === null || e2e === null) return "noData";
  if (e2e.totalDelayDays > 0) return "late";
  if (e2e.totalDelayDays === 0) return "onLimit";
  return "onTime";
}

/** The set with the latest start on or before the line's necessity date (today when it has none). */
export function e2eTargetSetFor(sets: readonly E2eTargetSet[], necessityDate: unknown, today: string): E2eTargetSet {
  const reference = date(necessityDate) ?? today;
  return [...sets].filter(set => set.validFrom <= reference).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]
    ?? DEFAULT_E2E_TARGET_SET;
}

function demandTypeKind(value: unknown): "mts" | "notMts" | "unknown" {
  const normalized = (text(value) ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
  return normalized === "MTS" ? "mts" : normalized === "NAO MTS" ? "notMts" : "unknown";
}

/**
 * End to End stages of the original spreadsheet for one product line. T0 is due four months
 * before the need date; every later stage is due at the previous stage's actual end plus its
 * target. Stages not reached yet end at the forecast (ETD, ETA, ETE) and say so in `source`.
 * Delay = actual days − target days (T0: actual days = plan received − T0 deadline).
 * The line is in the stage after its last actual date (a missing date in the middle does not
 * pull it back) and late there once `today` passes that stage's deadline. Delivered and
 * cancelled lines have no current stage.
 */
export function calculateE2e(item: Row, process: Row, status: string, targets: E2eTargetSet, factoryShipDate: unknown,
  today = todayInBrasilia()) {
  const demandType = demandTypeKind(item.demandType);
  const mode = text(process.transportMode)?.toUpperCase() ?? null;
  const air = mode === null ? null : /^(AIR|AEREO|AÉREO|COURIER)$/u.test(mode);
  const { eta, ete } = shipmentDates(process);
  const shipped = date(process.actualPortDepartureDate) ?? (date(process.blDate) ? date(process.etd) ?? date(process.blDate) : null);
  const ends: [string | null, string | null][] = [
    [date(item.commercialPlanReceivedDate), null],
    [date(item.scApprovalDate), null],
    [date(item.poSentDate), null],
    [shipped, date(process.etd) ?? date(factoryShipDate)],
    [date(process.arrivalDate), eta],
    [date(process.deliveryDate), ete],
  ];
  const targetDays = [targets.t0Days, targets.t1Days, targets.t2Days,
    demandType === "mts" ? targets.t3MtsDays : targets.t3NotMtsDays,
    air === null ? null : air ? targets.t4AirDays : targets.t4SeaDays, targets.t5Days];
  let previousEnd: string | null = null;
  let accumulated: number | null = 0;
  const stages = Object.fromEntries(E2E_STAGE_CODES.map((code, index) => {
    const [actualEnd, forecastEnd] = ends[index];
    const end = actualEnd ?? forecastEnd;
    const target = targetDays[index];
    const deadline = index === 0 ? monthShift(item.necessityDate, -4) : target === null ? null : addDays(previousEnd, target);
    const actualDays = index === 0 ? daysBetween(deadline, end) : daysBetween(previousEnd, end);
    const delayDays = actualDays === null || target === null ? null : actualDays - target;
    accumulated = accumulated === null || delayDays === null ? null : accumulated + delayDays;
    const stage = { deadline, actual: end, source: actualEnd ? "actual" : forecastEnd ? "forecast" : null, targetDays: target,
      actualDays, delayDays, accumulatedDelayDays: accumulated };
    previousEnd = end;
    return [code, stage];
  })) as Record<E2eStageCode, { deadline: string | null; actual: string | null; source: "actual" | "forecast" | null;
    targetDays: number | null; actualDays: number | null; delayDays: number | null; accumulatedDelayDays: number | null }>;
  const lastActual = E2E_STAGE_CODES.map(code => stages[code].source).lastIndexOf("actual");
  const currentStage = status === "CANCELADO" || lastActual === E2E_STAGE_CODES.length - 1 ? null
    : E2E_STAGE_CODES[lastActual + 1];
  const currentDeadline = currentStage ? stages[currentStage].deadline : null;
  const values = Object.values(stages);
  const totalTargetDays = values.every(stage => stage.targetDays !== null) ? values.reduce((sum, stage) => sum + stage.targetDays!, 0) : null;
  const totalActualDays = values.every(stage => stage.actualDays !== null) ? values.reduce((sum, stage) => sum + stage.actualDays!, 0) : null;
  const delayed = E2E_STAGE_CODES.filter(code => (stages[code].delayDays ?? 0) > 0);
  return {
    targetSetValidFrom: targets.validFrom, demandType, air, stages, totalTargetDays, totalActualDays,
    totalDelayDays: totalTargetDays === null || totalActualDays === null ? null : totalActualDays - totalTargetDays,
    bottleneck: delayed.sort((a, b) => stages[b].delayDays! - stages[a].delayDays!)[0] ?? null,
    currentStatus: status, arrivalYearMonth: stages.T4.actual?.slice(0, 7) ?? null,
    currentStage, currentStageLate: currentDeadline !== null && today > currentDeadline,
  };
}

/** Today in Brasília (YYYY-MM-DD), the reference for alerts, forecasts and target sets. */
export function todayInBrasilia(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Spreadsheet rules expressed against the item and its one shipment (IP). */
export function calculateFollowup(item: Row, process: Row, documents: Row[], today = todayInBrasilia(),
  targetSets: readonly E2eTargetSet[] = [DEFAULT_E2E_TARGET_SET]) {
  const active = documents.filter(doc => doc.status === "ACTIVE");
  const invoices = active.filter(doc => doc.kind === "INVOICE" &&
    (doc.purchaseOrderItemId === item.id || doc.purchaseOrderItemId == null));
  const nfs = active.filter(doc => doc.kind === "NF" &&
    (doc.purchaseOrderItemId === item.id || doc.purchaseOrderItemId == null));
  // One IP is one shipment: the BL typed on the IP applies to every item in it.
  const firstBillDate = date(process.blDate);
  const billNumber = typeof process.blNumber === "string" && process.blNumber.trim() ? process.blNumber.trim() : null;
  const firstNfDate = nfs.map(doc => date(doc.issueDate)).filter((v): v is string => Boolean(v)).sort()[0] ?? null;
  const firstNf = [...nfs].sort((left, right) =>
    (date(left.issueDate) ?? "9999-12-31").localeCompare(date(right.issueDate) ?? "9999-12-31"))[0];
  const invoiceNumbers = [...new Set(invoices.map(doc => text(doc.number)).filter((v): v is string => Boolean(v)))].sort();
  const dates = shipmentDates(process);
  const { eta, ete } = dates;
  const shipping = shipmentStatus(process, invoices.length > 0);
  const { cancelled, delivered } = shipping;
  let alert = "—";
  if (!cancelled && !delivered) {
    if (!firstBillDate && (!date(process.etd) || daysBetween(process.etd, today)! >= 0)) alert = "Conferir data de embarque";
    else if (!date(process.arrivalDate) && eta && daysBetween(eta, today)! >= 0) alert = "Conferir chegada da carga";
    else if (date(process.arrivalDate) && !date(process.duimpDate)) alert = "Conferir registro da DUIMP";
    else if (date(process.duimpDate) && !date(process.clearanceDate)) alert = "Conferir desembaraço";
    else if (date(process.clearanceDate) && !date(process.nfRequestDate)) alert = "Conferir solicitação de NF";
    else if (date(process.nfRequestDate) && !firstNfDate) alert = "Conferir emissão da NF";
    else if (firstNfDate && !date(process.deliveryDate)) alert = "Conferir entrega";
  }
  const necessity = date(item.necessityDate);
  const risk = cancelled || delivered || !ete || !necessity ? null :
    daysBetween(ete, addDays(necessity, -7))! < 0 ? "RUPTURA" : "SEM RISCO";
  const scApproval = date(item.scApprovalDate);
  const poSent = date(item.poSentDate);
  const e2e = calculateE2e(item, process, shipping.status, e2eTargetSetFor(targetSets, necessity, today), item.actualFactoryShipDate,
    today);
  const invoiceLines = invoices.filter(doc => doc.purchaseOrderItemId === item.id);
  const invoiceQuantity = invoiceLines.length && invoiceLines.every(doc => fixed8(doc.quantity) !== null)
    ? invoiceLines.reduce((sum, doc) => sum + fixed8(doc.quantity)!, 0n) : null;
  const allocationQuantity = fixed8(item.allocationQuantity);
  const invoicePrices = invoiceLines.map(doc => doc.unitPrice).filter(value => value !== null && value !== undefined);
  const invoiceUnitPrice = invoicePrices.length && invoicePrices.every(price => fixed8(price) === fixed8(invoicePrices[0]))
    ? String(invoicePrices[0]) : null;
  return {
    totalPrice: moneyProduct(item.orderedQuantity, item.unitPrice), currency: item.currencyCode ?? null,
    eta, etaSource: dates.etaSource, ete, eteSource: dates.eteSource, transitDays: dates.transitDays,
    storageDueDate: dates.storageDueDate,
    status: shipping.status, statusSource: shipping.statusSource, informedStatus: shipping.informedStatus,
    alert, ruptureRisk: risk,
    leadTimeDays: daysBetween(item.poSentDate, process.deliveryDate),
    poApprovalDays: daysBetween(scApproval, item.poApprovalDate),
    poAfterScDays: daysBetween(scApproval, poSent),
    poOnTime: poSent ? Number(poSent.slice(8, 10)) <= 8 : null,
    poDeviationDays: poSent ? daysBetween(`${poSent.slice(0, 7)}-10`, poSent) : null,
    factoryLeadDays: daysBetween(poSent, firstBillDate ?? today),
    actualTransitDays: daysBetween(firstBillDate, process.arrivalDate),
    clearanceDays: daysBetween(process.arrivalDate, process.deliveryDate),
    billDate: firstBillDate, billNumber, invoiceNumbers, nfNumber: text(firstNf?.number), nfIssueDate: firstNfDate,
    nfHomologationDate: nfs.map(doc => date(doc.homologationDate)).filter((v): v is string => Boolean(v)).sort()[0] ?? null,
    e2e, totalTargetDays: e2e.totalTargetDays, totalActualDays: e2e.totalActualDays, totalDelayDays: e2e.totalDelayDays,
    bottleneck: e2e.bottleneck, arrivalYearMonth: e2e.arrivalYearMonth,
    invoiceQuantity: invoiceQuantity === null ? null : `${invoiceQuantity / 100_000_000n}.${String(invoiceQuantity % 100_000_000n).padStart(8, "0")}`,
    quantityMatchesInvoice: invoiceQuantity === null || allocationQuantity === null ? null : invoiceQuantity === allocationQuantity,
    invoiceUnitPrice, priceMatchesInvoice: invoiceUnitPrice === null || item.unitPrice == null ? null :
      fixed8(invoiceUnitPrice) === fixed8(item.unitPrice),
  };
}

/** Invoice totals belong to the IP; never repeat them as PO totals. */
export function invoiceTotals(documents: Row[]) {
  const totals = new Map<string, bigint>(); let incompleteLines = 0;
  for (const doc of documents) {
    if (doc.status !== "ACTIVE" || doc.kind !== "INVOICE") continue;
    const currency = typeof doc.currencyCode === "string" ? doc.currencyCode : null;
    const entered = fixed8(doc.amount);
    const quantity = fixed8(doc.quantity); const unitPrice = fixed8(doc.unitPrice);
    const computed = quantity === null || unitPrice === null ? null :
      (quantity * unitPrice + 50_000_000n) / 100_000_000n;
    const amount = entered ?? computed;
    if (!currency || amount === null) { incompleteLines++; continue; }
    totals.set(currency, (totals.get(currency) ?? 0n) + amount);
  }
  return { amounts: [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({
    currency, amount: `${amount / 100_000_000n}.${String(amount % 100_000_000n).padStart(8, "0")}`,
  })), incompleteLines };
}
