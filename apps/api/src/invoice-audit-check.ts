import { z } from "zod";
import { parseInvoicePoCell } from "./invoice-po-cell.js";

/*
 * Phase B2 of docs/PLANO_INVOICE_IP_AUDITORIA_DISTRIBUICAO.md (user decisions, 2026-11-12): the IP is saved with the
 * invoice audited on the IP screen. The screen sends the lines of the downloaded file, the lines as the reader returned
 * them from the original file and the decisions of the analyst; this module checks again, without trusting the screen,
 * that every changed value has its reason and comes from the reference loads (M082) or from the POs. The rules mirror
 * apps/web/lib/china-invoice-mapping.ts and apps/web/lib/invoice-correction-xlsx.ts, kept equal by
 * test/invoice-audit-check.test.mjs.
 */

const sourceRow = z.number().int().positive();
const reason = z.string().trim().max(1000);
const auditLine = z.object({
  sourceRow, lineNumber: z.string().max(40), productCode: z.string().max(120), unit: z.string().max(32),
  quantity: z.string().max(40), poCell: z.string().max(1000), unitPrice: z.string().max(40), netWeightKg: z.string().max(40),
  grossWeightKg: z.string().max(40), amount: z.string().max(40), ncm: z.string().max(40), description: z.string().max(1000),
  manufacturer: z.string().max(240), manufacturerAddress: z.string().max(500), manufacturerCountry: z.string().max(120),
}).strict();

export const invoiceAuditSchema = z.object({
  auditedFileSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  auditedFileName: z.string().trim().min(1).max(255),
  references: z.object({ productDatabaseLoadId: z.uuid().nullable(), manufacturerListLoadId: z.uuid().nullable() }).strict(),
  originalHeader: z.object({ countryOfOrigin: z.string().max(500) }).strict(),
  originalLines: z.array(auditLine).min(1).max(2000),
  decisions: z.object({
    catalogMissing: z.array(z.object({ sourceRow, action: z.enum(["KEEP", "FLAG"]), reason }).strict()).max(2000),
    manufacturers: z.array(z.object({ sourceRow, referenceRow: sourceRow.nullable(),
      country: z.enum(["INVOICE", "LIST"]).nullable(), reason }).strict()).max(2000),
    manufacturerMissing: z.array(z.object({ sourceRow, reason }).strict()).max(2000),
    prices: z.array(z.object({ sourceRow, choice: z.enum(["ACCEPT", "CORRECT"]) }).strict()).max(2000),
    packing: z.array(z.object({ key: z.string().max(80), sourceRow: sourceRow.nullable(),
      source: z.enum(["INVOICE", "PACKING"]), reason }).strict()).max(4000),
    poCells: z.array(z.object({ sourceRow, action: z.enum(["SPLIT", "KEEP"]), reason }).strict()).max(2000),
    poChanges: z.array(z.object({ sourceRow, from: z.string().trim().min(1).max(80), to: z.string().trim().min(1).max(80) }).strict())
      .max(4000),
    suppliers: z.array(z.string().max(240)).max(200),
    units: z.array(sourceRow).max(2000),
  }).strict(),
}).strict();
export type InvoiceAudit = z.infer<typeof invoiceAuditSchema>;

export const invoiceAuditFields = ["quantity", "poCell", "unitPrice", "netWeightKg", "grossWeightKg", "amount", "ncm",
  "description", "manufacturer", "manufacturerAddress", "manufacturerCountry"] as const;
export type InvoiceAuditField = typeof invoiceAuditFields[number];
type AuditValues = Record<InvoiceAuditField, string>;
export type InvoiceAuditSavedLine = { sourceRow: number; productCode: string } & Partial<Record<InvoiceAuditField | "unit" | "lineNumber", unknown>>;

/** Same as invoicePoCellNumbers in the web: the numbers of 5 or more digits of a cell without quantities, in order, once. */
export function invoicePoCellNumbers(cell: string): string[] {
  if (cell.includes("=")) return [];
  return [...new Set(cell.match(/\d{5,}/gu) ?? [])];
}

const manufacturerKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/gu, "")
  .toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "");
const countrySpellings: Readonly<Record<string, string>> = { EUA: "USA", ESTADOSUNIDOS: "USA", UNITEDSTATES: "USA", JAPAO: "JAPAN" };
const countryKey = (value: string) => { const key = manufacturerKey(value); return countrySpellings[key] ?? key; };

/** Same as invoiceOriginCountries in the web: the header keeps its countries and gets the line countries it does not cite. */
export function invoiceOriginCountries(header: string, lineCountries: readonly string[]): { missing: string[]; corrected: string | null } {
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

const scale = 10n ** 18n;
/** A decimal in units of 10^-18, or null when it is not a plain decimal. */
export function invoiceAuditDecimal(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:[.,](\d{1,18}))?$/u.exec(value.trim());
  if (!match) return null;
  const result = BigInt(match[2]) * scale + BigInt((match[3] ?? "").padEnd(18, "0"));
  return match[1] ? -result : result;
}

/**
 * Same as invoiceLinePricePoint in the web: the distinct CNY prices of the PO items that receive a line. The audit can
 * correct the invoice price only to the one price there is.
 */
export function invoiceAuditPoPrices(items: readonly { unitPrice: string | null; currency: string | null }[]): string[] {
  const prices = items.filter(item => item.currency === "CNY" && item.unitPrice !== null).map(item => item.unitPrice!);
  return prices.filter((price, index) => prices.findIndex(other => invoiceAuditDecimal(other) === invoiceAuditDecimal(price)) === index);
}

const normalizePo = (value: string) => value.toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "").replace(/^PO/u, "");
const text = (value: unknown) => typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
const minimumReason = 3;

export type InvoiceAuditProblem = { status: number; code: string; detail: string };
export type InvoiceAuditCheckInput = {
  lines: readonly InvoiceAuditSavedLine[];
  /** The header country of origin the screen saves. */
  countryOfOrigin: string;
  audit: InvoiceAudit;
  /** The line decisions of the payload, by row (destined quantity and its reason). */
  lineDecisions: ReadonlyMap<number, { confirmQuantityMismatch: boolean; quantityMismatchReason: string }>;
  /** The DATABASE rows of the cited load by product code (upper case), or null when no load is cited. */
  products: ReadonlyMap<string, { ncm: string; description: string }> | null;
  /** The manufacturer list rows of the cited load by source row, or null when no load is cited. */
  manufacturers: ReadonlyMap<number, { name: string; address: string; country: string }> | null;
  /** The PO items that receive each line (CNY prices of the price correction). */
  itemsByRow: ReadonlyMap<number, readonly { unitPrice: string | null; currency: string | null }[]>;
};
export type InvoiceAuditCheckResult = { problem: InvoiceAuditProblem | null; changedFields: Partial<Record<InvoiceAuditField, number>> };

const unjustified = (row: number, field: string, detail: string): InvoiceAuditProblem => ({ status: 400,
  code: "INVOICE_AUDIT_CHANGE_UNJUSTIFIED", detail: `Linha ${row} da invoice, ${field}: ${detail}` });

/**
 * The POs a saved PO cell may cite: those of the original cell (also the numbers of a cell the reader could not split) and
 * the PO each change took the place of. Null when a change starts from a PO the original cell does not cite.
 */
export function invoiceAuditAllowedPos(originalCell: string, changes: readonly { from: string; to: string }[]): Set<string> | null {
  const original = new Set([...parseInvoicePoCell(originalCell).map(part => normalizePo(part.poNumber)),
    ...invoicePoCellNumbers(originalCell).map(normalizePo)]);
  const allowed = new Set(original);
  for (const change of changes) {
    if (!original.has(normalizePo(change.from))) return null;
    allowed.add(normalizePo(change.to));
  }
  return allowed;
}

/**
 * The quantity each PO cites in the original cell, with the PO changes applied, in the units of `units` (the scale of the
 * caller), or null when the cell cites no quantity.
 */
export function invoiceAuditCitedByPo(originalCell: string, changes: readonly { from: string; to: string }[],
  units: (quantity: string) => bigint): Map<string, bigint> | null {
  const parts = parseInvoicePoCell(originalCell);
  if (!parts.length || parts.some(part => part.quantity === null)) return null;
  const target = new Map(changes.map(change => [normalizePo(change.from), normalizePo(change.to)]));
  const cited = new Map<string, bigint>();
  for (const part of parts) {
    const po = target.get(normalizePo(part.poNumber)) ?? normalizePo(part.poNumber);
    cited.set(po, (cited.get(po) ?? 0n) + units(part.quantity!));
  }
  return cited;
}

/** Checks every value the audit changed against its decision and its source. */
export function checkInvoiceAudit(input: InvoiceAuditCheckInput): InvoiceAuditCheckResult {
  const { audit, lines } = input;
  const changedFields: Partial<Record<InvoiceAuditField, number>> = {};
  const result = (problem: InvoiceAuditProblem | null) => ({ problem, changedFields });
  const originals = new Map(audit.originalLines.map(line => [line.sourceRow, line]));
  if (originals.size !== audit.originalLines.length || originals.size !== lines.length || lines.some(line => {
    const original = originals.get(line.sourceRow);
    return !original || original.productCode.trim().toLocaleUpperCase("en-US") !== line.productCode.trim().toLocaleUpperCase("en-US")
      || (line.unit !== undefined && original.unit.trim() !== text(line.unit).trim())
      || (line.lineNumber !== undefined && original.lineNumber.trim() !== text(line.lineNumber).trim());
  })) {
    return result({ status: 400, code: "INVALID_INVOICE_AUDIT",
      detail: "As linhas originais da auditoria não correspondem às linhas da invoice." });
  }
  const byRow = <T extends { sourceRow: number | null }>(entries: readonly T[]) =>
    new Map(entries.filter(entry => entry.sourceRow !== null).map(entry => [entry.sourceRow!, entry]));
  const missing = byRow(audit.decisions.catalogMissing);
  const manufacturers = byRow(audit.decisions.manufacturers);
  const prices = byRow(audit.decisions.prices);
  const packing = byRow(audit.decisions.packing);
  const references = audit.references;
  if ((references.productDatabaseLoadId === null) !== (input.products === null)
    || (references.manufacturerListLoadId === null) !== (input.manufacturers === null)) {
    return result({ status: 400, code: "INVALID_INVOICE_AUDIT", detail: "As cargas de referência da auditoria não foram encontradas." });
  }
  for (const decision of audit.decisions.catalogMissing) {
    if (decision.action === "KEEP" && decision.reason.length < minimumReason) {
      return result(unjustified(decision.sourceRow, "NCM", "explique por que a NCM fora da DATABASE foi mantida."));
    }
  }
  for (const decision of audit.decisions.manufacturerMissing) {
    if (decision.reason.length < minimumReason) {
      return result(unjustified(decision.sourceRow, "fabricante", "explique o fabricante fora da lista."));
    }
  }
  for (const decision of audit.decisions.poCells) {
    if (decision.action === "KEEP" && decision.reason.length < minimumReason) {
      return result(unjustified(decision.sourceRow, "PO", "explique a linha mantida sem destino."));
    }
  }

  for (const line of lines) {
    const row = line.sourceRow;
    const original = originals.get(row)!;
    const saved = Object.fromEntries(invoiceAuditFields.map(field => [field, line[field] === undefined ? original[field] : text(line[field])])) as AuditValues;
    for (const field of invoiceAuditFields) {
      if (saved[field] !== original[field]) changedFields[field] = (changedFields[field] ?? 0) + 1;
    }
    const changed = (field: InvoiceAuditField) => saved[field] !== original[field];

    // DATABASE: it rules without question (user decision, 2026-11-10); a product out of it keeps the invoice values.
    const product = input.products?.get(line.productCode.trim().toLocaleUpperCase("en-US"));
    if (product) {
      if (saved.ncm.replace(/\D/gu, "") !== product.ncm) return result(unjustified(row, "NCM", "a NCM precisa ser a da DATABASE carregada."));
      if (changed("ncm") && saved.ncm !== product.ncm) return result(unjustified(row, "NCM", "a NCM precisa ser a da DATABASE carregada."));
      const description = product.description.trim();
      if (description && saved.description.trim() !== description) {
        return result(unjustified(row, "descrição", "a descrição precisa ser a da DATABASE carregada."));
      }
      if (!description && changed("description")) return result(unjustified(row, "descrição", "a descrição não pode mudar."));
    } else {
      if (changed("ncm")) return result(unjustified(row, "NCM", "o produto não está na DATABASE carregada."));
      if (changed("description")) return result(unjustified(row, "descrição", "o produto não está na DATABASE carregada."));
      if (input.products && !missing.has(row)) {
        return result(unjustified(row, "NCM", "decida a NCM do produto fora da DATABASE (manter com motivo ou sinalizar)."));
      }
    }

    // Manufacturer list: the name and address of the cited row; the list country only when the analyst took it.
    const manufacturerDecision = manufacturers.get(row);
    const entry = manufacturerDecision?.referenceRow ? input.manufacturers?.get(manufacturerDecision.referenceRow) : undefined;
    if (manufacturerDecision?.referenceRow && !entry) {
      return result(unjustified(row, "fabricante", "a linha citada não está na lista de fabricantes carregada."));
    }
    if (changed("manufacturer") && saved.manufacturer !== entry?.name) {
      return result(unjustified(row, "fabricante", "o nome precisa ser o da lista de fabricantes."));
    }
    if (changed("manufacturerAddress") && saved.manufacturerAddress !== entry?.address) {
      return result(unjustified(row, "endereço do fabricante", "o endereço precisa ser o da lista de fabricantes."));
    }
    if (changed("manufacturerCountry") && saved.manufacturerCountry !== original.manufacturerCountry.trim().toLocaleUpperCase("pt-BR")
      && !(manufacturerDecision?.country === "LIST" && entry
        && saved.manufacturerCountry === entry.country.trim().toLocaleUpperCase("pt-BR"))) {
      return result(unjustified(row, "país do fabricante", "o país precisa ser o da invoice ou o da lista, por escolha do analista."));
    }
    if (manufacturerDecision?.country && manufacturerDecision.reason.length < minimumReason) {
      return result(unjustified(row, "país do fabricante", "explique a escolha do país."));
    }

    // Price: corrected only to the one CNY price of the PO items that receive the line.
    if (changed("unitPrice")) {
      const poPrices = invoiceAuditPoPrices(input.itemsByRow.get(row) ?? []);
      if (prices.get(row)?.choice !== "CORRECT" || poPrices.length !== 1
        || invoiceAuditDecimal(saved.unitPrice) !== invoiceAuditDecimal(poPrices[0])) {
        return result({ status: 400, code: "INVOICE_AUDIT_PRICE_MISMATCH",
          detail: `Linha ${row} da invoice: o preço corrigido precisa ser o único preço CNY das POs que recebem a linha.` });
      }
    }
    // Weights: from the PKL, by the analyst's choice with a reason.
    if (changed("netWeightKg") || changed("grossWeightKg")) {
      const choice = packing.get(row);
      if (choice?.source !== "PACKING" || choice.reason.length < minimumReason) {
        return result(unjustified(row, "peso", "o peso só muda pela escolha da PKL, com motivo."));
      }
    }
    // Quantity: what the analyst destined, with the line confirmation and its reason.
    if (changed("quantity")) {
      const decision = input.lineDecisions.get(row);
      if (!decision?.confirmQuantityMismatch || decision.quantityMismatchReason.trim().length < minimumReason) {
        return result(unjustified(row, "quantidade", "confirme e explique a quantidade destinada."));
      }
    }
    // PO cell: only the POs of the original cell, or those that took the place of one of them.
    const changes = audit.decisions.poChanges.filter(change => change.sourceRow === row);
    const allowed = invoiceAuditAllowedPos(original.poCell, changes);
    const savedPos = [...parseInvoicePoCell(saved.poCell).map(part => normalizePo(part.poNumber)),
      ...invoicePoCellNumbers(saved.poCell).map(normalizePo)];
    if (!allowed || savedPos.some(po => !allowed.has(po))) {
      return result({ status: 400, code: "INVOICE_AUDIT_PO_NOT_IN_CELL",
        detail: `Linha ${row} da invoice: a PO gravada precisa estar na célula original ou ser a troca aceita de uma delas.` });
    }
  }
  const expectedOrigin = invoiceOriginCountries(audit.originalHeader.countryOfOrigin,
    lines.map(line => text(line.manufacturerCountry ?? originals.get(line.sourceRow)!.manufacturerCountry))).corrected
    ?? audit.originalHeader.countryOfOrigin;
  if (input.countryOfOrigin !== expectedOrigin) {
    return result({ status: 400, code: "INVOICE_AUDIT_CHANGE_UNJUSTIFIED",
      detail: "País de origem do cabeçalho: ele só recebe os países das linhas que ainda não cita." });
  }
  return result(null);
}
