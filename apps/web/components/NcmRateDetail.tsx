"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { describeIiSource, describeIpi, formatNcmCode, formatRate, pisCofinsPayload,
  type NcmRateDetail as Detail, type PisCofinsDraft, type PisCofinsException } from "../lib/ncm-rates";
import { getMessages, useI18n } from "./I18nProvider";
import { ImportTaxEstimate } from "./ImportTaxEstimate";

const emptyDraft: PisCofinsDraft = { pisRate: "", cofinsRate: "", legalBasis: "", validFrom: "", validTo: "" };

function formatDate(value: string | null): string | null {
  const date = value ? /^(\d{4})-(\d{2})-(\d{2})/u.exec(value) : null;
  // Siscomex records an open-ended validity as 9999-12-31.
  return date && date[1] !== "9999" ? `${date[3]}/${date[2]}/${date[1]}` : null;
}

/**
 * Rates of one NCM on a date. Collapsible blocks load only when opened, so the
 * registered NCM list does not query every rate at once.
 */
export function NcmRateDetail({ code, date = "", canManage = false, collapsible = false }: {
  code: string; date?: string; canManage?: boolean; collapsible?: boolean;
}) {
  const { m, locale } = useI18n();
  const t = m.ncmRates;
  const [opened, setOpened] = useState(!collapsible);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ key: string; detail: Detail | null; error: string }>({ key: "", detail: null, error: "" });
  const [editing, setEditing] = useState<PisCofinsException | "new" | null>(null);
  const [draft, setDraft] = useState<PisCofinsDraft>(emptyDraft);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const key = `${code}|${date}|${reload}`;

  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    const query = new URLSearchParams(date ? { date } : {});
    apiFetch(`/api/v1/ncm-rates/${code}?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => null) as Detail & { detail?: string } | null;
        if (!response.ok || !body) throw new Error(body?.detail || getMessages().ncmRates.loadFailed(response.status));
        return body;
      })
      .then(detail => { if (!controller.signal.aborted) setState({ key, detail, error: "" }); },
        cause => { if (!controller.signal.aborted) setState({ key, detail: null,
          error: cause instanceof Error ? cause.message : getMessages().ncmRates.loadFailedGeneric }); });
    return () => controller.abort();
  }, [opened, code, date, key]);

  function startEditing(target: PisCofinsException | "new") {
    setEditing(target);
    setFormError("");
    setNotice("");
    setReason("");
    setDraft(target === "new" ? emptyDraft : { pisRate: target.pisRate, cofinsRate: target.cofinsRate,
      legalBasis: target.legalBasis, validFrom: target.validFrom, validTo: target.validTo ?? "" });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = getMessages().ncmRates;
    const payload = pisCofinsPayload(draft, reason.trim());
    if (!payload || reason.trim().length < 3 || !editing) { setFormError(text.invalidException); return; }
    setSaving(true);
    setFormError("");
    try {
      const response = editing === "new"
        ? await apiFetch("/api/v1/ncm-rates/pis-cofins-exceptions", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ code, ...payload }) })
        : await apiFetch(`/api/v1/ncm-rates/pis-cofins-exceptions/${editing.id}`, { method: "PATCH",
          headers: { "content-type": "application/json", "x-record-version": editing.version }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null) as { detail?: string } | null;
      if (!response.ok) throw new Error(body?.detail || text.saveFailed(response.status));
      setEditing(null);
      setNotice(text.saved);
      setReload(current => current + 1);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : text.saveFailed(0));
    } finally { setSaving(false); }
  }

  const detail = state.key === key ? state.detail : null;
  const content = <div className="ncm-rate-detail">
    {state.key !== key && <p role="status">{t.loadingDetail}</p>}
    {state.key === key && state.error && <p className="notice error" role="alert">{state.error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {detail && <>
      <p className="notice">{t.disclaimer}</p>
      <section className="ncm-rate-section" aria-label={t.iiTitle}>
        <h3>{t.iiTitle}</h3>
        {detail.ii.status === "needs_review" && <p className="notice warning">{t.needsReview}</p>}
        <dl className="ncm-rate-values">
          <div><dt>{t.tec}</dt><dd>{formatRate(detail.ii.tec, locale)}{detail.ii.tecMarker ? ` ${detail.ii.tecMarker}` : ""}</dd></div>
          <div><dt>{t.brazilRate}</dt><dd>{formatRate(detail.ii.brazil, locale)}
            {detail.ii.brazilBasis ? ` — ${detail.ii.brazilBasis}` : ""}</dd></div>
          <div><dt>{t.appliedRate}</dt><dd><strong>{formatRate(detail.ii.applied, locale)}</strong>
            {` — ${describeIiSource(detail.ii.appliedSource, m)}`}{detail.ii.appliedAct ? ` (${detail.ii.appliedAct})` : ""}</dd></div>
        </dl>
        <p className="muted">{t.iiPremise}</p>
        {detail.ii.exceptions.length > 0 && <div className="table-scroll"><table>
          <caption>{t.exceptionsTitle}</caption>
          <thead><tr><th>{t.annex}</th><th>{t.ex}</th><th>{t.rate}</th><th>{t.quota}</th><th>{t.period}</th>
            <th>{t.act}</th><th>{t.situation}</th><th>{t.description}</th></tr></thead>
          <tbody>{detail.ii.exceptions.map((item, index) => <tr key={`${item.annex}-${item.ncm}-${item.exNumber}-${index}`}>
            <td>{item.annex}</td><td>{item.exNumber ?? "—"}</td><td>{formatRate(item.rate, locale)}</td>
            <td>{item.quota ?? "—"}</td>
            <td>{t.periodText(formatDate(item.validFrom), formatDate(item.validTo))}</td>
            <td>{item.act ?? "—"}</td>
            <td><span className={item.condition === "applied" ? "badge badge-success"
              : item.condition === "conflict" ? "badge badge-danger" : "badge badge-warning"}>{t.conditions[item.condition]}</span></td>
            <td className="ncm-rate-description">{item.annex === "III" ? t.aeronautical(formatNcmCode(item.ncm)) : item.description ?? "—"}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
      <section className="ncm-rate-section" aria-label={t.ipiTitle}>
        <h3>{t.ipiTitle}</h3>
        <dl className="ncm-rate-values"><div><dt>{t.ipiRate}</dt><dd><strong>{describeIpi(detail.ipi, m, locale)}</strong></dd></div></dl>
        {detail.ipi.exceptions.length > 0 && <div className="table-scroll"><table>
          <caption>{t.ipiExTitle}</caption>
          <thead><tr><th>{t.ex}</th><th>{t.description}</th><th>{t.rate}</th></tr></thead>
          <tbody>{detail.ipi.exceptions.map(item => <tr key={item.exNumber}>
            <td>{item.exNumber}</td><td className="ncm-rate-description">{item.description}</td>
            <td>{describeIpi({ ...item, status: "ok" }, m, locale)}</td></tr>)}</tbody>
        </table></div>}
      </section>
      <section className="ncm-rate-section" aria-label={t.pisCofinsTitle}>
        <h3>{t.pisCofinsTitle}</h3>
        <dl className="ncm-rate-values">
          <div><dt>{t.pis}</dt><dd><strong>{formatRate(detail.pisCofins.pis, locale)}</strong></dd></div>
          <div><dt>{t.cofins}</dt><dd><strong>{formatRate(detail.pisCofins.cofins, locale)}</strong></dd></div>
          <div><dt>{t.legalBasis}</dt><dd>{detail.pisCofins.legalBasis ?? t.missing}</dd></div>
        </dl>
        <p><span className={detail.pisCofins.reviewed ? "badge badge-success" : "badge badge-warning"}>
          {detail.pisCofins.reviewed ? t.reviewed : t.notReviewed}</span></p>
        {detail.pisCofinsExceptions.length > 0 && <ul className="ncm-rate-periods">
          {detail.pisCofinsExceptions.map(item => <li key={item.id}>
            <span>{t.exceptionLine(formatRate(item.pisRate, locale), formatRate(item.cofinsRate, locale),
              t.periodText(formatDate(item.validFrom), formatDate(item.validTo)), item.legalBasis)}</span>
            {canManage && <button className="button secondary" type="button" disabled={saving}
              onClick={() => startEditing(item)}>{t.edit}</button>}
          </li>)}
        </ul>}
        {canManage && editing === null && <button className="button secondary" type="button"
          onClick={() => startEditing("new")}>{t.addException}</button>}
        {canManage && editing !== null && <form className="ncm-rate-form" onSubmit={event => void save(event)}>
          <label>{t.pis}<input inputMode="decimal" required value={draft.pisRate} placeholder={t.ratePlaceholder}
            onChange={event => setDraft(current => ({ ...current, pisRate: event.target.value }))} /></label>
          <label>{t.cofins}<input inputMode="decimal" required value={draft.cofinsRate} placeholder={t.ratePlaceholder}
            onChange={event => setDraft(current => ({ ...current, cofinsRate: event.target.value }))} /></label>
          <label>{t.validFrom}<input type="date" required value={draft.validFrom}
            onChange={event => setDraft(current => ({ ...current, validFrom: event.target.value }))} /></label>
          <label>{t.validTo}<input type="date" min={draft.validFrom || undefined} value={draft.validTo}
            onChange={event => setDraft(current => ({ ...current, validTo: event.target.value }))} /></label>
          <label className="ncm-rate-form-wide">{t.legalBasis}<input required minLength={3} maxLength={500} value={draft.legalBasis}
            placeholder={t.legalBasisPlaceholder} onChange={event => setDraft(current => ({ ...current, legalBasis: event.target.value }))} /></label>
          <label className="ncm-rate-form-wide">{t.reason}<input required minLength={3} maxLength={1000} value={reason}
            onChange={event => setReason(event.target.value)} /></label>
          {formError && <p className="notice error ncm-rate-form-wide" role="alert">{formError}</p>}
          <div className="ncm-rate-form-actions">
            <button className="button" disabled={saving}>{saving ? t.saving : t.save}</button>
            <button className="button secondary" type="button" disabled={saving} onClick={() => setEditing(null)}>{t.cancel}</button>
          </div>
        </form>}
      </section>
      <ImportTaxEstimate code={code} date={date} />
      <ul className="ncm-rate-sources">
        {detail.sources.map(item => <li key={item.source} className="muted">{item.version
          ? <>{t.sourceLine(item.version.sourceReference.slice(0, 160))} <a href={item.version.sourceUrl} target="_blank"
            rel="noreferrer">{t.sourceLink}</a></> : t.sourceMissing(t.sources[item.source])}</li>)}
      </ul>
    </>}
  </div>;

  if (!collapsible) return content;
  return <details className="ncm-rates-toggle" onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary>{t.summary(formatNcmCode(code))}</summary>
    {opened && content}
  </details>;
}
