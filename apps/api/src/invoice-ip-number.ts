/**
 * The IP an invoice saves into (phase B1 of docs/PLANO_INVOICE_IP_AUDITORIA_DISTRIBUICAO.md, user decision 2026-11-12):
 * the IP with the invoice number when it can still be revised (active or draft); else the same IP that the Follow Up load
 * keeps without the IPH prefix (IPH037D/2026 is 037D/2026), which is revised and keeps its number; else the invoice number,
 * which creates the IP or meets the cancelled or closed IP with that number. The stored IPs of the prefix-less number must
 * be those of the invoice importer. Mirror of invoiceSaveIpNumber (apps/web/lib/china-invoice-mapping.ts); the test
 * invoice-ip-number.test.mjs compares the two.
 */
export type StoredInvoiceIp = { ipNumber: string; recordStatus?: string | null };

const ipKey = (value: string) => value.trim().toLocaleUpperCase("en-US");
const revisable = (status: string | null | undefined) => status === "ACTIVE" || status === "DRAFT";

/** The prefix-less number the Follow Up load keeps for an invoice IP, or "" when the invoice IP has no IPH prefix. */
export function invoiceIpWithoutPrefix(invoiceIp: string): string {
  const invoice = ipKey(invoiceIp);
  return invoice.startsWith("IPH") ? invoice.slice(3).trim() : "";
}

export function invoiceSaveIpNumber(invoiceIp: string, stored: readonly StoredInvoiceIp[]): string {
  const invoice = ipKey(invoiceIp);
  if (!invoice) return invoiceIp.trim();
  const exact = stored.find(entry => ipKey(entry.ipNumber) === invoice);
  if (exact && revisable(exact.recordStatus)) return exact.ipNumber.trim();
  const withoutPrefix = invoiceIpWithoutPrefix(invoiceIp);
  const kept = withoutPrefix
    ? stored.find(entry => ipKey(entry.ipNumber) === withoutPrefix && revisable(entry.recordStatus)) : undefined;
  return (kept ?? exact)?.ipNumber.trim() ?? invoiceIp.trim();
}
