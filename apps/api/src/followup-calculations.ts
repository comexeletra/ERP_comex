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
function moneyProduct(quantity: unknown, price: unknown): string | null {
  const q = fixed8(quantity); const p = fixed8(price);
  if (q === null || p === null) return null;
  const value = (q * p + 50_000_000n) / 100_000_000n;
  return `${value / 100_000_000n}.${String(value % 100_000_000n).padStart(8, "0")}`;
}
function numeric(value: unknown): number | null {
  return value === null || value === undefined || value === "" ? null : Number(value);
}
function stage(start: unknown, end: unknown, targetDays: unknown) {
  const actualDays = daysBetween(start, end);
  const target = numeric(targetDays);
  return { targetDays: target, actualDays, delayDays: actualDays === null || target === null ? null : actualDays - target };
}

/** Spreadsheet rules expressed against the item and its one shipment (IP). */
export function calculateFollowup(item: Row, process: Row, documents: Row[],
  today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())) {
  const active = documents.filter(doc => doc.status === "ACTIVE");
  const invoices = active.filter(doc => doc.kind === "INVOICE" &&
    (doc.purchaseOrderItemId === item.id || doc.purchaseOrderItemId == null));
  const bills = active.filter(doc => doc.kind === "BL" &&
    (doc.purchaseOrderItemId === item.id || doc.purchaseOrderItemId == null));
  const nfs = active.filter(doc => doc.kind === "NF" &&
    (doc.purchaseOrderItemId === item.id || doc.purchaseOrderItemId == null));
  const firstBillDate = bills.map(doc => date(doc.issueDate)).filter((v): v is string => Boolean(v)).sort()[0] ?? null;
  const firstNfDate = nfs.map(doc => date(doc.issueDate)).filter((v): v is string => Boolean(v)).sort()[0] ?? null;
  const mode = typeof process.transportMode === "string" ? process.transportMode.trim() : "";
  const sea = /^(SEA|MARITIMO|MARÍTIMO)$/i.test(mode);
  const eta = date(process.etaConfirmed) ?? (mode ? addDays(process.etd, sea ? 55 : 10) : null);
  const ete = date(process.eteConfirmed) ?? addDays(eta, 10);
  const cancelled = /^(CANCELLED|CANCELED|CANCELADO)$/i.test(String(process.logisticsStatus ?? ""));
  const delivered = Boolean(date(process.deliveryDate));
  const status = cancelled ? "CANCELADO" : delivered ? "ENTREGUE" : !invoices.length ? "AGUARDANDO PRODUÇÃO" :
    !firstBillDate ? "AGUARDANDO EMBARQUE" : !date(process.arrivalDate) ? "AGUARDANDO CHEGADA" :
      "DESEMBARAÇO";
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
  const commercialDeadline = addDays(monthShift(necessity, -5), 4);
  const scApproval = date(item.scApprovalDate);
  const poSent = date(item.poSentDate);
  const received = date(item.commercialPlanReceivedDate);
  const mrpTarget = addDays(received, numeric(item.targetMrpDays));
  const mrp = stage(received, item.mrpCompletedDate, item.targetMrpDays);
  const order = stage(scApproval, item.poApprovalDate, item.targetOrderDays);
  const shipment = stage(process.etd, firstBillDate, item.targetShipmentDays);
  const port = stage(item.actualFactoryShipDate, item.actualPortDepartureDate, item.targetPortDays);
  const transit = stage(item.actualPortDepartureDate ?? process.etd, process.arrivalDate, item.targetTransitDays);
  const customs = stage(process.arrivalDate, process.deliveryDate, item.targetCustomsDays);
  const stages = { mrp, order, shipment, port, transit, customs };
  const targets = Object.values(stages).map(value => value.targetDays);
  const actuals = Object.values(stages).map(value => value.actualDays);
  const totalTargetDays = targets.every(value => value !== null) ? targets.reduce<number>((sum, value) => sum + value!, 0) : null;
  const totalActualDays = actuals.every(value => value !== null) ? actuals.reduce<number>((sum, value) => sum + value!, 0) : null;
  const completeDelays = Object.entries(stages).filter(([, value]) => value.delayDays !== null);
  const bottleneck = completeDelays.length ? completeDelays.sort((a, b) => b[1].delayDays! - a[1].delayDays!)[0][0] : null;
  const invoiceLines = invoices.filter(doc => doc.purchaseOrderItemId === item.id);
  const invoiceQuantity = invoiceLines.length && invoiceLines.every(doc => fixed8(doc.quantity) !== null)
    ? invoiceLines.reduce((sum, doc) => sum + fixed8(doc.quantity)!, 0n) : null;
  const allocationQuantity = fixed8(item.allocationQuantity);
  const invoicePrices = invoiceLines.map(doc => doc.unitPrice).filter(value => value !== null && value !== undefined);
  const invoiceUnitPrice = invoicePrices.length && invoicePrices.every(price => fixed8(price) === fixed8(invoicePrices[0]))
    ? String(invoicePrices[0]) : null;
  return {
    totalPrice: moneyProduct(item.orderedQuantity, item.unitPrice), currency: item.currencyCode ?? null,
    eta, ete, transitDays: daysBetween(process.etd, eta),
    storageDueDate: date(process.storageDueOverride) ?? (mode ? addDays(process.arrivalDate, sea ? 9 : 5) : null),
    status, alert, ruptureRisk: risk,
    leadTimeDays: daysBetween(item.poSentDate, process.deliveryDate),
    poApprovalDays: daysBetween(scApproval, item.poApprovalDate),
    poAfterScDays: daysBetween(scApproval, poSent),
    poOnTime: poSent ? Number(poSent.slice(8, 10)) <= 8 : null,
    poDeviationDays: poSent ? daysBetween(`${poSent.slice(0, 7)}-10`, poSent) : null,
    factoryLeadDays: daysBetween(poSent, firstBillDate ?? today),
    actualTransitDays: daysBetween(firstBillDate, process.arrivalDate),
    clearanceDays: daysBetween(process.arrivalDate, process.deliveryDate),
    commercialDeadline, commercialDeviationDays: daysBetween(commercialDeadline, received),
    mrpTargetDate: mrpTarget,
    portTargetDate: addDays(item.actualFactoryShipDate, numeric(item.targetPortDays)),
    arrivalTargetDate: addDays(item.actualPortDepartureDate ?? process.etd, numeric(item.targetTransitDays)),
    deliveryTargetDate: addDays(process.arrivalDate, numeric(item.targetCustomsDays)),
    billDate: firstBillDate, nfIssueDate: firstNfDate,
    nfHomologationDate: nfs.map(doc => date(doc.homologationDate)).filter((v): v is string => Boolean(v)).sort()[0] ?? null,
    stages, totalTargetDays, totalActualDays,
    totalDelayDays: totalTargetDays === null || totalActualDays === null ? null : totalActualDays - totalTargetDays,
    bottleneck, arrivalYearMonth: date(process.arrivalDate)?.slice(0, 7) ?? null,
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
