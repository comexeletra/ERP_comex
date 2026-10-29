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
  return lines.flatMap(line => line.poAssignments.map((assignment, index) => ({
    key: `${line.sourceRow}:${index}`, sourceRow: line.sourceRow, sourcePoNumber: assignment.poNumber,
    poNumber: assignment.poNumber, quantity: assignment.quantity, productCode: line.productCode,
    description: line.description,
  })));
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
  return new Map(parts.map(part => {
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

export function invoicePoUnitDiffers(invoiceUnit: string, poUnit: string): boolean {
  const invoice = normalizeUnit(invoiceUnit), po = normalizeUnit(poUnit);
  if (invoice === po) return false;
  return !equivalentUnitGroups.some(group => group.includes(invoice) && group.includes(po));
}

export function invoicePoPriceDiffers(invoicePrice: string, poPrice: string | null, poCurrency: string | null): boolean {
  return poCurrency === "CNY" && poPrice !== null && Number.isFinite(Number(invoicePrice))
    && Number.isFinite(Number(poPrice)) && Math.abs(Number(invoicePrice) - Number(poPrice)) > 0.00000001;
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
export type InvoiceAuditPoint = { kind: InvoiceAuditPointKind; invoiceValue: string; poValue: string; confirmed: boolean | null };
type InvoiceAuditInvoice = { productCode: string; exporter: string; line: { unit: string; unitPrice: string } | null };
type InvoiceAuditPoItem = { productCode: string; unit: string; unitPrice: string | null; currency: string | null;
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
    points.push({ kind: "UNIT", invoiceValue: invoice.line.unit, poValue: poItem.unit, confirmed: confirmations.unit });
  }
  if (invoice.line && invoicePoPriceDiffers(invoice.line.unitPrice, poItem.unitPrice, poItem.currency)) {
    points.push({ kind: "PRICE", invoiceValue: `${invoice.line.unitPrice} CNY`,
      poValue: `${poItem.unitPrice} ${poItem.currency}`, confirmed: confirmations.price });
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
  poItem: { description: string; unit: string; ncmCode: string | null; unitPrice: string | null; currency: string | null },
  product: { name: string | null; ncmCode: string | null; manufacturer: string | null },
): InvoiceComparisonRow[] {
  const ncms = new Set([invoiceLine?.ncm, poItem.ncmCode, product.ncmCode]
    .map(value => (value ?? "").replace(/\D/gu, "")).filter(Boolean));
  const poPrice = poItem.unitPrice === null ? "" : `${poItem.unitPrice} ${poItem.currency ?? ""}`.trim();
  return [
    { field: "description", invoice: invoiceLine?.description ?? "", poItem: poItem.description, product: product.name ?? "", differs: false },
    { field: "ncm", invoice: invoiceLine?.ncm ?? "", poItem: poItem.ncmCode ?? "", product: product.ncmCode ?? "", differs: ncms.size > 1 },
    { field: "unit", invoice: invoiceLine?.unit ?? "", poItem: poItem.unit, product: "",
      differs: Boolean(invoiceLine?.unit && poItem.unit && invoicePoUnitDiffers(invoiceLine.unit, poItem.unit)) },
    { field: "price", invoice: invoiceLine?.unitPrice ? `${invoiceLine.unitPrice} CNY` : "", poItem: poPrice, product: "",
      differs: Boolean(invoiceLine && invoicePoPriceDiffers(invoiceLine.unitPrice, poItem.unitPrice, poItem.currency)) },
    { field: "manufacturer", invoice: invoiceLine?.manufacturer ?? "", poItem: "", product: product.manufacturer ?? "", differs: false },
  ];
}
