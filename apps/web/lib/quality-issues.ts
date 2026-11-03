import type { Messages } from "./i18n/pt-BR";

export type QualityIssueText = { title: string; meaning: string; impact: string; fix: string };
export type QualityEvidenceField = { key: string; label: string; value: string };

/** Issue codes written by the workbook loaders in deploy/hostinger/import-*.py. */
export const qualityIssueCodes = ["MISSING_PO", "PRICE_WITHOUT_CURRENCY", "SC_MULTIPLE_SUPPLIERS", "PO_WITHOUT_SUPPLIER",
  "INVALID_DATE", "PO_IP_SUPPLIER_DIVERGENCE", "EXCEL_CELL_ERROR", "INVALID_NUMERIC", "INVALID_CURRENCY",
  "INVALID_STATUS", "INVALID_COST"] as const;

/** Mirror of the rule codes in apps/api/src/quality-rules.ts, in the same order. */
export const qualityRuleCodes = ["ITEM_WITHOUT_NCM", "ITEM_NCM_NOT_REGISTERED", "ITEM_PRODUCT_NOT_REGISTERED",
  "ITEM_PRICE_WITHOUT_CURRENCY", "ITEM_WITHOUT_PRICE", "PO_WITHOUT_SUPPLIER", "ITEM_PO_APPROVED_BEFORE_SC",
  "IP_CLEARED_BEFORE_ARRIVAL", "IP_WITHOUT_PO", "ITEM_SHIPPED_WITHOUT_IP", "IP_PO_SUPPLIER_MISMATCH",
  "SC_MULTIPLE_SUPPLIERS"] as const;
export const qualityRuleGroups = ["REGISTRATION", "DATES", "LINKS"] as const;
const ruleGroup: Record<string, string> = {
  ITEM_WITHOUT_NCM: "REGISTRATION", ITEM_NCM_NOT_REGISTERED: "REGISTRATION", ITEM_PRODUCT_NOT_REGISTERED: "REGISTRATION",
  ITEM_PRICE_WITHOUT_CURRENCY: "REGISTRATION", ITEM_WITHOUT_PRICE: "REGISTRATION", PO_WITHOUT_SUPPLIER: "REGISTRATION",
  ITEM_PO_APPROVED_BEFORE_SC: "DATES", IP_CLEARED_BEFORE_ARRIVAL: "DATES", IP_WITHOUT_PO: "LINKS",
  ITEM_SHIPPED_WITHOUT_IP: "LINKS", IP_PO_SUPPLIER_MISMATCH: "LINKS", SC_MULTIPLE_SUPPLIERS: "LINKS",
};
export type QualityRuleCount = { rule: string; group: string; open: number; waived: number };

// Identification first, then what was found.
const evidenceOrder = ["purchaseOrder", "line", "draftPo", "ipNumber", "scNumber", "productCode", "description", "importer",
  "supplier", "poSupplier", "ipSupplier", "suppliers", "poSuppliers", "ncm", "unitPrice", "currency", "amount",
  "poApprovalDate", "scApprovalDate", "clearanceDate", "arrivalDate", "sourceStatus", "linkedPurchaseOrders", "column",
  "value"];

export function qualityIssueText(m: Messages, code: string): QualityIssueText & { known: boolean } {
  const text = (m.quality.issueTypes as Record<string, QualityIssueText | undefined>)[code];
  return text ? { ...text, known: true }
    : { title: m.quality.unknownType, meaning: m.quality.unknownMeaning(code), impact: "", fix: "", known: false };
}

export function qualityRuleText(m: Messages, code: string): QualityIssueText & { known: boolean } {
  const text = (m.quality.ruleTypes as Record<string, QualityIssueText | undefined>)[code];
  return text ? { ...text, known: true }
    : { title: m.quality.unknownType, meaning: m.quality.unknownMeaning(code), impact: "", fix: "", known: false };
}

export function qualityGroupLabel(m: Messages, group: string): string {
  return (m.quality.groups as Record<string, string | undefined>)[group] ?? group;
}

/** Every rule of each group in catalog order, with the API counts or zero; unknown rules go at the end of their group. */
export function qualityRuleSummary(counts: readonly QualityRuleCount[]) {
  const byRule = new Map(counts.map(count => [count.rule, count]));
  const known = new Set<string>(qualityRuleCodes);
  return qualityRuleGroups.map(group => ({ group, rules: [
    ...qualityRuleCodes.filter(rule => ruleGroup[rule] === group),
    ...counts.filter(count => !known.has(count.rule) && count.group === group).map(count => count.rule),
  ].map(rule => ({ rule, open: byRule.get(rule)?.open ?? 0, waived: byRule.get(rule)?.waived ?? 0 })) }));
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

export function qualityEvidenceFields(m: Messages, evidence: Record<string, unknown>,
  options: { hideIds?: boolean } = {}): QualityEvidenceField[] {
  const labels = m.quality.evidenceLabels as Record<string, string | undefined>;
  const rank = (key: string) => {
    const index = evidenceOrder.indexOf(key);
    return index < 0 ? evidenceOrder.length : index;
  };
  return Object.keys(evidence).filter(key => !options.hideIds || !key.endsWith("Id"))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(key => ({ key, label: labels[key] ?? key, value: display(evidence[key]) }));
}

/** Body of POST /api/v1/data-issues/:id/resolve built from the review form. */
export function qualityResolutionPayload(form: { reference: string; reason: string;
  proposedPurchaseOrder?: string; proposedIpNumber?: string }) {
  const optional = (value?: string) => value?.trim() || null;
  return { evidence: { reference: form.reference.trim() }, reason: form.reason.trim(),
    proposedPurchaseOrder: optional(form.proposedPurchaseOrder), proposedIpNumber: optional(form.proposedIpNumber) };
}

/** Body of POST /api/v1/quality/current/waivers. */
export function qualityWaiverPayload(rule: string, entityId: string, reason: string) {
  return { rule, entityId, reason: reason.trim() };
}
