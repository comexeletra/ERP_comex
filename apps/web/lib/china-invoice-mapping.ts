export type InvoicePoItemCandidate = { id: string; productCode: string; remainingQuantity: string };
export type InvoiceDestinationIssue = { kind: "PO_NOT_REGISTERED" } | { kind: "PO_NOT_ACTIVE"; status: "CANCELLED" | "CLOSED" | "DELETED" }
  | { kind: "ITEM_NOT_FOUND" }
  | { kind: "INSUFFICIENT_BALANCE"; requested: string; available: string };

export function classifyInvoiceDestination(candidates: readonly InvoicePoItemCandidate[], poExists: boolean,
  invoiceProductCode: string, quantity: string, selectedItemId: string, poStatus = "ACTIVE"): InvoiceDestinationIssue | null {
  if (!poExists) return { kind: "PO_NOT_REGISTERED" };
  if (poStatus === "CANCELLED" || poStatus === "CLOSED" || poStatus === "DELETED") {
    return { kind: "PO_NOT_ACTIVE", status: poStatus };
  }
  const exact = candidates.filter(item => !invoicePoCodeDiffers(item.productCode, invoiceProductCode));
  const selected = candidates.find(item => item.id === selectedItemId);
  if (selected && Number(selected.remainingQuantity) >= Number(quantity)) return null;
  if (selected) return { kind: "INSUFFICIENT_BALANCE", requested: quantity, available: selected.remainingQuantity };
  if (!exact.length) return { kind: "ITEM_NOT_FOUND" };
  const available = Math.max(...exact.map(item => Number(item.remainingQuantity)));
  if (available < Number(quantity)) return { kind: "INSUFFICIENT_BALANCE", requested: quantity, available: String(available) };
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

export function suggestInvoicePoItem<T extends InvoicePoItemCandidate>(
  candidates: readonly T[], invoiceProductCode: string, invoiceQuantity: string,
): T | undefined {
  const enough = candidates.filter(candidate => Number(candidate.remainingQuantity) >= Number(invoiceQuantity));
  const exact = enough.filter(candidate => candidate.productCode.trim().toLocaleUpperCase("en-US")
    === invoiceProductCode.trim().toLocaleUpperCase("en-US"));
  if (exact.length === 1) return exact[0];
  return undefined;
}

export function invoiceCandidatesForProduct<T extends InvoicePoItemCandidate & { lineNumber: number }>(
  items: readonly T[], productCode: string,
): T[] {
  return [...items].sort((left, right) => {
    const leftMatches = !invoicePoCodeDiffers(left.productCode, productCode);
    const rightMatches = !invoicePoCodeDiffers(right.productCode, productCode);
    if (leftMatches !== rightMatches) return leftMatches ? -1 : 1;
    return left.lineNumber - right.lineNumber;
  });
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

export type InvoiceAuditPointKind = "CODE" | "SUPPLIER" | "UNIT" | "PRICE" | "CURRENCY";
/** `confirmed` is null for informative points that need analysis but no confirmation. */
export type InvoiceAuditPoint = { kind: InvoiceAuditPointKind; invoiceValue: string; poValue: string; confirmed: boolean | null };

export function invoiceAuditPoints(
  invoice: { productCode: string; exporter: string; line: { unit: string; unitPrice: string } | null },
  poItem: { productCode: string; unit: string; unitPrice: string | null; currency: string | null;
    supplierValues: readonly (string | null | undefined)[]; exporterAliases?: readonly string[] },
  confirmations: { code: boolean; supplier: boolean; unit: boolean; price: boolean },
): InvoiceAuditPoint[] {
  const points: InvoiceAuditPoint[] = [];
  if (invoicePoCodeDiffers(invoice.productCode, poItem.productCode)) {
    points.push({ kind: "CODE", invoiceValue: invoice.productCode, poValue: poItem.productCode, confirmed: confirmations.code });
  }
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
