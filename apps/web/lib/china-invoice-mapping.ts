import type { ChinaInvoiceLine, InvoicePackingList } from "./china-invoice-xlsx";
import type { InvoiceCorrectedTotals, InvoiceLineCorrection } from "./invoice-correction-xlsx";

export type InvoicePoItemCandidate = { id: string; productCode: string; remainingQuantity: string };
export type InvoiceDestinationIssue = { kind: "PO_NOT_REGISTERED" } | { kind: "PO_NOT_ACTIVE"; status: "CANCELLED" | "CLOSED" | "DELETED" }
  | { kind: "ITEM_NOT_FOUND" } | { kind: "INVALID_QUANTITY" }
  | { kind: "INSUFFICIENT_BALANCE"; requested: string; available: string };

/** Quantities use the API scale: up to 8 decimal places, compared as exact integers. */
const quantityScale = 100_000_000n;

export function invoiceQuantityUnits(value: string): bigint | null {
  const match = /^(\d{1,16})(?:[.,](\d{1,8}))?$/u.exec(value.trim());
  return match ? BigInt(match[1]) * quantityScale + BigInt((match[2] ?? "").padEnd(8, "0")) : null;
}

export function formatInvoiceQuantity(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  const fraction = (absolute % quantityScale).toString().padStart(8, "0").replace(/0+$/u, "");
  return `${sign}${absolute / quantityScale}${fraction ? `.${fraction}` : ""}`;
}

/** Destined with 0 the part allocates nothing, so neither the PO nor the code can block it. */
export function classifyInvoiceDestination(keyItems: readonly InvoicePoItemCandidate[], poExists: boolean, quantity: string,
  distribution: InvoicePartDistribution | undefined, poStatus = "ACTIVE"): InvoiceDestinationIssue | null {
  const units = invoiceQuantityUnits(quantity);
  if (units === null) return { kind: "INVALID_QUANTITY" };
  if (units === 0n) return null;
  if (!poExists) return { kind: "PO_NOT_REGISTERED" };
  if (poStatus === "CANCELLED" || poStatus === "CLOSED" || poStatus === "DELETED") {
    return { kind: "PO_NOT_ACTIVE", status: poStatus };
  }
  if (!keyItems.length) return { kind: "ITEM_NOT_FOUND" };
  if (distribution && !distribution.enough) {
    return { kind: "INSUFFICIENT_BALANCE", requested: quantity, available: distribution.available };
  }
  return null;
}
export type InvoicePoAssignmentSource = {
  sourceRow: number;
  productCode: string;
  description: string;
  poAssignments: readonly { poNumber: string; quantity: string }[];
};

export function invoiceAssignmentsFromLines(lines: readonly InvoicePoAssignmentSource[]) {
  return lines.flatMap(line => invoiceAssignmentsFromSplit(line, line.poAssignments.map(assignment => assignment.poNumber),
    line.poAssignments.map(assignment => assignment.quantity)));
}

/** The parts of one line: the POs in cell order with the quantity of each. */
export function invoiceAssignmentsFromSplit(line: Pick<InvoicePoAssignmentSource, "sourceRow" | "productCode" | "description">,
  poNumbers: readonly string[], quantities: readonly string[]) {
  return poNumbers.map((poNumber, index) => ({
    key: `${line.sourceRow}:${index}`, sourceRow: line.sourceRow, sourcePoNumber: poNumber,
    poNumber, quantity: quantities[index], productCode: line.productCode, description: line.description,
  }));
}

/** What the key items of a part still hold in the Follow Up, summed. */
export function invoiceKeyBalance(items: readonly { remainingQuantity: string }[]): string {
  return formatInvoiceQuantity(items.reduce((total, item) => total + (invoiceQuantityUnits(item.remainingQuantity) ?? 0n), 0n));
}

/**
 * The POs cited in a PO cell the invoice reader could not split, such as "PO 030888&030201" of IPH037D
 * (2026-11-11): the numbers of 5 or more digits, in cell order, without repeats. A cell that already gives quantities
 * (=) is not guessed, because its numbers are not all POs.
 */
export function invoicePoCellNumbers(cell: string): string[] {
  if (cell.includes("=")) return [];
  return [...new Set(cell.match(/\d{5,}/gu) ?? [])];
}

/**
 * Splits the line quantity among the cited POs by the Follow Up balance of the product, in cell order (the analyst's
 * split of IPH037D, 20 + 60); what exceeds the balances goes to the last PO, which then shows the lack of balance.
 */
export function invoicePoCellSplit(quantity: string, balances: readonly string[]): string[] {
  const total = invoiceQuantityUnits(quantity);
  if (total === null || total <= 0n || !balances.length) return [];
  let left = total;
  return balances.map((balance, index) => {
    const available = invoiceQuantityUnits(balance) ?? 0n;
    const taken = index === balances.length - 1 ? left : available <= 0n ? 0n : available < left ? available : left;
    left -= taken;
    return formatInvoiceQuantity(taken);
  });
}

/** The destination key is the cited PO plus the line code: only the PO items with that code, in PO line order. */
export function invoiceKeyItems<T extends InvoicePoItemCandidate & { lineNumber: number }>(
  items: readonly T[], productCode: string,
): T[] {
  return items.filter(item => !invoicePoCodeDiffers(item.productCode, productCode))
    .sort((left, right) => left.lineNumber - right.lineNumber);
}

export type InvoicePartDistribution = { allocations: { itemId: string; quantity: string }[]; available: string; enough: boolean };

/**
 * Fills the key items of each part in order. Parts are read in invoice order and share the balance
 * of the same items; a part that does not fit takes nothing and leaves the balance to the next ones.
 */
export function distributeInvoiceParts<T extends InvoicePoItemCandidate>(
  parts: readonly { key: string; quantity: string; items: readonly T[] }[],
): Map<string, InvoicePartDistribution> {
  const used = new Map<string, bigint>();
  const free = (item: T) => {
    const remaining = (invoiceQuantityUnits(item.remainingQuantity) ?? 0n) - (used.get(item.id) ?? 0n);
    return remaining > 0n ? remaining : 0n;
  };
  return new Map(parts.map((part): [string, InvoicePartDistribution] => {
    const available = part.items.reduce((total, item) => total + free(item), 0n);
    const requested = invoiceQuantityUnits(part.quantity);
    if (requested === null || requested > available) {
      return [part.key, { allocations: [], available: formatInvoiceQuantity(available), enough: false }];
    }
    const allocations: { itemId: string; quantity: string }[] = [];
    let missing = requested;
    for (const item of part.items) {
      if (missing === 0n) break;
      const taken = free(item) < missing ? free(item) : missing;
      if (taken === 0n) continue;
      used.set(item.id, (used.get(item.id) ?? 0n) + taken);
      allocations.push({ itemId: item.id, quantity: formatInvoiceQuantity(taken) });
      missing -= taken;
    }
    return [part.key, { allocations, available: formatInvoiceQuantity(available), enough: true }];
  }));
}

export function invoicePoCodeDiffers(invoiceProductCode: string, poProductCode: string): boolean {
  return invoiceProductCode.trim().toLocaleUpperCase("en-US")
    !== poProductCode.trim().toLocaleUpperCase("en-US");
}

/** Same groups as apps/api/src/unit-equivalence.ts: units of one measure for every supplier and product. */
export const equivalentUnitGroups: readonly (readonly string[])[] = [
  ["UN", "UND", "UNID", "UNIDADE", "PC", "PCS", "PCE", "PECA", "PECAS", "UNIT", "UNITS", "EA"],
  ["KG", "KGS"],
  ["M", "MT", "MTS"],
];

function normalizeUnit(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/gu, "").toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "");
}

/** A side without unit has nothing to compare, as in the API: PO items of the historical load have no unit. */
export function invoicePoUnitDiffers(invoiceUnit: string | null | undefined, poUnit: string | null | undefined): boolean {
  const invoice = normalizeUnit(invoiceUnit ?? ""), po = normalizeUnit(poUnit ?? "");
  if (!invoice || !po || invoice === po) return false;
  return !equivalentUnitGroups.some(group => group.includes(invoice) && group.includes(po));
}

export function invoicePoPriceDiffers(invoicePrice: string, poPrice: string | null, poCurrency: string | null): boolean {
  return poCurrency === "CNY" && poPrice !== null && Number.isFinite(Number(invoicePrice))
    && Number.isFinite(Number(poPrice)) && Math.abs(Number(invoicePrice) - Number(poPrice)) > 0.00000001;
}

/**
 * Same limit as apps/api/src/invoice-price.ts. A price difference up to it is within the tolerance of the
 * area; every difference still waits for the analyst's acceptance (user decision, 2026-11-10).
 */
export const invoicePriceTolerancePercent = 20;
export type InvoicePriceDifference = { percent: number | null; withinTolerance: boolean };

function invoicePriceUnits(value: string): bigint | null {
  const match = /^(\d+)(?:[.,](\d{1,18}))?$/u.exec(value.trim());
  return match ? BigInt(match[1]) * 1_000_000_000_000_000_000n + BigInt((match[2] ?? "").padEnd(18, "0")) : null;
}

/**
 * The invoice price against the PO price, in exact decimals: the change in percent (4 decimals, null when the
 * PO price is 0) and whether it is within the tolerance (inclusive). Null when the prices are the same.
 */
export function invoicePriceDifference(invoicePrice: string, poPrice: string): InvoicePriceDifference | null {
  const invoice = invoicePriceUnits(invoicePrice), po = invoicePriceUnits(poPrice);
  if (invoice === null || po === null) return null;
  const gap = invoice - po;
  const absolute = gap < 0n ? -gap : gap;
  if (absolute <= 10_000_000_000n) return null;
  if (po === 0n) return { percent: null, withinTolerance: false };
  return { percent: Number(gap * 1_000_000n / po) / 10_000,
    withinTolerance: absolute * 100n <= BigInt(invoicePriceTolerancePercent) * po };
}

/** Same rule as apps/api/src/exporter-alias.ts: an alias has at least 8 letters or digits. */
const minimumExporterAliasLength = 8;

/**
 * The Exporter matches the PO supplier by code or name, or when it starts with
 * one of that supplier's aliases (the Exporter also carries the address).
 */
export function invoiceSupplierMatchesExporter(
  supplierValues: readonly (string | null | undefined)[], exporter: string, aliases: readonly string[] = [],
): boolean {
  const normalize = (value: string) => value.toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "");
  const normalizedExporter = normalize(exporter);
  if (supplierValues.some(value => Boolean(value && normalize(value) === normalizedExporter))) return true;
  const exporterPrefix = exporter.replace(/[^A-Za-z0-9]/gu, "").toUpperCase();
  return aliases.some(alias => {
    const prefix = alias.replace(/[^A-Za-z0-9]/gu, "").toUpperCase();
    return prefix.length >= minimumExporterAliasLength && exporterPrefix.startsWith(prefix);
  });
}

/** The company name is the first line of the Exporter; the address follows it. */
export function invoiceExporterAliasSuggestion(exporter: string): string {
  return exporter.split(/\r?\n/u).map(line => line.trim()).find(Boolean) ?? "";
}

export type InvoiceAuditPointKind = "QUANTITY" | "CODE" | "SUPPLIER" | "UNIT" | "PRICE" | "CURRENCY";
/** `confirmed` is null for informative points that need analysis but no confirmation. */
export type InvoiceAuditPoint = { kind: InvoiceAuditPointKind; invoiceValue: string; poValue: string; confirmed: boolean | null;
  difference?: InvoicePriceDifference };
type InvoiceAuditInvoice = { productCode: string; exporter: string; line: { unit: string; unitPrice: string } | null };
type InvoiceAuditPoItem = { productCode: string; unit: string | null; unitPrice: string | null; currency: string | null;
  supplierValues: readonly (string | null | undefined)[]; exporterAliases?: readonly string[] };
type InvoiceAuditConfirmations = { supplier: boolean; unit: boolean; price: boolean };

/** One confirmation and one written reason per invoice line cover every part of that line. */
export type InvoiceQuantityDecision = { confirmed: boolean; reason: string };
const minimumQuantityReasonLength = 3;

export function invoiceQuantityDecisionReady(decision: InvoiceQuantityDecision): boolean {
  return decision.confirmed && decision.reason.trim().length >= minimumQuantityReasonLength;
}

/** The analyst destined to the PO a quantity different from the one the invoice cites for it. */
export function invoiceQuantityPoint(invoiceQuantity: string, destinedQuantity: string, unit: string,
  decision: InvoiceQuantityDecision): InvoiceAuditPoint | null {
  const destined = invoiceQuantityUnits(destinedQuantity);
  if (destined === null || destined === invoiceQuantityUnits(invoiceQuantity)) return null;
  const withUnit = (value: string) => `${value} ${unit}`.trim();
  return { kind: "QUANTITY", invoiceValue: withUnit(invoiceQuantity), poValue: withUnit(formatInvoiceQuantity(destined)),
    confirmed: invoiceQuantityDecisionReady(decision) };
}

/** The invoice code is not in the cited PO: resolved only by destining 0 with the quantity reason, or by fixing PO or invoice. */
export function invoiceCodePoint(productCode: string, codeFound: boolean, destinedQuantity: string,
  decision: InvoiceQuantityDecision): InvoiceAuditPoint | null {
  if (codeFound) return null;
  return { kind: "CODE", invoiceValue: productCode, poValue: "",
    confirmed: invoiceQuantityUnits(destinedQuantity) === 0n && invoiceQuantityDecisionReady(decision) };
}

/** Audits every PO item that receives the part; a divergence found in more than one item is listed once. */
export function invoicePartAuditPoints(invoice: InvoiceAuditInvoice, poItems: readonly InvoiceAuditPoItem[],
  confirmations: InvoiceAuditConfirmations): InvoiceAuditPoint[] {
  const points = new Map<InvoiceAuditPointKind, InvoiceAuditPoint>();
  for (const poItem of poItems) {
    for (const point of invoiceAuditPoints(invoice, poItem, confirmations)) {
      if (!points.has(point.kind)) points.set(point.kind, point);
    }
  }
  return [...points.values()];
}

export function invoiceAuditPoints(invoice: InvoiceAuditInvoice, poItem: InvoiceAuditPoItem,
  confirmations: InvoiceAuditConfirmations): InvoiceAuditPoint[] {
  const points: InvoiceAuditPoint[] = [];
  if (!invoiceSupplierMatchesExporter(poItem.supplierValues, invoice.exporter, poItem.exporterAliases)) {
    points.push({ kind: "SUPPLIER", invoiceValue: invoice.exporter,
      poValue: poItem.supplierValues.filter(Boolean).join(" · "), confirmed: confirmations.supplier });
  }
  if (invoice.line && invoicePoUnitDiffers(invoice.line.unit, poItem.unit)) {
    points.push({ kind: "UNIT", invoiceValue: invoice.line.unit, poValue: poItem.unit ?? "", confirmed: confirmations.unit });
  }
  if (invoice.line && invoicePoPriceDiffers(invoice.line.unitPrice, poItem.unitPrice, poItem.currency)) {
    const difference = invoicePriceDifference(invoice.line.unitPrice, poItem.unitPrice ?? "");
    points.push({ kind: "PRICE", invoiceValue: `${invoice.line.unitPrice} CNY`,
      poValue: `${poItem.unitPrice} ${poItem.currency}`, confirmed: confirmations.price, ...(difference ? { difference } : {}) });
  }
  if (poItem.currency && poItem.currency !== "CNY") {
    points.push({ kind: "CURRENCY", invoiceValue: "CNY", poValue: poItem.currency, confirmed: null });
  }
  return points;
}

export type InvoiceLineDecision = { sourceRow: number; invoiceQuantity: string; destinedQuantity: string;
  confirmQuantityMismatch: boolean; quantityMismatchReason: string };

/** What the analyst destined from each invoice line; the confirmation and reason only go when a part differs. */
export function invoiceLineDecisions(
  lines: readonly { sourceRow: number; quantity: string }[],
  parts: readonly { sourceRow: number; invoiceQuantity: string; quantity: string }[],
  decisions: Readonly<Record<number, InvoiceQuantityDecision | undefined>>,
): InvoiceLineDecision[] {
  return lines.map(line => {
    const lineParts = parts.filter(part => part.sourceRow === line.sourceRow);
    const destined = lineParts.reduce((total, part) => total + (invoiceQuantityUnits(part.quantity) ?? 0n), 0n);
    const differs = lineParts.some(part => invoiceQuantityUnits(part.quantity) !== invoiceQuantityUnits(part.invoiceQuantity));
    const decision = decisions[line.sourceRow];
    return { sourceRow: line.sourceRow, invoiceQuantity: line.quantity, destinedQuantity: formatInvoiceQuantity(destined),
      confirmQuantityMismatch: differs && Boolean(decision?.confirmed),
      quantityMismatchReason: differs ? decision?.reason.trim() ?? "" : "" };
  });
}

export type InvoiceItemDestination = { sourceRow: number; sourcePoNumber: string; productCode: string; itemId: string;
  poNumber: string; poProductCode: string; quantity: string; confirmSupplierMismatch: boolean;
  confirmUnitMismatch: boolean; confirmPriceMismatch: boolean };

/** Assignments and allocations of the save request: only the fields the strict API schema accepts. */
export function invoiceSavePayload(invoiceLabel: string, destinations: readonly InvoiceItemDestination[]) {
  return {
    assignments: destinations.map(destination => ({ itemId: destination.itemId, sourceRow: destination.sourceRow,
      sourcePoNumber: destination.sourcePoNumber, poNumber: destination.poNumber, productCode: destination.productCode,
      poProductCode: destination.poProductCode, quantity: destination.quantity,
      confirmSupplierMismatch: destination.confirmSupplierMismatch, confirmUnitMismatch: destination.confirmUnitMismatch,
      confirmPriceMismatch: destination.confirmPriceMismatch })),
    // The allocation note is stored data and keeps the Portuguese wording of the existing records.
    allocations: destinations.map(destination => ({ itemId: destination.itemId, quantity: destination.quantity,
      notes: `Invoice ${invoiceLabel}, linha ${destination.sourceRow}` })),
  };
}

export type InvoiceBeforeAfterRow = { poNumber: string; productCode: string; unit: string; invoiceRows: number[];
  before: string; after: string; difference: string; changed: boolean };

/**
 * The allocations of an IP before a revision and the destinations of the new invoice, side by side: one row
 * per PO and code (in the order of the invoice, then what the invoice no longer cites), with the difference.
 */
export function invoiceBeforeAfterRows(
  before: readonly { poNumber: string; productCode: string; quantity: string; unit: string }[],
  after: readonly { sourceRow: number; poNumber: string; productCode: string; quantity: string }[],
): InvoiceBeforeAfterRow[] {
  const key = (po: string, code: string) =>
    `${po.toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "").replace(/^PO/u, "")}|${code.trim().toLocaleUpperCase("en-US")}`;
  const rows = new Map<string, { poNumber: string; productCode: string; unit: string; invoiceRows: Set<number>;
    before: bigint; after: bigint }>();
  const row = (po: string, code: string) => {
    const found = rows.get(key(po, code)) ?? { poNumber: po, productCode: code, unit: "", invoiceRows: new Set<number>(),
      before: 0n, after: 0n };
    rows.set(key(po, code), found);
    return found;
  };
  for (const destination of after) {
    const entry = row(destination.poNumber, destination.productCode);
    entry.after += invoiceQuantityUnits(destination.quantity) ?? 0n;
    entry.invoiceRows.add(destination.sourceRow);
  }
  for (const allocation of before) {
    const entry = row(allocation.poNumber, allocation.productCode);
    entry.before += invoiceQuantityUnits(allocation.quantity) ?? 0n;
    entry.unit ||= allocation.unit;
  }
  return [...rows.values()].map(entry => ({ poNumber: entry.poNumber, productCode: entry.productCode, unit: entry.unit,
    invoiceRows: [...entry.invoiceRows].sort((left, right) => left - right), before: formatInvoiceQuantity(entry.before),
    after: formatInvoiceQuantity(entry.after), difference: formatInvoiceQuantity(entry.after - entry.before),
    changed: entry.after !== entry.before }));
}

export type InvoicePoCodeSummaryRow = { poNumber: string; productCode: string; ordered: string; shipped: string;
  thisInvoice: string; balanceAfter: string; overBalance: boolean };

/** Per cited PO and code: ordered, already shipped in other IPs, destined by this invoice and the balance left. */
export function invoicePoCodeSummary(
  parts: readonly { poNumber: string; productCode: string; quantity: string;
    items: readonly { id: string; orderedQuantity: string; remainingQuantity: string }[] }[],
): InvoicePoCodeSummaryRow[] {
  const groups = new Map<string, { poNumber: string; productCode: string; thisInvoice: bigint;
    items: Map<string, { orderedQuantity: string; remainingQuantity: string }> }>();
  for (const part of parts) {
    if (!part.items.length) continue;
    const key = `${part.poNumber.toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "").replace(/^PO/u, "")}|${
      part.productCode.trim().toLocaleUpperCase("en-US")}`;
    const group = groups.get(key) ?? { poNumber: part.poNumber, productCode: part.productCode, thisInvoice: 0n, items: new Map() };
    group.thisInvoice += invoiceQuantityUnits(part.quantity) ?? 0n;
    for (const item of part.items) group.items.set(item.id, item);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const items = [...group.items.values()];
    const ordered = items.reduce((total, item) => total + (invoiceQuantityUnits(item.orderedQuantity) ?? 0n), 0n);
    const remaining = items.reduce((total, item) => total + (invoiceQuantityUnits(item.remainingQuantity) ?? 0n), 0n);
    const balanceAfter = remaining - group.thisInvoice;
    return { poNumber: group.poNumber, productCode: group.productCode, ordered: formatInvoiceQuantity(ordered),
      shipped: formatInvoiceQuantity(ordered - remaining), thisInvoice: formatInvoiceQuantity(group.thisInvoice),
      balanceAfter: formatInvoiceQuantity(balanceAfter), overBalance: balanceAfter < 0n };
  });
}

export function invoiceAuditProgress(points: readonly InvoiceAuditPoint[]): { required: number; confirmed: number } {
  const required = points.filter(point => point.confirmed !== null);
  return { required: required.length, confirmed: required.filter(point => point.confirmed).length };
}

export type InvoiceComparisonField = "description" | "ncm" | "unit" | "price" | "manufacturer";
export type InvoiceComparisonRow = { field: InvoiceComparisonField; invoice: string; poItem: string; product: string; differs: boolean };

export type InvoiceProductFillField = "ncm" | "manufacturer" | "manufacturerAddress" | "manufacturerCountry";

/** Catalog fields still empty that the invoice line can fill; the invoice never overwrites registered product data. */
export function invoiceProductFillFields(
  line: { ncm: string; manufacturer: string; manufacturerAddress: string; manufacturerCountry: string },
  product: { ncmCode: string | null; manufacturer: string | null; manufacturerAddress: string | null; manufacturerCountry: string | null },
): InvoiceProductFillField[] {
  const empty = (value: string | null) => !(value ?? "").trim();
  return ([
    ["ncm", /^\d{8}$/u.test(line.ncm), product.ncmCode],
    ["manufacturer", !empty(line.manufacturer), product.manufacturer],
    ["manufacturerAddress", !empty(line.manufacturerAddress), product.manufacturerAddress],
    ["manufacturerCountry", !empty(line.manufacturerCountry), product.manufacturerCountry],
  ] as const).filter(([, available, current]) => available && empty(current)).map(([field]) => field);
}

export function invoiceComparisonRows(
  invoiceLine: { description: string; ncm: string; unit: string; unitPrice: string; manufacturer: string } | null,
  poItem: { description: string; unit: string | null; ncmCode: string | null; unitPrice: string | null; currency: string | null },
  product: { name: string | null; ncmCode: string | null; manufacturer: string | null },
): InvoiceComparisonRow[] {
  const ncms = new Set([invoiceLine?.ncm, poItem.ncmCode, product.ncmCode]
    .map(value => (value ?? "").replace(/\D/gu, "")).filter(Boolean));
  const poPrice = poItem.unitPrice === null ? "" : `${poItem.unitPrice} ${poItem.currency ?? ""}`.trim();
  return [
    { field: "description", invoice: invoiceLine?.description ?? "", poItem: poItem.description, product: product.name ?? "", differs: false },
    { field: "ncm", invoice: invoiceLine?.ncm ?? "", poItem: poItem.ncmCode ?? "", product: product.ncmCode ?? "", differs: ncms.size > 1 },
    { field: "unit", invoice: invoiceLine?.unit ?? "", poItem: poItem.unit ?? "", product: "",
      differs: invoicePoUnitDiffers(invoiceLine?.unit, poItem.unit) },
    { field: "price", invoice: invoiceLine?.unitPrice ? `${invoiceLine.unitPrice} CNY` : "", poItem: poPrice, product: "",
      differs: Boolean(invoiceLine && invoicePoPriceDiffers(invoiceLine.unitPrice, poItem.unitPrice, poItem.currency)) },
    { field: "manufacturer", invoice: invoiceLine?.manufacturer ?? "", poItem: "", product: product.manufacturer ?? "", differs: false },
  ];
}

/*
 * Conference of the invoice shown to the analyst during the audit (user decision, 2026-11-10): totals of
 * the lines against the TOTAL row and the PKL sheet, the checks of each line, INV × PKL and the value at
 * the PO price. Nothing of it is saved in the IP; only the INV × PKL decisions go with the invoice metadata.
 */

/** Values read from the sheet have up to 15 significant digits; 18 decimal places hold them exactly. */
const conferenceDigits = 18;
const conferenceScale = 10n ** BigInt(conferenceDigits);

function conferenceUnits(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/u.exec(value.trim());
  if (!match || (match[3]?.length ?? 0) > conferenceDigits) return null;
  const units = BigInt(match[2]) * conferenceScale + BigInt((match[3] ?? "").padEnd(conferenceDigits, "0"));
  return match[1] ? -units : units;
}

function formatScaled(units: bigint, digits = conferenceDigits): string {
  const scale = 10n ** BigInt(digits);
  const absolute = units < 0n ? -units : units;
  const fraction = (absolute % scale).toString().padStart(digits, "0").replace(/0+$/u, "");
  return `${units < 0n ? "-" : ""}${absolute / scale}${fraction ? `.${fraction}` : ""}`;
}

/** Same tolerance as the TOTAL check of the parser (apps/web/lib/china-invoice-xlsx.ts). */
const conferenceTotalTolerance = 11n * 10n ** BigInt(conferenceDigits - 3);

export type InvoiceConferenceMeasure = "quantity" | "netWeight" | "grossWeight" | "amount";
export type InvoiceConferenceRow = { measure: InvoiceConferenceMeasure; lines: string;
  declared: string | null; declaredDifference: string | null; declaredMatches: boolean;
  packing: string | null; packingDifference: string | null; packingMatches: boolean | null };
type InvoiceConferenceLine = { quantity: string; netWeightKg: string; grossWeightKg: string; amount: string };
type InvoiceConferenceTotals = { quantity: string; netWeightKg: string; grossWeightKg: string };

/** The sum of the lines against the TOTAL row of the INV and the Total row of the PKL; differences are total − lines. */
export function invoiceConferenceTotals(lines: readonly InvoiceConferenceLine[],
  declared: (InvoiceConferenceTotals & { amount: string }) | null, packing: InvoiceConferenceTotals | null): InvoiceConferenceRow[] {
  const fields = [["quantity", "quantity"], ["netWeight", "netWeightKg"], ["grossWeight", "grossWeightKg"], ["amount", "amount"]] as const;
  return fields.map(([measure, field]) => {
    const sum = lines.reduce((total, line) => total + (conferenceUnits(line[field]) ?? 0n), 0n);
    const compare = (text: string | undefined) => {
      const units = conferenceUnits(text ?? "");
      if (units === null) return { value: null, difference: null, matches: false };
      const gap = units - sum;
      return { value: formatScaled(units), difference: formatScaled(gap),
        matches: (gap < 0n ? -gap : gap) <= conferenceTotalTolerance };
    };
    const fromDeclared = compare(declared?.[field]);
    const fromPacking = field === "amount" || !packing ? null : compare(packing[field]);
    return { measure, lines: formatScaled(sum), declared: fromDeclared.value, declaredDifference: fromDeclared.difference,
      declaredMatches: fromDeclared.matches, packing: fromPacking?.value ?? null,
      packingDifference: fromPacking?.difference ?? null, packingMatches: fromPacking ? fromPacking.matches : null };
  });
}

/** The rows of the lines whose quantity × price differs from the total, or whose net weight exceeds the gross. */
export function invoiceLineChecks(lines: readonly { sourceRow: number; quantity: string; unitPrice: string; amount: string;
  netWeightKg: string; grossWeightKg: string }[]): { lines: number; totalFailures: number[]; weightFailures: number[] } {
  const totalFailures: number[] = [];
  const weightFailures: number[] = [];
  for (const line of lines) {
    const quantity = conferenceUnits(line.quantity), price = conferenceUnits(line.unitPrice), amount = conferenceUnits(line.amount);
    const gap = quantity === null || price === null || amount === null ? null : quantity * price - amount * conferenceScale;
    if (gap === null || (gap < 0n ? -gap : gap) > conferenceTotalTolerance * conferenceScale) totalFailures.push(line.sourceRow);
    const net = conferenceUnits(line.netWeightKg), gross = conferenceUnits(line.grossWeightKg);
    if (net === null || gross === null || net > gross) weightFailures.push(line.sourceRow);
  }
  return { lines: lines.length, totalFailures, weightFailures };
}

export type InvoicePackingField = "quantity" | "netWeightKg" | "grossWeightKg";
export type InvoicePackingValues = Record<InvoicePackingField, string>;
type InvoicePackingSource = InvoicePackingValues & { sourceRow: number; lineNumber: string };
export type InvoicePackingDivergence = { key: string; lineNumber: string; invoiceRow: number | null; packingRow: number | null;
  fields: InvoicePackingField[]; invoice: InvoicePackingValues | null; packing: InvoicePackingValues | null };

const packingFields: readonly InvoicePackingField[] = ["quantity", "netWeightKg", "grossWeightKg"];
const packingValues = (line: InvoicePackingSource): InvoicePackingValues =>
  ({ quantity: line.quantity, netWeightKg: line.netWeightKg, grossWeightKg: line.grossWeightKg });

/**
 * Pairs the INV and PKL lines by their number (No.) and lists each pair with a different quantity or weight,
 * even by 0.00000001, and each line found in only one of the sheets: INV order first, then the PKL leftovers.
 */
export function invoicePackingDivergences(invoiceLines: readonly InvoicePackingSource[],
  packingLines: readonly InvoicePackingSource[]): InvoicePackingDivergence[] {
  const number = (value: string) => value.trim().replace(/^0+(?=\d)/u, "");
  const same = (left: string, right: string) => {
    const leftUnits = conferenceUnits(left), rightUnits = conferenceUnits(right);
    return leftUnits === null || rightUnits === null ? left.trim() === right.trim() : leftUnits === rightUnits;
  };
  const unused = [...packingLines];
  const divergences: InvoicePackingDivergence[] = [];
  for (const line of invoiceLines) {
    const index = unused.findIndex(entry => number(entry.lineNumber) === number(line.lineNumber));
    const packing = index >= 0 ? unused.splice(index, 1)[0] : null;
    const fields = packing ? packingFields.filter(field => !same(line[field], packing[field])) : [...packingFields];
    if (fields.length) divergences.push({ key: `inv:${line.sourceRow}`, lineNumber: line.lineNumber, invoiceRow: line.sourceRow,
      packingRow: packing?.sourceRow ?? null, fields, invoice: packingValues(line), packing: packing ? packingValues(packing) : null });
  }
  return [...divergences, ...unused.map(packing => ({ key: `pkl:${packing.sourceRow}`, lineNumber: packing.lineNumber,
    invoiceRow: null, packingRow: packing.sourceRow, fields: [...packingFields], invoice: null, packing: packingValues(packing) }))];
}

export function invoicePackingDecisionsReady(divergences: readonly InvoicePackingDivergence[],
  decisions: Readonly<Record<string, InvoiceQuantityDecision>>): boolean {
  return divergences.every(divergence => invoiceQuantityDecisionReady(decisions[divergence.key] ?? { confirmed: false, reason: "" }));
}

/** The accepted divergences go with the invoice metadata, which the API keeps in the document notes. */
export function invoicePackingListDecisions(divergences: readonly InvoicePackingDivergence[],
  decisions: Readonly<Record<string, InvoiceQuantityDecision>>) {
  return divergences.map(({ invoiceRow, packingRow, lineNumber, fields, invoice, packing, key }) =>
    ({ invoiceRow, packingRow, lineNumber, fields, invoice, packing, reason: (decisions[key]?.reason ?? "").trim() }));
}

export type InvoicePoValue = { invoiceValue: string; poValue: string; difference: string; percent: number | null;
  counted: number; excluded: number };

/**
 * The destined quantity at the invoice price against the same quantity at the PO price. Only PO items in CNY
 * with a price are counted (a PO in another currency has no price check); the others are counted apart.
 */
export function invoiceValueByPo(parts: readonly { quantity: string; invoicePrice: string; poPrice: string | null;
  poCurrency: string | null }[]): InvoicePoValue {
  let invoiceValue = 0n, poValue = 0n, counted = 0, excluded = 0;
  for (const part of parts) {
    const quantity = invoiceQuantityUnits(part.quantity);
    if (quantity === 0n) continue;
    const invoicePrice = invoicePriceUnits(part.invoicePrice);
    const poPrice = part.poPrice === null ? null : invoicePriceUnits(part.poPrice);
    if (quantity === null || invoicePrice === null || poPrice === null || part.poCurrency !== "CNY") { excluded += 1; continue; }
    invoiceValue += quantity * invoicePrice;
    poValue += quantity * poPrice;
    counted += 1;
  }
  const gap = invoiceValue - poValue;
  return { invoiceValue: formatScaled(invoiceValue, 26), poValue: formatScaled(poValue, 26), difference: formatScaled(gap, 26),
    percent: poValue > 0n ? Number(gap * 1_000_000n / poValue) / 10_000 : null, counted, excluded };
}

/*
 * Decisions of the invoice audit page (user decision, 2026-11-10): they become corrections of the invoice file.
 */

export type InvoiceLinePricePoint = { invoicePrice: string; poPrices: string[]; difference: InvoicePriceDifference | null;
  correctable: boolean };
export type InvoicePriceChoice = "ACCEPT" | "CORRECT";

/**
 * The invoice price of a line against the CNY prices of the PO lines that receive it (a PO in another currency
 * has no price check). It can be corrected to the PO price only when that price is one.
 */
export function invoiceLinePricePoint(invoicePrice: string,
  poItems: readonly { unitPrice: string | null; currency: string | null }[]): InvoiceLinePricePoint | null {
  const prices = poItems.filter(item => item.currency === "CNY" && item.unitPrice !== null).map(item => item.unitPrice!);
  if (!prices.some(price => invoicePoPriceDiffers(invoicePrice, price, "CNY"))) return null;
  const distinct = prices.filter((price, index) => prices.findIndex(other => invoicePriceUnits(other) === invoicePriceUnits(price)) === index);
  return { invoicePrice, poPrices: distinct, correctable: distinct.length === 1,
    difference: distinct.length === 1 ? invoicePriceDifference(invoicePrice, distinct[0]) : null };
}

export function invoicePriceChoiceReady(point: InvoiceLinePricePoint | null, choice: InvoicePriceChoice | undefined): boolean {
  return !point || choice === "ACCEPT" || (choice === "CORRECT" && point.correctable);
}

/** The Follow Up suppliers of the destined lines that do not match the Exporter, each confirmed once. */
export function invoiceSupplierMismatches(exporter: string, suppliers: readonly string[]): string[] {
  return [...new Set(suppliers.map(value => value.trim().toLocaleUpperCase("en-US")).filter(Boolean))]
    .filter(supplier => !invoiceSupplierMatchesExporter([supplier], exporter));
}

export type InvoicePackingChoice = { source: "INVOICE" | "PACKING" | null; reason: string };

/** The PKL weights can be taken only for a line found in both sheets; a reason is always written. */
export function invoicePackingChoiceReady(divergence: InvoicePackingDivergence, choice: InvoicePackingChoice | undefined): boolean {
  if (!choice?.source || choice.reason.trim().length < minimumQuantityReasonLength) return false;
  return choice.source === "INVOICE" || Boolean(divergence.invoice && divergence.packing);
}

export type InvoiceCatalogField = "ncm" | "description";
export type InvoiceCatalogPoint = { key: string; sourceRow: number; lineNumber: string; productCode: string;
  field: InvoiceCatalogField; invoiceValue: string; databaseValue: string; caseOnly: boolean };
/** An NCM not found in the DATABASE: the product is out of it, or it has no NCM there (user decision, 2026-11-11). */
export type InvoiceCatalogMissing = { sourceRow: number; lineNumber: string; productCode: string;
  reason: "NOT_IN_DATABASE" | "NO_NCM" };

const plainText = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/gu, "")
  .toLocaleUpperCase("en-US").replace(/\s+/gu, " ").trim();

/**
 * The NCM (by its digits) and the description (after trimming) of each invoice line against the product DATABASE,
 * by product code, as the analysts check them (comparison of 2026-11-10). A product out of the DATABASE, or without NCM
 * in it, is listed apart, because its NCM was not found; a DATABASE row without description has nothing to compare.
 */
export function invoiceCatalogPoints(
  lines: readonly { sourceRow: number; lineNumber: string; productCode: string; ncm: string; description: string }[],
  products: readonly { productCode: string; ncm: string; description: string }[],
): { points: InvoiceCatalogPoint[]; missing: InvoiceCatalogMissing[] } {
  const byCode = new Map(products.map(product => [product.productCode.trim().toLocaleUpperCase("en-US"), product]));
  const points: InvoiceCatalogPoint[] = [];
  const missing: InvoiceCatalogMissing[] = [];
  for (const line of lines) {
    const productCode = line.productCode.trim();
    const product = byCode.get(productCode.toLocaleUpperCase("en-US"));
    const base = { sourceRow: line.sourceRow, lineNumber: line.lineNumber, productCode };
    if (!product) { missing.push({ ...base, reason: "NOT_IN_DATABASE" }); continue; }
    if (!product.ncm) missing.push({ ...base, reason: "NO_NCM" });
    else if (line.ncm.replace(/\D/gu, "") !== product.ncm) {
      points.push({ ...base, key: `${line.sourceRow}:ncm`, field: "ncm", invoiceValue: line.ncm.trim(),
        databaseValue: product.ncm, caseOnly: false });
    }
    const description = line.description.trim(), reference = product.description.trim();
    if (reference && description !== reference) {
      points.push({ ...base, key: `${line.sourceRow}:description`, field: "description", invoiceValue: description,
        databaseValue: reference, caseOnly: plainText(description) === plainText(reference) });
    }
  }
  return { points, missing };
}

/**
 * Only an NCM not found in the DATABASE waits for the analyst: the invoice NCM is kept with a confirmation and a
 * reason, or flagged in the file (`flagged`, user decision of 2026-11-11), which needs no reason.
 */
export function invoiceCatalogReady(missing: readonly InvoiceCatalogMissing[],
  missingDecisions: Readonly<Record<number, InvoiceQuantityDecision>>,
  flagged: Readonly<Partial<Record<number, boolean>>> = {}): boolean {
  return missing.every(entry => flagged[entry.sourceRow]
    || invoiceQuantityDecisionReady(missingDecisions[entry.sourceRow] ?? { confirmed: false, reason: "" }));
}

/** The DATABASE rules NCM and description without question (user decision, 2026-11-10): every divergence takes it. */
export function invoiceCatalogCorrections(points: readonly InvoiceCatalogPoint[]):
  Record<number, Partial<Record<InvoiceCatalogField, string>>> {
  const corrections: Record<number, Partial<Record<InvoiceCatalogField, string>>> = {};
  for (const point of points) corrections[point.sourceRow] = { ...corrections[point.sourceRow], [point.field]: point.databaseValue };
  return corrections;
}

/*
 * Manufacturer against the manufacturer list (user decisions, 2026-11-10): the list rules the address and the name;
 * a name with several addresses is chosen by the analyst; a manufacturer out of the list is taken from the similar or
 * searched entries of the list, or confirmed with a reason (user request, 2026-11-11);
 * a country that differs from the list is decided by the analyst; the country goes in capitals.
 */

export type InvoiceManufacturerEntry = { sourceRow: number; name: string; address: string; country: string; code: string };
export type InvoiceManufacturerCheck = { sourceRow: number; lineNumber: string;
  invoice: { name: string; address: string; country: string };
  status: "ADDRESS" | "NAME" | "CHOICE" | "MISSING"; entry: InvoiceManufacturerEntry | null; candidates: InvoiceManufacturerEntry[] };
export type InvoiceCountryChoice = { source: "INVOICE" | "LIST" | null; reason: string };
type InvoiceManufacturerLine = { sourceRow: number; lineNumber: string; manufacturer: string; manufacturerAddress: string;
  manufacturerCountry: string };

const manufacturerKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/gu, "")
  .toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "");
/** Spellings of the same country found in the list (EUA × USA, Japão × JAPAN). */
const countrySpellings: Readonly<Record<string, string>> = { EUA: "USA", ESTADOSUNIDOS: "USA", UNITEDSTATES: "USA", JAPAO: "JAPAN" };
const countryKey = (value: string) => { const key = manufacturerKey(value); return countrySpellings[key] ?? key; };

export function invoiceCountryMatches(left: string, right: string): boolean {
  return countryKey(left) === countryKey(right);
}

/** The identifier of a list entry chosen by the analyst: its TOTVS code, or its row when it has none. */
export function invoiceManufacturerId(entry: InvoiceManufacturerEntry): string {
  return entry.code || `#${entry.sourceRow}`;
}

/**
 * The normalized keys and similarity sets of a list entry, computed once per entry: the audit page compares every
 * invoice line with the whole list on each render, and normalizing the 575 entries per line took about 110 ms.
 */
type ManufacturerFeatures = { address: string; name: string; nameWords: Set<string>; nameGrams: Set<string>;
  addressWords: Set<string>; search: string[] };
const manufacturerFeatureCache = new WeakMap<InvoiceManufacturerEntry, ManufacturerFeatures>();
function manufacturerFeatures(entry: InvoiceManufacturerEntry): ManufacturerFeatures {
  let features = manufacturerFeatureCache.get(entry);
  if (!features) {
    features = { address: manufacturerKey(entry.address), name: manufacturerKey(entry.name), nameWords: similarityWords(entry.name),
      nameGrams: trigrams(entry.name), addressWords: similarityWords(entry.address),
      search: [entry.name, entry.address, entry.code].map(manufacturerKey) };
    manufacturerFeatureCache.set(entry, features);
  }
  return features;
}

/** Each line's manufacturer in the list: by address (as the analysts' XLOOKUP), else by name. */
export function invoiceManufacturerChecks(lines: readonly InvoiceManufacturerLine[],
  list: readonly InvoiceManufacturerEntry[]): InvoiceManufacturerCheck[] {
  return lines.map(line => {
    const invoice = { name: line.manufacturer.trim(), address: line.manufacturerAddress.trim(), country: line.manufacturerCountry.trim() };
    const base = { sourceRow: line.sourceRow, lineNumber: line.lineNumber, invoice, candidates: [] as InvoiceManufacturerEntry[] };
    const addressKey = manufacturerKey(invoice.address), nameKey = manufacturerKey(invoice.name);
    const byAddress = invoice.address ? list.filter(entry => manufacturerFeatures(entry).address === addressKey) : [];
    if (byAddress.length) {
      const entry = byAddress.find(candidate => manufacturerFeatures(candidate).name === nameKey) ?? byAddress[0];
      return { ...base, status: "ADDRESS", entry };
    }
    const byName = invoice.name ? list.filter(entry => manufacturerFeatures(entry).name === nameKey) : [];
    if (byName.length === 1) return { ...base, status: "NAME", entry: byName[0] };
    if (byName.length > 1) return { ...base, status: "CHOICE", entry: null, candidates: byName };
    return { ...base, status: "MISSING", entry: null, candidates: invoiceManufacturerSimilar(invoice, list) };
  });
}

/** Words that every company or address has, left out of the similarity. */
const commonWords = new Set(["CO", "LTD", "LIMITED", "COMPANY", "CORP", "CORPORATION", "INC", "THE", "OF", "AND", "CHINA", "PRC",
  "PROVINCE", "CITY", "DISTRICT", "ROAD", "RD", "NO", "TOWN", "STREET", "ST", "BUILDING", "FLOOR", "ZONE"]);
const similarityWords = (value: string) => new Set(value.normalize("NFD").replace(/[̀-ͯ]/gu, "").toLocaleUpperCase("en-US")
  .split(/[^A-Z0-9]+/u).filter(word => word.length > 1 && !commonWords.has(word)));
const trigrams = (value: string) => {
  const key = [...similarityWords(value)].join("");
  return new Set(Array.from({ length: Math.max(key.length - 2, 0) }, (_, index) => key.slice(index, index + 3)));
};
function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>, dice: boolean): number {
  if (!left.size || !right.size) return 0;
  const common = [...left].filter(value => right.has(value)).length;
  return dice ? 2 * common / (left.size + right.size) : common / (left.size + right.size - common);
}

/** The list entries close to a manufacturer the list does not have (name nearly equal or the same address words). */
export const invoiceManufacturerSimilarity = 0.6;
export function invoiceManufacturerSimilar(invoice: { name: string; address: string },
  list: readonly InvoiceManufacturerEntry[], limit = 5): InvoiceManufacturerEntry[] {
  const name = similarityWords(invoice.name), nameGrams = trigrams(invoice.name), address = similarityWords(invoice.address);
  return list.map(entry => { const features = manufacturerFeatures(entry);
    return { entry, score: Math.max(overlap(name, features.nameWords, false), overlap(nameGrams, features.nameGrams, true),
      overlap(address, features.addressWords, false)) }; })
    .filter(({ score }) => score >= invoiceManufacturerSimilarity)
    .sort((left, right) => right.score - left.score || left.entry.sourceRow - right.entry.sourceRow)
    .slice(0, limit).map(({ entry }) => entry);
}

/** The list entries whose name, address or TOTVS code contain the text the analyst typed (at least 3 letters or digits). */
export function invoiceManufacturerSearch(list: readonly InvoiceManufacturerEntry[], text: string, limit = 10): InvoiceManufacturerEntry[] {
  const key = manufacturerKey(text);
  if (key.length < 3) return [];
  return list.filter(entry => manufacturerFeatures(entry).search.some(value => value.includes(key)))
    .slice(0, limit);
}

function resolvedManufacturer(check: InvoiceManufacturerCheck, addressChoices: Readonly<Record<number, string>>) {
  return check.entry ?? check.candidates.find(entry => invoiceManufacturerId(entry) === addressChoices[check.sourceRow]) ?? null;
}

/** The list country when it differs from the invoice one, once the manufacturer is known. */
export function invoiceManufacturerCountryPoint(check: InvoiceManufacturerCheck,
  addressChoices: Readonly<Record<number, string>>): string | null {
  const entry = resolvedManufacturer(check, addressChoices);
  return entry?.country && !invoiceCountryMatches(entry.country, check.invoice.country) ? entry.country : null;
}

/** Decisions still missing: an address to choose, a country to decide, a manufacturer out of the list to confirm. */
export function invoiceManufacturerPending(checks: readonly InvoiceManufacturerCheck[],
  addressChoices: Readonly<Record<number, string>>, countryChoices: Readonly<Record<number, InvoiceCountryChoice>>,
  missingDecisions: Readonly<Record<number, InvoiceQuantityDecision>>): number {
  return checks.reduce((total, check) => {
    if (!resolvedManufacturer(check, addressChoices)) {
      if (check.status !== "MISSING") return total + 1;
      return total + (invoiceQuantityDecisionReady(missingDecisions[check.sourceRow] ?? { confirmed: false, reason: "" }) ? 0 : 1);
    }
    const choice = countryChoices[check.sourceRow];
    const decided = Boolean(choice?.source) && (choice?.reason.trim().length ?? 0) >= minimumQuantityReasonLength;
    return total + (invoiceManufacturerCountryPoint(check, addressChoices) && !decided ? 1 : 0);
  }, 0);
}

/**
 * The manufacturer values that change in the file: the list address and name (only when the name really differs),
 * the country the analyst kept or took from the list, in capitals. Without a list, only the capitals apply.
 */
export function invoiceManufacturerCorrections(lines: readonly InvoiceManufacturerLine[],
  checks: readonly InvoiceManufacturerCheck[], addressChoices: Readonly<Record<number, string>>,
  countryChoices: Readonly<Record<number, InvoiceCountryChoice>>):
  Record<number, Partial<Record<"manufacturer" | "manufacturerAddress" | "manufacturerCountry", string>>> {
  const corrections: Record<number, Partial<Record<"manufacturer" | "manufacturerAddress" | "manufacturerCountry", string>>> = {};
  for (const line of lines) {
    const check = checks.find(entry => entry.sourceRow === line.sourceRow);
    const entry = check ? resolvedManufacturer(check, addressChoices) : null;
    const correction: Partial<Record<"manufacturer" | "manufacturerAddress" | "manufacturerCountry", string>> = {};
    if (entry?.address && entry.address !== line.manufacturerAddress.trim()) correction.manufacturerAddress = entry.address;
    // A similar or searched entry keeps the invoice name and corrects the address (user decision, 2026-11-11).
    if (entry?.name && check?.status !== "MISSING" && manufacturerKey(entry.name) !== manufacturerKey(line.manufacturer)) {
      correction.manufacturer = entry.name;
    }
    const listCountry = check ? invoiceManufacturerCountryPoint(check, addressChoices) : null;
    const country = (listCountry && countryChoices[line.sourceRow]?.source === "LIST" ? listCountry : line.manufacturerCountry)
      .trim().toLocaleUpperCase("pt-BR");
    if (country !== line.manufacturerCountry) correction.manufacturerCountry = country;
    if (Object.keys(correction).length) corrections[line.sourceRow] = correction;
  }
  return corrections;
}

/** The header country of origin keeps its countries and gets, in capitals, the line countries it does not cite. */
export function invoiceOriginCountries(header: string, lineCountries: readonly string[]):
  { missing: string[]; corrected: string | null } {
  const parts = header.split(/[,.;/]|\s+AND\s+|\s+&\s+/iu).map(part => part.trim()).filter(Boolean);
  const cited = new Set(parts.map(countryKey));
  const missing: string[] = [];
  for (const country of lineCountries) {
    const name = country.trim().toLocaleUpperCase("pt-BR");
    if (!name || cited.has(countryKey(name))) continue;
    cited.add(countryKey(name));
    missing.push(name);
  }
  return { missing, corrected: missing.length ? [...parts.map(part => part.toLocaleUpperCase("pt-BR")), ...missing].join(", ") : null };
}

/** The PKL weights of the invoice lines where the analyst took the PKL. */
export function invoicePackingChoiceWeights(divergences: readonly InvoicePackingDivergence[],
  choices: Readonly<Record<string, InvoicePackingChoice>>): Record<number, { netWeightKg: string; grossWeightKg: string }> {
  return Object.fromEntries(divergences.filter(divergence => choices[divergence.key]?.source === "PACKING"
    && divergence.invoiceRow !== null && divergence.packing)
    .map(divergence => [divergence.invoiceRow!, { netWeightKg: divergence.packing!.netWeightKg,
      grossWeightKg: divergence.packing!.grossWeightKg }]));
}

/*
 * The invoice audit shared by the audit page (POs of the Follow Up sent at the moment) and the IP screen (POs of the
 * platform), user decisions of 2026-11-12: the same rules, the same decisions and the same file, whatever the source.
 */

/** A PO item that can receive the invoice: a Follow Up line or a PO item of the platform. */
export type InvoiceAuditCandidate = InvoicePoItemCandidate & { lineNumber: number; poNumber: string; unit: string | null;
  unitPrice: string | null; currency: string | null;
  /** The supplier confirmed once against the Exporter; `supplierValues` and the aliases are what matches it. */
  supplier: string; supplierValues?: readonly (string | null | undefined)[]; exporterAliases?: readonly string[] };
/** `otherImporters`: the importers (visible to the user) where a PO missing from this importer is registered. */
export type InvoiceAuditPurchaseOrder<T extends InvoiceAuditCandidate> = { poExists: boolean; poStatus?: string; items: readonly T[];
  otherImporters?: readonly string[] };
export type InvoiceAuditSuggestion = { poNumber: string; available: string; ipNumber: string; sourceRows: number[] };
/** Where the POs come from: the items of a PO number, and the other POs that can take a part its PO cannot receive. */
export type InvoiceAuditSource<T extends InvoiceAuditCandidate = InvoiceAuditCandidate> = {
  purchaseOrder: (poNumber: string) => InvoiceAuditPurchaseOrder<T>;
  suggestions: (productCode: string, citedPo: string, quantity: string,
    taken: readonly { itemId: string; quantity: string }[]) => InvoiceAuditSuggestion[];
};

/** Every decision of the analyst in the audit, kept in one object so both screens share it and the bulk actions. */
export type InvoiceAuditDecisions = {
  quantities: Readonly<Record<string, string>>;
  quantityDecisions: Readonly<Record<number, InvoiceQuantityDecision>>;
  priceChoices: Readonly<Record<number, InvoicePriceChoice>>;
  supplierConfirmed: Readonly<Record<string, boolean>>;
  unitConfirmed: Readonly<Partial<Record<number, boolean>>>;
  packingChoices: Readonly<Record<string, InvoicePackingChoice>>;
  poChoices: Readonly<Record<string, string>>;
  splitAccepted: Readonly<Partial<Record<number, boolean>>>;
  poCellKept: Readonly<Record<number, InvoiceQuantityDecision>>;
  missingDecisions: Readonly<Record<number, InvoiceQuantityDecision>>;
  flaggedNcms: Readonly<Partial<Record<number, boolean>>>;
  addressChoices: Readonly<Record<number, string>>;
  countryChoices: Readonly<Record<number, InvoiceCountryChoice>>;
  manufacturerMissing: Readonly<Record<number, InvoiceQuantityDecision>>;
  pickedManufacturers: Readonly<Record<number, InvoiceManufacturerEntry>>;
};

export const emptyInvoiceAuditDecisions: InvoiceAuditDecisions = { quantities: {}, quantityDecisions: {}, priceChoices: {},
  supplierConfirmed: {}, unitConfirmed: {}, packingChoices: {}, poChoices: {}, splitAccepted: {}, poCellKept: {},
  missingDecisions: {}, flaggedNcms: {}, addressChoices: {}, countryChoices: {}, manufacturerMissing: {}, pickedManufacturers: {} };

/** The decisions on the path of the lines (destination, price, weights, supplier, unit), cleared when the POs change. */
export function invoiceAuditPathReset(decisions: InvoiceAuditDecisions): InvoiceAuditDecisions {
  return { ...decisions, quantities: {}, quantityDecisions: {}, priceChoices: {}, supplierConfirmed: {}, unitConfirmed: {},
    packingChoices: {}, poChoices: {}, splitAccepted: {}, poCellKept: {} };
}

/** The Follow Up or platform suppliers of the destined items that do not match the Exporter, each confirmed once. */
export function invoiceAuditSupplierMismatches(exporter: string,
  items: readonly Pick<InvoiceAuditCandidate, "supplier" | "supplierValues" | "exporterAliases">[]): string[] {
  const matches = new Map<string, boolean>();
  for (const item of items) {
    const supplier = item.supplier.trim().toLocaleUpperCase("en-US");
    if (!supplier) continue;
    matches.set(supplier, Boolean(matches.get(supplier))
      || invoiceSupplierMatchesExporter(item.supplierValues ?? [supplier], exporter, item.exporterAliases ?? []));
  }
  return [...matches].filter(([, matched]) => !matched).map(([supplier]) => supplier);
}

export type InvoiceLineUnitPoint = { invoiceUnit: string; poUnits: string[] };

/** The invoice unit of a line against the units of the PO items that receive it; the Follow Up has no unit, so no point. */
export function invoiceLineUnitPoint(invoiceUnit: string, poItems: readonly { unit: string | null }[]): InvoiceLineUnitPoint | null {
  const poUnits = [...new Set(poItems.map(item => item.unit?.trim() ?? "").filter(unit => invoicePoUnitDiffers(invoiceUnit, unit)))];
  return poUnits.length ? { invoiceUnit, poUnits } : null;
}

type InvoiceAuditDraftInput = { lines: readonly ChinaInvoiceLine[]; ipNumber: string; exporterText: string;
  packingList: InvoicePackingList; countryOfOrigin: string };
/** A line whose PO cell the reader could not split, with the POs found in it and the split proposed by balance. */
export type InvoiceAuditUnreadLine = { line: ChinaInvoiceLine; numbers: string[]; split: string[] };
export type InvoiceAuditPart<T extends InvoiceAuditCandidate> = ReturnType<typeof invoiceAssignmentsFromSplit>[number]
  & { invoiceQuantity: string; poExists: boolean; poStatus: string; keyItems: T[]; otherImporters: readonly string[] };
export type InvoiceAuditRow<T extends InvoiceAuditCandidate> = { part: InvoiceAuditPart<T>; line: ChinaInvoiceLine;
  decision: InvoiceQuantityDecision; allocations: { item: T; quantity: string }[]; points: InvoiceAuditPoint[];
  issue: InvoiceDestinationIssue | null; suggestions: InvoiceAuditSuggestion[] };
/** The points of each kind that one bulk action can decide (stage 1g), computed with the rules of the points. */
export type InvoiceAuditBulkRows = { prices: (readonly [number, InvoiceLinePricePoint])[]; packingKeys: string[];
  packingBothSheets: string[]; quantityRows: number[]; quantitySettledByConfirmation: number[]; unitRows: number[];
  catalogRows: number[]; countryRows: number[]; missingManufacturerRows: number[]; poCellRows: number[]; splittableRows: number[] };
export type InvoiceAuditModel<T extends InvoiceAuditCandidate> = {
  ready: boolean; unreadLines: InvoiceAuditUnreadLine[]; rows: InvoiceAuditRow<T>[];
  pricePoints: Map<number, InvoiceLinePricePoint>; unitPoints: Map<number, InvoiceLineUnitPoint>; supplierMismatches: string[];
  divergences: InvoicePackingDivergence[]; catalog: { points: InvoiceCatalogPoint[]; missing: InvoiceCatalogMissing[] };
  manufacturerChecks: InvoiceManufacturerCheck[]; manufacturerCorrections: ReturnType<typeof invoiceManufacturerCorrections>;
  /** Per manufacturer check: the list entry the analyst chose among the candidates, and the list country that differs. */
  manufacturerChoices: Map<number, { chosen: InvoiceManufacturerEntry | null; listCountry: string | null }>;
  origin: { missing: string[]; corrected: string | null }; pending: number; canDownload: boolean; bulk: InvoiceAuditBulkRows;
};

const noAuditDecision: InvoiceQuantityDecision = { confirmed: false, reason: "" };

/** A line whose PO cell is settled: split by balance, or kept without destination with a reason. */
export function invoicePoCellSettled(decisions: InvoiceAuditDecisions, sourceRow: number): boolean {
  return Boolean(decisions.splitAccepted[sourceRow]) || invoiceQuantityDecisionReady(decisions.poCellKept[sourceRow] ?? noAuditDecision);
}

/**
 * The whole audit of one invoice: destinations by PO and code (with the split of an unreadable PO cell and the PO
 * suggestions), the points of quantity, code, price, unit, supplier and INV × PKL, the DATABASE and the manufacturer
 * list, and what is still pending. Without a source the POs are not known yet, and only the content is audited.
 */
export function invoiceAuditModel<T extends InvoiceAuditCandidate>(input: { draft: InvoiceAuditDraftInput | null;
  source: InvoiceAuditSource<T> | null; products: readonly { productCode: string; ncm: string; description: string }[] | null;
  manufacturers: readonly InvoiceManufacturerEntry[] | null; decisions: InvoiceAuditDecisions }): InvoiceAuditModel<T> {
  const { draft, source, decisions } = input;
  const ready = Boolean(draft && source);
  const lines = draft?.lines ?? [];
  const lineByRow = new Map(lines.map(line => [line.sourceRow, line]));
  const baseParts = invoiceAssignmentsFromLines(lines);
  // IPH037D (2026-11-11): a PO cell the reader cannot split ("PO 030888&030201") leaves its line without parts. It is a
  // pending point; the split of the line by the balance of each cited PO, in cell order, is proposed.
  const unreadLines = source && draft ? lines.filter(line => line.poAssignments.length === 0).map(line => {
    const numbers = invoicePoCellNumbers(line.poCell);
    const split = invoicePoCellSplit(line.quantity, numbers.map(poNumber => {
      const order = source.purchaseOrder(poNumber);
      return invoiceKeyBalance((order.poStatus ?? "ACTIVE") === "ACTIVE" ? invoiceKeyItems(order.items, line.productCode) : []);
    }));
    return { line, numbers, split };
  }) : [];
  const destinedParts = [...baseParts,
    ...unreadLines.filter(entry => decisions.splitAccepted[entry.line.sourceRow] && entry.split.length > 0)
      .flatMap(entry => invoiceAssignmentsFromSplit(entry.line, entry.numbers, entry.split))]
    .sort((left, right) => left.sourceRow - right.sourceRow);
  const parts: InvoiceAuditPart<T>[] = source ? destinedParts.map(part => {
    const poNumber = decisions.poChoices[part.key] ?? part.poNumber;
    const { poExists, poStatus, items, otherImporters } = source.purchaseOrder(poNumber);
    return { ...part, poNumber, invoiceQuantity: part.quantity, quantity: decisions.quantities[part.key] ?? part.quantity, poExists,
      poStatus: poStatus ?? "ACTIVE", keyItems: invoiceKeyItems(items, part.productCode),
      otherImporters: poExists ? [] : otherImporters ?? [] };
  }) : [];
  // A PO that is closed, cancelled or deleted receives nothing (the platform lists no item of it; this keeps it so).
  const distribution = distributeInvoiceParts(parts.map(part => ({ key: part.key, quantity: part.quantity,
    items: part.poStatus === "ACTIVE" ? part.keyItems : [] })));
  const taken = [...distribution.values()].flatMap(entry => entry.allocations);
  const rows = parts.map((part): InvoiceAuditRow<T> => {
    const line = lineByRow.get(part.sourceRow)!;
    const decision = decisions.quantityDecisions[part.sourceRow] ?? noAuditDecision;
    const partDistribution = distribution.get(part.key);
    const allocations = (partDistribution?.allocations ?? []).flatMap(allocation => {
      const item = part.keyItems.find(candidate => candidate.id === allocation.itemId);
      return item ? [{ item, quantity: allocation.quantity }] : [];
    });
    const points = [invoiceQuantityPoint(part.invoiceQuantity, part.quantity, line.unit, decision),
      invoiceCodePoint(part.productCode, !part.poExists || part.poStatus !== "ACTIVE" || part.keyItems.length > 0, part.quantity,
        decision)]
      .filter((point): point is InvoiceAuditPoint => point !== null);
    const issue = classifyInvoiceDestination(part.keyItems, part.poExists, part.quantity, partDistribution, part.poStatus);
    const suggestions = source && issue && issue.kind !== "INVALID_QUANTITY"
      ? source.suggestions(part.productCode, part.poNumber, part.quantity, taken) : [];
    return { part, line, decision, allocations, points, issue, suggestions };
  });
  const itemsByRow = new Map<number, T[]>();
  for (const row of rows) {
    itemsByRow.set(row.part.sourceRow, [...(itemsByRow.get(row.part.sourceRow) ?? []), ...row.allocations.map(entry => entry.item)]);
  }
  const pricePoints = new Map<number, InvoiceLinePricePoint>();
  const unitPoints = new Map<number, InvoiceLineUnitPoint>();
  for (const line of lines) {
    const items = itemsByRow.get(line.sourceRow) ?? [];
    const price = invoiceLinePricePoint(line.unitPrice, items);
    if (price) pricePoints.set(line.sourceRow, price);
    const unit = invoiceLineUnitPoint(line.unit, items);
    if (unit) unitPoints.set(line.sourceRow, unit);
  }
  const supplierMismatches = draft ? invoiceAuditSupplierMismatches(draft.exporterText, [...itemsByRow.values()].flat()) : [];
  const divergences = draft?.packingList.status === "READ" ? invoicePackingDivergences(lines, draft.packingList.lines) : [];
  const catalog = draft && input.products ? invoiceCatalogPoints(lines, input.products) : { points: [], missing: [] };
  // An entry the analyst found by typing joins the line's candidates, so it is chosen like a similar one.
  const manufacturerChecks = (draft && input.manufacturers ? invoiceManufacturerChecks(lines, input.manufacturers) : [])
    .map(check => {
      const picked = decisions.pickedManufacturers[check.sourceRow];
      return picked && !check.candidates.some(entry => invoiceManufacturerId(entry) === invoiceManufacturerId(picked))
        ? { ...check, candidates: [...check.candidates, picked] } : check;
    });
  const manufacturerCorrections = draft
    ? invoiceManufacturerCorrections(lines, manufacturerChecks, decisions.addressChoices, decisions.countryChoices) : {};
  const origin = draft ? invoiceOriginCountries(draft.countryOfOrigin, lines.map(line =>
    manufacturerCorrections[line.sourceRow]?.manufacturerCountry ?? line.manufacturerCountry)) : { missing: [], corrected: null };
  const pending = rows.filter(row => row.issue !== null).length
    + unreadLines.filter(entry => !invoicePoCellSettled(decisions, entry.line.sourceRow)).length
    + rows.reduce((total, row) => total + row.points.filter(point => point.confirmed === false).length, 0)
    + [...pricePoints].filter(([row, point]) => !invoicePriceChoiceReady(point, decisions.priceChoices[row])).length
    + [...unitPoints.keys()].filter(row => !decisions.unitConfirmed[row]).length
    + supplierMismatches.filter(supplier => !decisions.supplierConfirmed[supplier]).length
    + divergences.filter(divergence => !invoicePackingChoiceReady(divergence, decisions.packingChoices[divergence.key])).length
    + catalog.missing.filter(entry => !decisions.flaggedNcms[entry.sourceRow]
      && !invoiceQuantityDecisionReady(decisions.missingDecisions[entry.sourceRow] ?? noAuditDecision)).length
    + invoiceManufacturerPending(manufacturerChecks, decisions.addressChoices, decisions.countryChoices, decisions.manufacturerMissing);
  const canDownload = ready && pending === 0 && rows.some(row => row.allocations.length > 0);
  const quantityRows = [...new Set(rows.filter(row => row.points.some(point => point.confirmed === false))
    .map(row => row.part.sourceRow))];
  // A code out of the PO is settled only by destining 0; confirming alone leaves it pending.
  const settledByConfirmation = (sourceRow: number) => rows.filter(row => row.part.sourceRow === sourceRow).every(row =>
    !row.points.some(point => point.kind === "CODE")
    || invoiceCodePoint(row.part.productCode, false, row.part.quantity, { confirmed: true, reason: "bulk" })?.confirmed === true);
  const poCellRows = unreadLines.filter(entry => !invoicePoCellSettled(decisions, entry.line.sourceRow)).map(entry => entry.line.sourceRow);
  const bulk: InvoiceAuditBulkRows = {
    prices: [...pricePoints].map(([row, point]) => [row, point] as const),
    packingKeys: divergences.map(divergence => divergence.key),
    packingBothSheets: divergences.filter(divergence => divergence.invoice && divergence.packing).map(divergence => divergence.key),
    quantityRows, quantitySettledByConfirmation: quantityRows.filter(settledByConfirmation), unitRows: [...unitPoints.keys()],
    // An NCM not found in the DATABASE is kept (confirmation) or flagged; neither action changes the other's points.
    catalogRows: catalog.missing.map(entry => entry.sourceRow).filter(row => !decisions.flaggedNcms[row]),
    countryRows: manufacturerChecks.filter(check => invoiceManufacturerCountryPoint(check, decisions.addressChoices))
      .map(check => check.sourceRow),
    missingManufacturerRows: manufacturerChecks.filter(check => check.status === "MISSING"
      && !check.candidates.some(entry => invoiceManufacturerId(entry) === decisions.addressChoices[check.sourceRow]))
      .map(check => check.sourceRow),
    // A PO cell without a proposal (no PO found in it) cannot be split: it stays pending for the split action.
    poCellRows, splittableRows: unreadLines.filter(entry => poCellRows.includes(entry.line.sourceRow) && entry.split.length > 0)
      .map(entry => entry.line.sourceRow),
  };
  const manufacturerChoices = new Map(manufacturerChecks.map(check => [check.sourceRow, {
    chosen: check.candidates.find(entry => invoiceManufacturerId(entry) === decisions.addressChoices[check.sourceRow]) ?? null,
    listCountry: invoiceManufacturerCountryPoint(check, decisions.addressChoices) }]));
  return { ready, unreadLines, rows, pricePoints, unitPoints, supplierMismatches, divergences, catalog, manufacturerChecks,
    manufacturerCorrections, manufacturerChoices, origin, pending, canDownload, bulk };
}

/** What the corrected invoice file takes from the audit: destined parts, corrected prices, PKL weights and references. */
export function invoiceAuditCorrectionInput<T extends InvoiceAuditCandidate>(model: InvoiceAuditModel<T>,
  decisions: InvoiceAuditDecisions) {
  const prices = Object.fromEntries([...model.pricePoints].filter(([row]) => decisions.priceChoices[row] === "CORRECT")
    .map(([row, point]) => [row, point.poPrices[0]]));
  const reference: Record<number, Record<string, string>> = { ...invoiceCatalogCorrections(model.catalog.points) };
  for (const [row, values] of Object.entries(model.manufacturerCorrections)) {
    reference[Number(row)] = { ...reference[Number(row)], ...values };
  }
  return { parts: model.rows.map(row => ({ sourceRow: row.part.sourceRow, poNumber: row.part.poNumber, quantity: row.part.quantity })),
    prices, weights: invoicePackingChoiceWeights(model.divergences, decisions.packingChoices), reference,
    ncmFlagRows: model.catalog.missing.filter(entry => decisions.flaggedNcms[entry.sourceRow]).map(entry => entry.sourceRow) };
}

/*
 * The platform POs as the source of the audit of the IP screen (user decisions, 2026-11-12): the PO items of the cited
 * POs (POST /api/v1/purchase-orders/invoice-candidates/batch) and, for the suggestions, the items of the same product with
 * balance in the other POs of the importer (POST .../invoice-candidates/by-product). Balances discount the other IPs and
 * not the IP under review, as the API computes them.
 */

/** The PO, product and supplier data the IP screen shows next to the audit (before × after, product completion, alias). */
type InvoicePlatformDetails = { purchaseOrderId?: string | null; orderedQuantity?: string | null; supplierEntryId?: string | null;
  productId?: string | null; productNcmCode?: string | null; manufacturer?: string | null; manufacturerAddress?: string | null;
  manufacturerCountry?: string | null };
export type InvoicePlatformItem = InvoicePlatformDetails & { id: string; lineNumber: number; poNumber: string; productCode: string;
  remainingQuantity: string; unit: string | null; unitPrice: string | null; currency: string | null; poStatus?: string | null;
  supplierText: string | null; supplierName: string | null; supplierCode: string | null; supplierExporterAliases?: readonly string[];
  linkedToRevisingIp?: boolean };
export type InvoicePlatformPurchaseOrder = { sourcePoNumber: string; poExists: boolean; poStatus: string | null;
  otherImporters?: readonly string[]; items: readonly InvoicePlatformItem[] };
export type InvoicePlatformCandidate = InvoiceAuditCandidate & InvoicePlatformDetails & { linkedToRevisingIp: boolean };

/**
 * The IP of the invoice as the system keeps it (user decision, 2026-11-12): the load of the Follow Up writes the HEXING IPs
 * without the IPH prefix (IPH034B/2026 is 034B/2026), so the audit reads the balance of the IP that exists with either
 * spelling, as the audit page does with the Follow Up. An active IP wins, then the exact spelling; without one, the invoice IP.
 */
const ipKey = (value: string) => value.toLocaleUpperCase("en-US").replace(/\s+/gu, "");
export function invoiceIpSearchText(invoiceIp: string): string {
  const ip = invoiceIp.trim();
  return /^IPH/iu.test(ip) ? ip.slice(3) : ip;
}
export function invoiceSystemIp(invoiceIp: string, stored: readonly { ipNumber: string; recordStatus?: string | null }[]): string {
  const invoice = ipKey(invoiceIp);
  const same = (ipNumber: string) => Boolean(invoice) && (ipKey(ipNumber) === invoice
    || (invoice.startsWith("IPH") && ipKey(ipNumber) === invoice.slice(3)));
  const found = stored.filter(entry => same(entry.ipNumber))
    .sort((left, right) => Number(left.recordStatus !== "ACTIVE") - Number(right.recordStatus !== "ACTIVE")
      || Number(ipKey(left.ipNumber) !== invoice) - Number(ipKey(right.ipNumber) !== invoice));
  return found[0]?.ipNumber.trim() ?? invoiceIp.trim();
}

/**
 * The IP an invoice saves into (phase B1, user decision 2026-11-12): the IP with the invoice number when it can still be
 * revised (active or draft); else the same IP that the Follow Up load keeps without the IPH prefix, which is revised and keeps
 * its number; else the invoice number, which creates the IP or meets the cancelled or closed IP with that number. Unlike
 * invoiceSystemIp (the balance the audit reads), a cancelled IP without the prefix does not take the invoice. The stored IPs
 * must be those of the invoice importer. Mirrored by apps/api/src/invoice-ip-number.ts (test invoice-ip-number.test.mjs).
 */
export function invoiceSaveIpNumber(invoiceIp: string, stored: readonly { ipNumber: string; recordStatus?: string | null }[]): string {
  const key = (value: string) => value.trim().toLocaleUpperCase("en-US");
  const revisable = (status: string | null | undefined) => status === "ACTIVE" || status === "DRAFT";
  const invoice = key(invoiceIp);
  if (!invoice) return invoiceIp.trim();
  const exact = stored.find(entry => key(entry.ipNumber) === invoice);
  if (exact && revisable(exact.recordStatus)) return exact.ipNumber.trim();
  const withoutPrefix = invoice.startsWith("IPH") ? invoice.slice(3).trim() : "";
  const kept = withoutPrefix
    ? stored.find(entry => key(entry.ipNumber) === withoutPrefix && revisable(entry.recordStatus)) : undefined;
  return (kept ?? exact)?.ipNumber.trim() ?? invoiceIp.trim();
}

/** Same normalization as the candidate routes: letters and digits, without the PO prefix. */
export function invoicePlatformPoKey(value: string): string {
  return value.toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "").replace(/^PO/u, "");
}

function platformCandidate(item: InvoicePlatformItem): InvoicePlatformCandidate {
  return { id: item.id, lineNumber: item.lineNumber, poNumber: item.poNumber, productCode: item.productCode,
    remainingQuantity: item.remainingQuantity, unit: item.unit, unitPrice: item.unitPrice, currency: item.currency,
    supplier: item.supplierCode || item.supplierName || item.supplierText || "",
    supplierValues: [item.supplierText, item.supplierName, item.supplierCode], exporterAliases: item.supplierExporterAliases ?? [],
    linkedToRevisingIp: Boolean(item.linkedToRevisingIp), purchaseOrderId: item.purchaseOrderId ?? null,
    orderedQuantity: item.orderedQuantity ?? null, supplierEntryId: item.supplierEntryId ?? null, productId: item.productId ?? null,
    productNcmCode: item.productNcmCode ?? null, manufacturer: item.manufacturer ?? null,
    manufacturerAddress: item.manufacturerAddress ?? null, manufacturerCountry: item.manufacturerCountry ?? null };
}

/** The invoice POs and products the candidate routes are asked for: cited POs (also those of an unreadable cell) and codes. */
export function invoicePlatformRequests(lines: readonly ChinaInvoiceLine[]): { poNumbers: string[];
  products: { productCode: string; quantity: string }[] } {
  const poNumbers = new Map<string, string>();
  for (const line of lines) {
    const numbers = line.poAssignments.length ? line.poAssignments.map(assignment => assignment.poNumber) : invoicePoCellNumbers(line.poCell);
    // The routes take PO numbers and codes of up to 80 characters; a longer one would refuse the whole call.
    for (const poNumber of numbers) if (invoicePlatformPoKey(poNumber) && poNumber.trim().length <= 80
      && !poNumbers.has(invoicePlatformPoKey(poNumber))) {
      poNumbers.set(invoicePlatformPoKey(poNumber), poNumber);
    }
  }
  const products = new Map<string, { productCode: string; quantity: string }>();
  for (const line of lines) {
    const productCode = line.productCode.trim();
    const key = productCode.toLocaleUpperCase("en-US");
    if (productCode && productCode.length <= 80 && invoiceQuantityUnits(line.quantity) !== null
      && invoiceQuantityUnits(line.quantity)! > 0n && !products.has(key)) {
      products.set(key, { productCode, quantity: line.quantity });
    }
  }
  return { poNumbers: [...poNumbers.values()], products: [...products.values()] };
}

export function invoicePlatformAuditSource(purchaseOrders: readonly InvoicePlatformPurchaseOrder[],
  byProduct: readonly { productCode: string; items: readonly InvoicePlatformItem[] }[],
  revisingIpNumber: string): InvoiceAuditSource<InvoicePlatformCandidate> {
  const cited = new Map(purchaseOrders.map(order => [invoicePlatformPoKey(order.sourcePoNumber),
    { poExists: order.poExists, poStatus: order.poStatus ?? (order.poExists ? "ACTIVE" : undefined), items: order.items.map(platformCandidate),
      ...(order.otherImporters?.length ? { otherImporters: order.otherImporters } : {}) }]));
  // The items with balance of each product and of each PO, in the order of the route, each item once.
  const seen = new Set<string>();
  const byCode = new Map<string, InvoicePlatformCandidate[]>();
  const byPo = new Map<string, InvoicePlatformCandidate[]>();
  for (const entry of byProduct) for (const item of entry.items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const candidate = platformCandidate(item);
    const code = item.productCode.trim().toLocaleUpperCase("en-US");
    const ofCode = byCode.get(code);
    if (ofCode) ofCode.push(candidate); else byCode.set(code, [candidate]);
    const po = invoicePlatformPoKey(item.poNumber);
    const ofPo = byPo.get(po);
    if (ofPo) ofPo.push(candidate); else byPo.set(po, [candidate]);
  }
  return {
    purchaseOrder: poNumber => {
      const key = invoicePlatformPoKey(poNumber);
      const order = cited.get(key);
      if (order) return order;
      const items = byPo.get(key) ?? [];
      return items.length ? { poExists: true, poStatus: "ACTIVE", items } : { poExists: false, items: [] };
    },
    suggestions: (productCode, citedPo, quantity, taken) => {
      const requested = invoiceQuantityUnits(quantity);
      if (requested === null || requested === 0n) return [];
      const used = new Map<string, bigint>();
      for (const entry of taken) used.set(entry.itemId, (used.get(entry.itemId) ?? 0n) + (invoiceQuantityUnits(entry.quantity) ?? 0n));
      const citedKey = invoicePlatformPoKey(citedPo);
      const pos = new Map<string, { poNumber: string; key: string; available: bigint; linked: boolean; sourceRows: number[] }>();
      for (const item of byCode.get(productCode.trim().toLocaleUpperCase("en-US")) ?? []) {
        const po = invoicePlatformPoKey(item.poNumber);
        if (po === citedKey) continue;
        const free = (invoiceQuantityUnits(item.remainingQuantity) ?? 0n) - (used.get(item.id) ?? 0n);
        if (free <= 0n) continue;
        const entry = pos.get(po) ?? { poNumber: item.poNumber, key: po, available: 0n, linked: false, sourceRows: [] };
        pos.set(po, { ...entry, available: entry.available + free, linked: entry.linked || item.linkedToRevisingIp,
          sourceRows: [...entry.sourceRows, item.lineNumber] });
      }
      // As the Follow Up suggestions: the POs on the IP of the invoice first, then the exact balance of this part, then the
      // PO number (the route ordered by the quantity of the first line of the code, not of this part).
      return [...pos.values()].filter(entry => entry.available >= requested)
        .sort((left, right) => Number(!left.linked) - Number(!right.linked)
          || Number(left.available !== requested) - Number(right.available !== requested)
          || left.key.localeCompare(right.key, "en-US", { numeric: true }) || left.sourceRows[0] - right.sourceRows[0])
        .map(entry => ({ poNumber: entry.poNumber, available: formatInvoiceQuantity(entry.available),
          ipNumber: entry.linked ? revisingIpNumber : "", sourceRows: entry.sourceRows }));
    },
  };
}

/*
 * Phase B2 (docs/PLANO_INVOICE_IP_AUDITORIA_DISTRIBUICAO.md, user decisions of 2026-11-12): the IP is saved with the invoice
 * audited on the IP screen, as the analyst downloaded it. The API checks every changed value again
 * (apps/api/src/invoice-audit-check.ts), so the payload carries the lines of the file, the lines as the reader returned them
 * from the original file and every decision of the audit.
 */

export type InvoiceAuditReferenceLoads = { productDatabaseLoadId: string | null; manufacturerListLoadId: string | null };
/** The audited invoice of the last download: the model and decisions of that moment, the file lines and the file itself. */
export type InvoiceAuditedFile<T extends InvoiceAuditCandidate = InvoiceAuditCandidate> = {
  model: InvoiceAuditModel<T>; decisions: InvoiceAuditDecisions; corrections: readonly InvoiceLineCorrection[];
  totals: InvoiceCorrectedTotals; sha256: string; fileName: string; references: InvoiceAuditReferenceLoads };

const invoiceAuditLineFields = ["quantity", "poCell", "unitPrice", "netWeightKg", "grossWeightKg", "amount", "ncm", "description",
  "manufacturer", "manufacturerAddress", "manufacturerCountry"] as const;
const supplierKey = (item: Pick<InvoiceAuditCandidate, "supplier">) => item.supplier.trim().toLocaleUpperCase("en-US");

/** A product the invoice can complete: the first destined line of the code and the empty fields it fills (R7). */
export type InvoiceAuditProductFill = { productCode: string; productId: string; sourceRow: number; fields: InvoiceProductFillField[];
  values: { ncmCode: string | null; manufacturer: string | null; manufacturerAddress: string | null; manufacturerCountry: string | null } };

/**
 * The products of the audited invoice that have empty fields the audited values fill. A flagged NCM (not found in the
 * DATABASE) never goes to the catalog (user decision 7, 2026-11-12), and the description is never offered.
 */
export function invoiceAuditProductFills<T extends InvoicePlatformCandidate>(audited: InvoiceAuditedFile<T>): InvoiceAuditProductFill[] {
  const corrected = new Map(audited.corrections.map(correction => [correction.sourceRow, correction.corrected]));
  const fills = new Map<string, InvoiceAuditProductFill>();
  for (const row of audited.model.rows) for (const { item } of row.allocations) {
    const code = item.productCode.trim().toLocaleUpperCase("en-US");
    const line = corrected.get(row.part.sourceRow);
    if (fills.has(code) || !item.productId || !line) continue;
    const flagged = Boolean(audited.decisions.flaggedNcms[row.part.sourceRow]);
    const fields = invoiceProductFillFields({ ...line, ncm: flagged ? "" : line.ncm }, { ncmCode: item.productNcmCode ?? null,
      manufacturer: item.manufacturer ?? null, manufacturerAddress: item.manufacturerAddress ?? null,
      manufacturerCountry: item.manufacturerCountry ?? null });
    if (!fields.length) continue;
    const value = (field: InvoiceProductFillField, text: string) => fields.includes(field) && text.trim() ? text.trim() : null;
    fills.set(code, { productCode: item.productCode, productId: item.productId, sourceRow: row.part.sourceRow, fields,
      values: { ncmCode: value("ncm", line.ncm), manufacturer: value("manufacturer", line.manufacturer),
        manufacturerAddress: value("manufacturerAddress", line.manufacturerAddress),
        manufacturerCountry: value("manufacturerCountry", line.manufacturerCountry) } });
  }
  return [...fills.values()];
}

/** "Check all" or "Uncheck all" of the product completion: every product shown, and only them. */
export function invoiceProductFillSelection(fills: readonly Pick<InvoiceAuditProductFill, "productCode">[],
  checked: boolean): Record<string, boolean> {
  return Object.fromEntries(fills.map(fill => [fill.productCode, checked]));
}

/** How many of the products shown are checked; a product of an earlier audit that is no longer shown does not count. */
export function invoiceProductFillCount(fills: readonly Pick<InvoiceAuditProductFill, "productCode">[],
  selection: Readonly<Record<string, boolean>>): number {
  return fills.filter(fill => selection[fill.productCode]).length;
}

/**
 * What the IP saves from the audited invoice: the lines and totals of the downloaded file, the destinations of the audit
 * with their confirmations, the line decisions and `audit` (original lines, reference loads and decisions with reasons).
 * `fills` are the products the analyst chose to complete.
 */
export function invoiceAuditSavePayload<T extends InvoicePlatformCandidate>(input: { lines: readonly ChinaInvoiceLine[];
  countryOfOrigin: string; invoiceLabel: string; audited: InvoiceAuditedFile<T>; fills: readonly InvoiceAuditProductFill[] }) {
  const { audited, lines } = input;
  const { model, decisions } = audited;
  const corrected = new Map(audited.corrections.map(correction => [correction.sourceRow, correction.corrected]));
  const savedLines = lines.map(line => {
    const values = corrected.get(line.sourceRow);
    return { sourceRow: line.sourceRow, lineNumber: line.lineNumber, productCode: line.productCode, unit: line.unit,
      ...Object.fromEntries(invoiceAuditLineFields.map(field => [field, values ? values[field] : line[field]])) } as
      { sourceRow: number; lineNumber: string; productCode: string; unit: string } & Record<typeof invoiceAuditLineFields[number], string>;
  });
  const mismatched = new Set(model.supplierMismatches);
  const { assignments, allocations } = invoiceSavePayload(input.invoiceLabel, model.rows.flatMap(row =>
    row.allocations.map(({ item, quantity }) => ({ sourceRow: row.part.sourceRow, sourcePoNumber: row.part.poNumber,
      productCode: row.part.productCode, itemId: item.id, poNumber: item.poNumber, poProductCode: item.productCode, quantity,
      confirmSupplierMismatch: mismatched.has(supplierKey(item)) && Boolean(decisions.supplierConfirmed[supplierKey(item)]),
      confirmUnitMismatch: model.unitPoints.has(row.part.sourceRow) && Boolean(decisions.unitConfirmed[row.part.sourceRow]),
      confirmPriceMismatch: model.pricePoints.has(row.part.sourceRow) && decisions.priceChoices[row.part.sourceRow] === "ACCEPT" }))));
  // A line kept without destination (unreadable PO cell) is destined with 0 and the reason of that decision.
  const kept = model.unreadLines.filter(entry => !decisions.splitAccepted[entry.line.sourceRow]).map(entry => entry.line);
  const lineDecisions = invoiceLineDecisions(savedLines,
    [...model.rows.map(row => ({ sourceRow: row.part.sourceRow, invoiceQuantity: row.part.invoiceQuantity, quantity: row.part.quantity })),
      ...kept.map(line => ({ sourceRow: line.sourceRow, invoiceQuantity: line.quantity, quantity: "0" }))],
    { ...decisions.quantityDecisions, ...Object.fromEntries(kept.map(line => [line.sourceRow, decisions.poCellKept[line.sourceRow]])) });
  const reason = (decision: { reason: string } | undefined) => decision?.reason.trim() ?? "";
  const audit = {
    auditedFileSha256: audited.sha256, auditedFileName: audited.fileName, references: audited.references,
    originalHeader: { countryOfOrigin: input.countryOfOrigin },
    originalLines: lines.map(line => ({ sourceRow: line.sourceRow, lineNumber: line.lineNumber, productCode: line.productCode,
      unit: line.unit, ...Object.fromEntries(invoiceAuditLineFields.map(field => [field, line[field]])) })),
    decisions: {
      catalogMissing: model.catalog.missing.map(entry => decisions.flaggedNcms[entry.sourceRow]
        ? { sourceRow: entry.sourceRow, action: "FLAG" as const, reason: "" }
        : { sourceRow: entry.sourceRow, action: "KEEP" as const, reason: reason(decisions.missingDecisions[entry.sourceRow]) }),
      manufacturers: model.manufacturerChecks.flatMap(check => {
        const choice = model.manufacturerChoices.get(check.sourceRow);
        const entry = choice?.chosen ?? check.entry;
        if (!entry) return [];
        const country = choice?.listCountry ? decisions.countryChoices[check.sourceRow] : undefined;
        return [{ sourceRow: check.sourceRow, referenceRow: entry.sourceRow, country: country?.source ?? null, reason: reason(country) }];
      }),
      manufacturerMissing: model.manufacturerChecks.filter(check => check.status === "MISSING"
        && !model.manufacturerChoices.get(check.sourceRow)?.chosen)
        .map(check => ({ sourceRow: check.sourceRow, reason: reason(decisions.manufacturerMissing[check.sourceRow]) })),
      prices: [...model.pricePoints.keys()].map(sourceRow => ({ sourceRow, choice: decisions.priceChoices[sourceRow] ?? "ACCEPT" })),
      packing: model.divergences.map(divergence => ({ key: divergence.key, sourceRow: divergence.invoiceRow,
        source: decisions.packingChoices[divergence.key]?.source ?? "INVOICE", reason: reason(decisions.packingChoices[divergence.key]) })),
      poCells: model.unreadLines.map(entry => decisions.splitAccepted[entry.line.sourceRow]
        ? { sourceRow: entry.line.sourceRow, action: "SPLIT" as const, reason: "" }
        : { sourceRow: entry.line.sourceRow, action: "KEEP" as const, reason: reason(decisions.poCellKept[entry.line.sourceRow]) }),
      poChanges: model.rows.filter(row => row.part.poNumber !== row.part.sourcePoNumber)
        .map(row => ({ sourceRow: row.part.sourceRow, from: row.part.sourcePoNumber, to: row.part.poNumber })),
      suppliers: model.supplierMismatches.filter(supplier => decisions.supplierConfirmed[supplier]),
      units: [...model.unitPoints.keys()].filter(sourceRow => decisions.unitConfirmed[sourceRow]),
    },
  };
  return { lines: savedLines, amount: audited.totals.amount, totalQuantity: audited.totals.quantity,
    totalNetWeightKg: audited.totals.netWeightKg, totalGrossWeightKg: audited.totals.grossWeightKg,
    countryOfOrigin: model.origin.corrected ?? input.countryOfOrigin, assignments, allocations, lineDecisions, audit,
    catalogUpdates: { products: input.fills.map(fill => ({ productCode: fill.productCode, ...fill.values })) } };
}
