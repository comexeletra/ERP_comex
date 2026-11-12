/**
 * Port codes of the operational lists suggested from the port text of an invoice (phase B1 of
 * docs/PLANO_INVOICE_IP_AUDITORIA_DISTRIBUICAO.md, user decisions 2026-11-12). The IPs keep the codes the Follow Up uses
 * (NGB, PEC), which the dashboards read; the invoice brings the city ("NINGBO,CHINA"). Shanghai suggests SGH, the code most
 * used in HML (24 IPs; SH 7, SHG 5, SHA 4). A suggestion is only made when exactly one city is named and its code is in the
 * list; otherwise the analyst chooses. The invoice text stays in the document.
 */
export type InvoicePortKind = "loading" | "discharge";

const portCities: Record<InvoicePortKind, ReadonlyArray<readonly [RegExp, string]>> = {
  loading: [[/\bNING\s*BO\b/u, "NGB"], [/\bSHANG\s*HAI\b/u, "SGH"], [/\bSHEKOU\b/u, "SHEKOU (CHINA)"],
    [/\bHONG\s*KONG\b/u, "HKG"], [/\bHANG\s*ZHOU\b/u, "HGH"]],
  discharge: [[/\bPECEM\b/u, "PEC"], [/\bFORTALEZA\b/u, "FOR"], [/\bPARANAGUA\b/u, "PNG"], [/\bSANTOS\b/u, "SSZ"],
    [/\bVIRACOPOS\b/u, "VCP"]],
};

const plain = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleUpperCase("en-US").trim();

/**
 * The port a field starts with: the value the IP keeps when it is in the list, else the suggestion from the invoice text.
 * An IP saved before phase B1 keeps the invoice text ("NINGBO,CHINA"), which the API refuses (user report, 2026-11-12).
 */
export function invoiceProcessPort(ipValue: string | null | undefined, text: string, kind: InvoicePortKind,
  listed: readonly string[]): string {
  return ipValue && listed.includes(ipValue) ? ipValue : invoicePortSuggestion(text, kind, listed);
}

/**
 * The listed port code of the city the invoice text names; without a known city, the listed value equal to the text (an
 * invoice that already brings "NGB"); "" when it names more than one city or nothing listed. The code wins over a listed
 * spelling of the city ("Pecém" suggests PEC), as the Follow Up writes it.
 */
export function invoicePortSuggestion(text: string, kind: InvoicePortKind, listed: readonly string[]): string {
  const invoice = plain(text);
  if (!invoice) return "";
  const codes = [...new Set(portCities[kind].filter(([city]) => city.test(invoice)).map(([, code]) => code))];
  if (codes.length > 1) return "";
  if (codes.length === 1) return listed.find(value => value === codes[0]) ?? "";
  return listed.find(value => plain(value) === invoice) ?? "";
}
