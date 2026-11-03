"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { formatUsDateTime } from "../lib/date-format";
import { canResolveQuality } from "../lib/quality-permissions";
import { qualityEvidenceFields, qualityGroupLabel, qualityRuleCodes, qualityRuleSummary, qualityRuleText, qualityStatusLabel,
  qualityWaiverPayload, type QualityRuleCount } from "../lib/quality-issues";
import ConfirmDialog from "./ConfirmDialog";
import { getMessages, useI18n } from "./I18nProvider";
import QualityPager from "./QualityPager";
import { SearchableSelect } from "./SearchableSelect";

type Waiver = { id: string; reason: string; createdBy: string; createdAt: string };
type RuleItem = { rule: string; group: string; entityType: string; entityId: string; importer: string | null;
  labels: Record<string, unknown>; values: Record<string, unknown>; links: { purchaseOrderId?: string; processId?: string };
  waiver?: Waiver | null };
type RulePage = { page: number; pageSize: number; totalCount: number; countsByRule: QualityRuleCount[]; items: RuleItem[] };

/** Rules checked now over POs, items, IPs and SCs (first tab of /quality). */
export default function QualityCurrentRules() {
  const { m } = useI18n();
  const t = m.quality;
  const [data, setData] = useState<RulePage>();
  const [roles, setRoles] = useState<string[]>();
  const [rule, setRule] = useState("");
  const [search, setSearch] = useState("");
  const [includeWaived, setIncludeWaived] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [waiving, setWaiving] = useState<{ item: RuleItem; key: string }>();
  const [revoking, setRevoking] = useState<{ waiverId: string }>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(undefined);
    const query = new URLSearchParams({ pageSize: "50" });
    query.set("page", String(pageNumber));
    if (rule) query.set("rule", rule);
    if (search.trim()) query.set("search", search.trim());
    if (includeWaived) query.set("includeWaived", "true");
    return Promise.all([apiFetch("/auth/me"), apiFetch("/api/v1/quality/current?" + query.toString())])
      .then(async ([identityResponse, response]) => {
        if (!identityResponse.ok) throw new Error(getMessages().common.sessionExpired);
        setRoles((await identityResponse.json() as { roles: string[] }).roles);
        if (!response.ok) {
          throw new Error(response.status === 403 ? getMessages().quality.noAccess : getMessages().quality.currentLoadFailed);
        }
        setData(await response.json() as RulePage);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : getMessages().common.unexpectedError));
  };
  useEffect(() => { void load(); }, [rule, includeWaived, pageNumber]);
  const changeRule = (value: string) => { setRule(value); setPageNumber(1); };
  function applyFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pageNumber === 1) void load(); else setPageNumber(1);
  }
  function closeDialogs() { setWaiving(undefined); setRevoking(undefined); setReason(""); }

  async function confirmWaiver() {
    if (!waiving) return;
    setBusy(true); setNotice(undefined);
    try {
      const response = await apiFetch("/api/v1/quality/current/waivers", {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": waiving.key },
        body: JSON.stringify(qualityWaiverPayload(waiving.item.rule, waiving.item.entityId, reason)),
      });
      if (!response.ok) { setError(getMessages().quality.waiveFailed); return; }
      closeDialogs(); setNotice(getMessages().quality.waivedNotice); await load();
    } catch {
      setError(getMessages().quality.waiveFailed);
    } finally { setBusy(false); }
  }

  async function confirmRevoke() {
    if (!revoking) return;
    setBusy(true); setNotice(undefined);
    try {
      const response = await apiFetch(`/api/v1/quality/current/waivers/${revoking.waiverId}/revoke`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!response.ok) { setError(getMessages().quality.revokeFailed); return; }
      closeDialogs(); setNotice(getMessages().quality.revokedNotice); await load();
    } catch {
      setError(getMessages().quality.revokeFailed);
    } finally { setBusy(false); }
  }

  const reviewer = canResolveQuality(roles ?? []);
  const summary = qualityRuleSummary(data?.countsByRule ?? []);
  const totals = summary.flatMap(group => group.rules).reduce((sum, entry) => ({ open: sum.open + entry.open,
    waived: sum.waived + entry.waived }), { open: 0, waived: 0 });
  return <>
    <p className="muted">{t.currentIntro}</p>
    {error && <p className="notice error">{error}</p>}
    {notice && <p className="notice success">{notice}</p>}
    {roles && !reviewer && <p className="notice">{t.readOnly}</p>}
    <section className="metric-grid" aria-label={t.summary}>
      <Metric label={t.openFindings} value={data ? totals.open : "…"} />
      <Metric label={t.waivedFindings} value={data ? totals.waived : "…"} />
      <Metric label={t.inFilter} value={data?.totalCount ?? "…"} />
    </section>
    {data && summary.map(group => <section className="card quality-type-summary" key={group.group} aria-label={qualityGroupLabel(m, group.group)}>
      <h2>{qualityGroupLabel(m, group.group)}</h2>
      <div>{group.rules.map(entry => <button type="button" className="quality-type-chip" key={entry.rule} aria-pressed={rule === entry.rule}
        onClick={() => changeRule(rule === entry.rule ? "" : entry.rule)}>
        {t.typeCount(qualityRuleText(m, entry.rule).title, entry.open)}</button>)}</div>
    </section>)}
    <section className="card"><form className="quality-filter" onSubmit={applyFilter}>
      <label>{t.rule}<SearchableSelect ariaLabel={t.rule} placeholder={t.allRules} value={rule} onChange={changeRule}
        options={[{ value: "", label: t.allRules }, ...qualityRuleCodes.map(code => ({ value: code, label: qualityRuleText(m, code).title }))]} /></label>
      <label>{t.search}<input value={search} maxLength={80} onChange={event => setSearch(event.target.value)} placeholder={t.searchPlaceholder} /></label>
      <label className="quality-waived-toggle"><input type="checkbox" checked={includeWaived}
        onChange={event => { setIncludeWaived(event.target.checked); setPageNumber(1); }} />{t.showWaived}</label>
      <button className="button" type="submit">{t.filter}</button>
    </form></section>
    {!data && !error && <p role="status">{t.loading}</p>}
    {data?.items.length === 0 && <section className="card"><p>{t.noFindings}</p></section>}
    {data?.items.map(item => {
      const info = qualityRuleText(m, item.rule);
      const fields = qualityEvidenceFields(m, { ...item.labels, ...item.values }, { hideIds: true });
      const identity = qualityEvidenceFields(m, item.labels, { hideIds: true }).filter(field => field.key !== "description");
      return <details className="card quality-item" key={`${item.rule}:${item.entityId}`}>
        <summary className="quality-summary"><span><small>{qualityGroupLabel(m, item.group)}</small>
          <strong>{info.title}</strong><small>{identity.map(field => `${field.label}: ${field.value}`).join(" · ")}</small></span>
          <span className={item.waiver ? "badge badge-success" : "badge badge-warning"}>
            {item.waiver ? t.waivedBadge : qualityStatusLabel(m, "OPEN")}</span></summary>
        <div className="quality-item-content">
          <dl className="quality-explain">
            <div><dt>{t.meaning}</dt><dd>{info.meaning}</dd></div>
            {info.impact && <div><dt>{t.impact}</dt><dd>{info.impact}</dd></div>}
            {info.fix && <div><dt>{t.fix}</dt><dd>{info.fix}</dd></div>}
          </dl>
          <section><h3>{t.foundData}</h3><dl className="source-field-grid">{fields.map(field =>
            <div className="source-field" key={field.key}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></section>
          {(item.links.purchaseOrderId || item.links.processId) && <p className="quality-links">
            {item.links.purchaseOrderId && <Link className="button secondary" href={`/purchase-orders/${item.links.purchaseOrderId}`}>{t.openPo}</Link>}
            {item.links.processId && <Link className="button secondary" href={`/processes/${item.links.processId}`}>{t.openIp}</Link>}
          </p>}
          {item.waiver && <p className="muted">{t.waiverBy(item.waiver.createdBy, formatUsDateTime(item.waiver.createdAt))} {item.waiver.reason}</p>}
          {reviewer && (item.waiver
            ? <button className="button secondary" type="button" onClick={() => { setReason(""); setRevoking({ waiverId: item.waiver!.id }); }}>{t.revoke}</button>
            : <button className="button" type="button" onClick={() => { setReason(""); setWaiving({ item, key: crypto.randomUUID() }); }}>{t.waive}</button>)}
        </div>
      </details>;
    })}
    {data && <QualityPager page={data.page} pageSize={data.pageSize} total={data.totalCount} onPage={setPageNumber} />}
    <ConfirmDialog open={!!waiving} title={t.waive} confirmLabel={t.waiveConfirm} cancelLabel={t.cancel} busy={busy}
      confirmDisabled={reason.trim().length < 8} onConfirm={() => void confirmWaiver()} onCancel={closeDialogs}>
      {waiving && <p><strong>{qualityRuleText(m, waiving.item.rule).title}</strong></p>}
      <p>{t.waiveHelp}</p>
      <label className="review-form">{t.waiveReason}<textarea value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} /></label>
    </ConfirmDialog>
    <ConfirmDialog open={!!revoking} title={t.revokeTitle} confirmLabel={t.revoke} cancelLabel={t.cancel} busy={busy}
      confirmDisabled={reason.trim().length < 8} onConfirm={() => void confirmRevoke()} onCancel={closeDialogs}>
      <p>{t.revokeHelp}</p>
      <label className="review-form">{t.revokeReason}<textarea value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} /></label>
    </ConfirmDialog>
  </>;
}

function Metric({ label, value }: { label: string; value: number | string }) { return <section className="metric"><span>{label}</span><strong>{value}</strong></section>; }
