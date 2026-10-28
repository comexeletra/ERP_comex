"use client";

import { FormEvent, Fragment, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { ICMS_RATES_CHANGED, ICMS_STATES, type IcmsState } from "../lib/import-estimate";
import { formatNcmCode, formatRate, normalizeRateInput } from "../lib/ncm-rates";
import { getMessages, useI18n } from "./I18nProvider";

type RateRow = { id: string; uf: IcmsState; rate: string; fcpRate: string; legalBasis: string; validFrom: string;
  validTo: string | null; reviewed: boolean; version: string };
type BenefitRow = { id: string; uf: IcmsState; ncm: string | null; kind: "BASE_REDUCTION" | "DEFERRAL"; percent: string;
  legalBasis: string; validFrom: string; validTo: string | null; version: string };
type StateRow = { uf: IcmsState; includeSiscomexFee: boolean; includeAfrmm: boolean; includeOtherExpenses: boolean;
  reviewed: boolean; version: string; rates: RateRow[]; benefits: BenefitRow[] };
type Importer = { importer: string; uf: IcmsState | null; version: string | null };
type Editing =
  | { kind: "rate"; uf: IcmsState; target: RateRow | null }
  | { kind: "state"; target: StateRow }
  | { kind: "benefit"; uf: IcmsState; target: BenefitRow | null }
  | { kind: "importer"; target: Importer };
type Draft = { rate: string; fcpRate: string; percent: string; ncm: string; benefitKind: BenefitRow["kind"];
  legalBasis: string; validFrom: string; validTo: string; reviewed: boolean; includeSiscomexFee: boolean;
  includeAfrmm: boolean; includeOtherExpenses: boolean; uf: IcmsState; reason: string };

const emptyDraft: Draft = { rate: "", fcpRate: "0", percent: "", ncm: "", benefitKind: "BASE_REDUCTION", legalBasis: "",
  validFrom: "", validTo: "", reviewed: false, includeSiscomexFee: true, includeAfrmm: true, includeOtherExpenses: true,
  uf: "CE", reason: "" };

/** Where a form opens: on the line of the edited row, or below the state buttons for a new record. */
function placeOf(editing: Editing): string {
  if (editing.kind === "importer") return `importer:${editing.target.importer}`;
  if (editing.kind === "rate" && editing.target) return `rate:${editing.target.id}`;
  if (editing.kind === "benefit" && editing.target) return `benefit:${editing.target.id}`;
  return `uf:${editing.kind === "state" ? editing.target.uf : editing.uf}`;
}

function formatDate(value: string | null): string | null {
  const date = value ? /^(\d{4})-(\d{2})-(\d{2})/u.exec(value) : null;
  return date ? `${date[3]}/${date[2]}/${date[1]}` : null;
}

/** ICMS of the importer states; Master and Administrador keep it, everyone with catalog access reads it. */
export function IcmsRatesPanel({ canManage }: { canManage: boolean }) {
  const { m, locale } = useI18n();
  const t = m.icmsRates;
  const [data, setData] = useState<{ states: StateRow[]; importers: Importer[] } | null>(null);
  const [reload, setReload] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState<{ place: string; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/v1/icms-rates", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(getMessages().icmsRates.loadFailed(response.status));
        return response.json() as Promise<{ states: StateRow[]; importers: Importer[] }>;
      })
      .then(body => { if (!controller.signal.aborted) { setData(body); setLoadError(""); } },
        cause => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : getMessages().icmsRates.loadFailed(0)); });
    return () => controller.abort();
  }, [reload]);

  function start(next: Editing) {
    setEditing(next);
    setFormError("");
    setNotice(null);
    const base = { ...emptyDraft };
    if (next.kind === "rate" && next.target) Object.assign(base, { rate: next.target.rate, fcpRate: next.target.fcpRate,
      legalBasis: next.target.legalBasis, validFrom: next.target.validFrom, validTo: next.target.validTo ?? "", reviewed: next.target.reviewed });
    if (next.kind === "state") Object.assign(base, { includeSiscomexFee: next.target.includeSiscomexFee,
      includeAfrmm: next.target.includeAfrmm, includeOtherExpenses: next.target.includeOtherExpenses, reviewed: next.target.reviewed });
    if (next.kind === "benefit" && next.target) Object.assign(base, { percent: next.target.percent, ncm: next.target.ncm ?? "",
      benefitKind: next.target.kind, legalBasis: next.target.legalBasis, validFrom: next.target.validFrom, validTo: next.target.validTo ?? "" });
    if (next.kind === "importer") base.uf = next.target.uf ?? "CE";
    setDraft(base);
  }
  function set<K extends keyof Draft>(field: K, value: Draft[K]) { setDraft(current => ({ ...current, [field]: value })); }

  function request(next: Editing): { url: string; method: "POST" | "PATCH"; version?: string; body: object } | null {
    const reason = draft.reason.trim();
    const period = { validFrom: draft.validFrom, validTo: draft.validTo || null };
    if (reason.length < 3) return null;
    if (next.kind === "importer") {
      return { url: `/api/v1/icms-rates/importers/${encodeURIComponent(next.target.importer)}`, method: "PATCH",
        // An importer without a state yet is linked with version "0".
        version: next.target.version ?? "0", body: { uf: draft.uf, reason } };
    }
    if (next.kind === "state") {
      return { url: `/api/v1/icms-rates/states/${next.target.uf}`, method: "PATCH", version: next.target.version,
        body: { includeSiscomexFee: draft.includeSiscomexFee, includeAfrmm: draft.includeAfrmm,
          includeOtherExpenses: draft.includeOtherExpenses, reviewed: draft.reviewed, reason } };
    }
    if (!draft.validFrom || draft.legalBasis.trim().length < 3 || (draft.validTo && draft.validTo < draft.validFrom)) return null;
    if (next.kind === "rate") {
      const rate = normalizeRateInput(draft.rate), fcpRate = normalizeRateInput(draft.fcpRate || "0");
      if (rate === null || fcpRate === null || Number(rate) + Number(fcpRate) >= 100) return null;
      const body = { rate, fcpRate, legalBasis: draft.legalBasis.trim(), ...period, reviewed: draft.reviewed, reason };
      return next.target ? { url: `/api/v1/icms-rates/rates/${next.target.id}`, method: "PATCH", version: next.target.version, body }
        : { url: "/api/v1/icms-rates/rates", method: "POST", body: { uf: next.uf, ...body } };
    }
    const percent = normalizeRateInput(draft.percent);
    const ncm = draft.ncm.replace(/\D/gu, "");
    if (percent === null || Number(percent) <= 0 || (ncm && ncm.length !== 8)) return null;
    const body = { percent, legalBasis: draft.legalBasis.trim(), ...period, reason };
    return next.target ? { url: `/api/v1/icms-rates/benefits/${next.target.id}`, method: "PATCH", version: next.target.version, body }
      : { url: "/api/v1/icms-rates/benefits", method: "POST", body: { uf: next.uf, ncm: ncm || null, kind: draft.benefitKind, ...body } };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const text = getMessages().icmsRates;
    const call = request(editing);
    if (!call) { setFormError(text.invalid); return; }
    setSaving(true);
    setFormError("");
    try {
      const response = await apiFetch(call.url, { method: call.method, body: JSON.stringify(call.body),
        headers: { "content-type": "application/json", ...(call.version ? { "x-record-version": call.version } : {}) } });
      const body = await response.json().catch(() => null) as { detail?: string } | null;
      if (!response.ok) throw new Error(body?.detail || text.saveFailed(response.status));
      setEditing(null);
      setNotice({ place: placeOf(editing), text: text.saved });
      setReload(current => current + 1);
      window.dispatchEvent(new Event(ICMS_RATES_CHANGED));
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : text.saveFailed(0));
    } finally { setSaving(false); }
  }

  const period = (from: string | null, to: string | null) => m.ncmRates.periodText(formatDate(from), formatDate(to));
  const form = editing && <form className="ncm-rate-form" onSubmit={event => void save(event)}>
    <h4 className="ncm-rate-form-wide">{t.formTitle[editing.kind]}</h4>
    {editing.kind === "rate" && <>
      <label>{t.rate}<input inputMode="decimal" required value={draft.rate} onChange={event => set("rate", event.target.value)} /></label>
      <label>{t.fcpRate}<input inputMode="decimal" value={draft.fcpRate} onChange={event => set("fcpRate", event.target.value)} /></label>
    </>}
    {editing.kind === "benefit" && <>
      {!editing.target && <label>{t.benefitKind}<select value={draft.benefitKind}
        onChange={event => set("benefitKind", event.target.value as BenefitRow["kind"])}>
        <option value="BASE_REDUCTION">{t.kinds.BASE_REDUCTION}</option><option value="DEFERRAL">{t.kinds.DEFERRAL}</option>
      </select></label>}
      {!editing.target && <label>{t.benefitNcm}<input inputMode="numeric" maxLength={10} value={draft.ncm}
        placeholder={t.allNcms} onChange={event => set("ncm", event.target.value)} /></label>}
      <label>{t.percent}<input inputMode="decimal" required value={draft.percent} onChange={event => set("percent", event.target.value)} /></label>
    </>}
    {(editing.kind === "rate" || editing.kind === "benefit") && <>
      <label>{m.ncmRates.validFrom}<input type="date" required value={draft.validFrom} onChange={event => set("validFrom", event.target.value)} /></label>
      <label>{m.ncmRates.validTo}<input type="date" min={draft.validFrom || undefined} value={draft.validTo}
        onChange={event => set("validTo", event.target.value)} /></label>
      <label className="ncm-rate-form-wide">{m.ncmRates.legalBasis}<input required minLength={3} maxLength={500} value={draft.legalBasis}
        onChange={event => set("legalBasis", event.target.value)} /></label>
    </>}
    {editing.kind === "state" && <>
      <label className="ncm-rate-form-check"><input type="checkbox" checked={draft.includeSiscomexFee}
        onChange={event => set("includeSiscomexFee", event.target.checked)} />{t.includeSiscomexFee}</label>
      <label className="ncm-rate-form-check"><input type="checkbox" checked={draft.includeAfrmm}
        onChange={event => set("includeAfrmm", event.target.checked)} />{t.includeAfrmm}</label>
      <label className="ncm-rate-form-check"><input type="checkbox" checked={draft.includeOtherExpenses}
        onChange={event => set("includeOtherExpenses", event.target.checked)} />{t.includeOtherExpenses}</label>
    </>}
    {(editing.kind === "rate" || editing.kind === "state") && <label className="ncm-rate-form-check"><input type="checkbox"
      checked={draft.reviewed} onChange={event => set("reviewed", event.target.checked)} />{t.markReviewed}</label>}
    {editing.kind === "importer" && <label>{t.state}<select value={draft.uf} onChange={event => set("uf", event.target.value as IcmsState)}>
      {ICMS_STATES.map(state => <option key={state} value={state}>{m.importEstimate.states[state]}</option>)}
    </select></label>}
    <label className="ncm-rate-form-wide">{m.ncmRates.reason}<input required minLength={3} maxLength={1000} value={draft.reason}
      onChange={event => set("reason", event.target.value)} /></label>
    {formError && <p className="notice error ncm-rate-form-wide" role="alert">{formError}</p>}
    <div className="ncm-rate-form-actions">
      <button className="button" disabled={saving}>{saving ? m.ncmRates.saving : t.save}</button>
      <button className="button secondary" type="button" disabled={saving} onClick={() => setEditing(null)}>{m.ncmRates.cancel}</button>
    </div>
  </form>;
  // The open form, or the confirmation of the last save, on the line it belongs to.
  const here = (place: string) => editing && placeOf(editing) === place ? form
    : notice?.place === place ? <p className="notice success ncm-rate-inline" role="status">{notice.text}</p> : null;

  return <section className="card" aria-labelledby="icms-rates-title">
    <h2 id="icms-rates-title">{t.title}</h2>
    <p className="muted">{t.intro}</p>
    {loadError && <p className="notice error" role="alert">{loadError}</p>}
    {!data && !loadError && <p role="status">{t.loading}</p>}
    {data?.states.map(state => <section key={state.uf} className="ncm-rate-section" aria-label={m.importEstimate.states[state.uf]}>
      <div className="ncm-rate-selected-header">
        <h3>{m.importEstimate.states[state.uf]}</h3>
        <span className={state.reviewed ? "badge badge-success" : "badge badge-warning"}>{state.reviewed ? t.reviewed : t.notReviewed}</span>
      </div>
      <p className="muted">{t.baseExpenses([state.includeSiscomexFee && t.siscomexFee, state.includeAfrmm && t.afrmm,
        state.includeOtherExpenses && t.otherExpenses].filter(Boolean).join(", ") || t.none)}</p>
      {state.rates.length > 0 && <div className="table-scroll"><table>
        <thead><tr><th>{t.rate}</th><th>{t.fcpRate}</th><th>{m.ncmRates.period}</th><th>{m.ncmRates.legalBasis}</th>
          <th>{m.ncmRates.situation}</th>{canManage && <th>{m.ncmRates.actions}</th>}</tr></thead>
        <tbody>{state.rates.map(row => {
          const inline = here(`rate:${row.id}`);
          return <Fragment key={row.id}><tr>
            <td>{formatRate(row.rate, locale)}</td><td>{formatRate(row.fcpRate, locale)}</td><td>{period(row.validFrom, row.validTo)}</td>
            <td className="ncm-rate-description">{row.legalBasis}</td>
            <td><span className={row.reviewed ? "badge badge-success badge-sm" : "badge badge-warning badge-sm"}>
              {row.reviewed ? t.reviewed : t.notReviewed}</span></td>
            {canManage && <td><button className="button secondary" type="button" disabled={saving}
              onClick={() => start({ kind: "rate", uf: state.uf, target: row })}>{m.ncmRates.edit}</button></td>}
          </tr>
          {inline && <tr><td className="ncm-rate-edit-cell" colSpan={canManage ? 6 : 5}>{inline}</td></tr>}</Fragment>;
        })}</tbody>
      </table></div>}
      {state.benefits.length > 0 && <ul className="ncm-rate-periods">{state.benefits.map(row => <li key={row.id}>
        <span>{t.benefitLine(t.kinds[row.kind], formatRate(row.percent, locale), row.ncm ? formatNcmCode(row.ncm) : t.allNcms,
          period(row.validFrom, row.validTo), row.legalBasis)}</span>
        {canManage && <button className="button secondary" type="button" disabled={saving}
          onClick={() => start({ kind: "benefit", uf: state.uf, target: row })}>{m.ncmRates.edit}</button>}
        {here(`benefit:${row.id}`)}
      </li>)}</ul>}
      {canManage && <div className="ncm-rate-form-actions">
        <button className="button secondary" type="button" onClick={() => start({ kind: "rate", uf: state.uf, target: null })}>{t.addRate}</button>
        <button className="button secondary" type="button" onClick={() => start({ kind: "state", target: state })}>{t.editExpenses}</button>
        <button className="button secondary" type="button" onClick={() => start({ kind: "benefit", uf: state.uf, target: null })}>{t.addBenefit}</button>
      </div>}
      {here(`uf:${state.uf}`)}
    </section>)}
    {data && <section className="ncm-rate-section" aria-label={t.importersTitle}>
      <h3>{t.importersTitle}</h3>
      <ul className="ncm-rate-periods">{data.importers.map(item => <li key={item.importer}>
        <span>{t.importerLine(item.importer, item.uf ? m.importEstimate.states[item.uf] : t.noState)}</span>
        {canManage && <button className="button secondary" type="button" disabled={saving}
          onClick={() => start({ kind: "importer", target: item })}>{m.ncmRates.edit}</button>}
        {here(`importer:${item.importer}`)}
      </li>)}</ul>
    </section>}
  </section>;
}
