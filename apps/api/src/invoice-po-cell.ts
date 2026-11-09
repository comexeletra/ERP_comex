// The PO cell of a China invoice line cites one PO ("PO030201") or splits the line among
// POs with a quantity each ("PO 030321 = 412 unit\nPO 032025 = 8 unit"). The web reads the
// same cell when the file is loaded: parseInvoicePoAssignments in apps/web/lib/china-invoice-xlsx.ts,
// kept equal by test/invoice-po-cell.test.mjs.

export type InvoicePoCellPart = { poNumber: string; quantity: string | null };

const partPattern = /\bPO\s*([0-9]{3,})(?:\s*=\s*([0-9][0-9,.]*)\s*(?:units?|pcs?)\b)?/giu;
/** `1,000` and `12,500.5` group thousands with commas. */
const commaThousands = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u;

/** Plain decimal text of a written quantity (no trailing zeros), or null when it is not a number. */
export function invoiceCellQuantity(text: string): string | null {
  let normalized = text.trim();
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (commaThousands.test(normalized)) normalized = normalized.replace(/,/gu, "");
  else if (comma >= 0 && dot >= 0) {
    normalized = comma > dot ? normalized.replace(/\./gu, "").replace(",", ".") : normalized.replace(/,/gu, "");
  } else if (comma >= 0) normalized = normalized.replace(",", ".");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(normalized)) return null;
  return normalized.includes(".") ? normalized.replace(/0+$/u, "").replace(/\.$/u, "") : normalized;
}

/** The POs cited by the cell, in order, with the quantity written for each (null when none). */
export function parseInvoicePoCell(cell: string): InvoicePoCellPart[] {
  return [...cell.matchAll(partPattern)].map(match => ({
    poNumber: match[1], quantity: match[2] === undefined ? null : invoiceCellQuantity(match[2]),
  }));
}
