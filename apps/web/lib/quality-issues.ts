import type { Messages } from "./i18n/pt-BR";

export type QualityIssueText = { title: string; meaning: string; impact: string; fix: string };
export type QualityEvidenceField = { key: string; label: string; value: string };

/** Issue codes written by the workbook loaders in deploy/hostinger/import-*.py. */
export const qualityIssueCodes = ["MISSING_PO", "PRICE_WITHOUT_CURRENCY", "SC_MULTIPLE_SUPPLIERS", "PO_WITHOUT_SUPPLIER",
  "INVALID_DATE", "PO_IP_SUPPLIER_DIVERGENCE", "EXCEL_CELL_ERROR", "INVALID_NUMERIC", "INVALID_CURRENCY",
  "INVALID_STATUS", "INVALID_COST"] as const;

// Identification first, then what was found.
const evidenceOrder = ["purchaseOrder", "draftPo", "ipNumber", "scNumber", "productCode", "importer", "poSupplier",
  "ipSupplier", "suppliers", "unitPrice", "currency", "amount", "column", "value"];

export function qualityIssueText(m: Messages, code: string): QualityIssueText & { known: boolean } {
  const text = (m.quality.issueTypes as Record<string, QualityIssueText | undefined>)[code];
  return text ? { ...text, known: true }
    : { title: m.quality.unknownType, meaning: m.quality.unknownMeaning(code), impact: "", fix: "", known: false };
}

export function qualityStatusLabel(m: Messages, status: string): string {
  return (m.quality.statuses as Record<string, string | undefined>)[status] ?? status;
}

export function qualitySeverityLabel(m: Messages, severity: string): string {
  return (m.quality.severities as Record<string, string | undefined>)[severity] ?? severity;
}

export function qualityOutcomeLabel(m: Messages, outcome: string): string {
  return (m.quality.outcomes as Record<string, string | undefined>)[outcome] ?? outcome;
}

function display(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.map(display).join(", ") : "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function qualityEvidenceFields(m: Messages, evidence: Record<string, unknown>): QualityEvidenceField[] {
  const labels = m.quality.evidenceLabels as Record<string, string | undefined>;
  const rank = (key: string) => {
    const index = evidenceOrder.indexOf(key);
    return index < 0 ? evidenceOrder.length : index;
  };
  return Object.keys(evidence).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(key => ({ key, label: labels[key] ?? key, value: display(evidence[key]) }));
}

/** Body of POST /api/v1/data-issues/:id/resolve built from the review form. */
export function qualityResolutionPayload(form: { reference: string; reason: string;
  proposedPurchaseOrder?: string; proposedIpNumber?: string }) {
  const optional = (value?: string) => value?.trim() || null;
  return { evidence: { reference: form.reference.trim() }, reason: form.reason.trim(),
    proposedPurchaseOrder: optional(form.proposedPurchaseOrder), proposedIpNumber: optional(form.proposedIpNumber) };
}
