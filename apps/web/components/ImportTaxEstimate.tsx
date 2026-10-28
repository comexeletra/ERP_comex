"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { createEstimateUrl, customsValueFromForeign, formatMoney, ICMS_STATES, normalizeMoneyInput, stateForImporter,
  type IcmsState, type ImportEstimate } from "../lib/import-estimate";
import { formatRate } from "../lib/ncm-rates";
import { getMessages, useI18n } from "./I18nProvider";

type Importer = { importer: string; uf: string };

/** Estimate of the import taxes of one NCM for a state; nothing is stored. */
export function ImportTaxEstimate({ code, date = "" }: { code: string; date?: string }) {
  const { m, locale } = useI18n();
  const t = m.importEstimate;
  const [importers, setImporters] = useState<Importer[]>([]);
  const [importer, setImporter] = useState("");
  const [uf, setUf] = useState<IcmsState>("CE");
  const [foreign, setForeign] = useState(false);
  const [values, setValues] = useState({ customsValue: "", fob: "", freight: "", insurance: "", exchangeRate: "",
    siscomexFee: "", afrmm: "", otherExpenses: "" });
  const [result, setResult] = useState<ImportEstimate | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/v1/icms-rates", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<{ importers: Importer[] }> : { importers: [] })
      .then(body => { if (!controller.signal.aborted) setImporters(body.importers); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  function chooseImporter(value: string) {
    setImporter(value);
    const suggested = stateForImporter(value, importers);
    if (suggested) setUf(suggested);
  }
  function set(field: keyof typeof values, value: string) { setValues(current => ({ ...current, [field]: value })); }

  async function estimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = getMessages().importEstimate;
    const customsValue = foreign
      ? customsValueFromForeign(values.fob, values.freight, values.insurance, values.exchangeRate)
      : normalizeMoneyInput(values.customsValue);
    const expenses = [values.siscomexFee, values.afrmm, values.otherExpenses].map(value => value.trim() ? normalizeMoneyInput(value) : "0");
    if (customsValue === null || expenses.some(value => value === null)) { setError(text.invalidValues); setResult(null); return; }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(createEstimateUrl(code, { uf, date, customsValue, siscomexFee: expenses[0]!,
        afrmm: expenses[1]!, otherExpenses: expenses[2]! }), { cache: "no-store" });
      const body = await response.json().catch(() => null) as ImportEstimate & { detail?: string } | null;
      if (!response.ok || !body) throw new Error(body?.detail || text.failed(response.status));
      setResult(body);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : text.failed(0));
    } finally { setLoading(false); }
  }

  const money = (value: string | null | undefined) => formatMoney(value ?? null, locale);
  return <section className="ncm-rate-section" aria-label={t.title}>
    <h3>{t.title}</h3>
    <p className="muted">{t.help}</p>
    <form className="ncm-rate-form" onSubmit={event => void estimate(event)}>
      <label>{t.importer}<select value={importer} onChange={event => chooseImporter(event.target.value)}>
        <option value="">{t.noImporter}</option>
        {importers.map(item => <option key={item.importer} value={item.importer}>{item.importer}</option>)}
      </select></label>
      <label>{t.state}<select value={uf} onChange={event => setUf(event.target.value as IcmsState)}>
        {ICMS_STATES.map(state => <option key={state} value={state}>{t.states[state]}</option>)}
      </select></label>
      <label className="ncm-rate-form-check"><input type="checkbox" checked={foreign}
        onChange={event => setForeign(event.target.checked)} />{t.foreignMode}</label>
      {foreign ? <>
        <label>{t.fob}<input inputMode="decimal" required value={values.fob} onChange={event => set("fob", event.target.value)} /></label>
        <label>{t.freight}<input inputMode="decimal" value={values.freight} onChange={event => set("freight", event.target.value)} /></label>
        <label>{t.insurance}<input inputMode="decimal" value={values.insurance} onChange={event => set("insurance", event.target.value)} /></label>
        <label>{t.exchangeRate}<input inputMode="decimal" required value={values.exchangeRate}
          placeholder={t.exchangeRatePlaceholder} onChange={event => set("exchangeRate", event.target.value)} /></label>
      </> : <label>{t.customsValue}<input inputMode="decimal" required value={values.customsValue}
        placeholder={t.moneyPlaceholder} onChange={event => set("customsValue", event.target.value)} /></label>}
      <label>{t.siscomexFee}<input inputMode="decimal" value={values.siscomexFee} placeholder={t.moneyPlaceholder}
        onChange={event => set("siscomexFee", event.target.value)} /></label>
      <label>{t.afrmm}<input inputMode="decimal" value={values.afrmm} placeholder={t.moneyPlaceholder}
        onChange={event => set("afrmm", event.target.value)} /></label>
      <label>{t.otherExpenses}<input inputMode="decimal" value={values.otherExpenses} placeholder={t.moneyPlaceholder}
        onChange={event => set("otherExpenses", event.target.value)} /></label>
      <div className="ncm-rate-form-actions"><button className="button" disabled={loading}>{loading ? t.calculating : t.calculate}</button></div>
    </form>
    {error && <p className="notice error" role="alert">{error}</p>}
    {result && <div className="ncm-rate-estimate" role="status">
      <p className="notice">{t.disclaimer}</p>
      {result.status === "incomplete" && <p className="notice warning">{t.incomplete(result.missing.join(", "))}</p>}
      {result.warnings.map(warning => <p key={warning} className="notice warning">
        {t.warnings[warning as keyof typeof t.warnings] ?? warning}</p>)}
      <div className="table-scroll"><table>
        <caption>{t.resultTitle(t.states[result.uf], result.referenceDate.split("-").reverse().join("/"))}</caption>
        <thead><tr><th>{t.tax}</th><th>{t.base}</th><th>{t.rate}</th><th>{t.amount}</th><th>{t.source}</th></tr></thead>
        <tbody>
          <tr><td>{t.ii}</td><td>{money(result.ii?.base)}</td><td>{formatRate(result.ii?.rate ?? null, locale)}</td>
            <td>{money(result.ii?.amount)}</td><td>{result.iiAct ?? result.iiSource ?? "—"}</td></tr>
          <tr><td>{t.ipi}</td><td>{money(result.ipi?.base)}</td>
            <td>{result.ipi?.notTaxed ? m.ncmRates.notTaxed : formatRate(result.ipi?.rate ?? null, locale)}</td>
            <td>{money(result.ipi?.amount)}</td><td>{t.tipi}</td></tr>
          <tr><td>{t.pis}</td><td>{money(result.pis?.base)}</td><td>{formatRate(result.pis?.rate ?? null, locale)}</td>
            <td>{money(result.pis?.amount)}</td><td>{result.pisCofinsLegalBasis ?? "—"}</td></tr>
          <tr><td>{t.cofins}</td><td>{money(result.cofins?.base)}</td><td>{formatRate(result.cofins?.rate ?? null, locale)}</td>
            <td>{money(result.cofins?.amount)}</td><td>{result.pisCofinsLegalBasis ?? "—"}</td></tr>
          <tr><td>{t.icms}</td><td>{money(result.icms?.taxableBase)}</td>
            <td>{result.icms ? t.icmsRate(formatRate(result.icms.rate, locale), formatRate(result.icms.fcpRate, locale)) : "—"}</td>
            <td>{money(result.icms?.amount)}</td><td>{result.icmsLegalBasis ?? "—"}</td></tr>
        </tbody>
      </table></div>
      {result.icms && <dl className="ncm-rate-values">
        <div><dt>{t.icmsSum}</dt><dd>{money(result.icms.sum)}</dd></div>
        <div><dt>{t.icmsFullBase}</dt><dd>{money(result.icms.fullBase)}</dd></div>
        {result.icms.baseReduction && <div><dt>{t.baseReduction}</dt><dd>{formatRate(result.icms.baseReduction, locale)}
          {result.baseReductionLegalBasis ? ` — ${result.baseReductionLegalBasis}` : ""}</dd></div>}
        {result.icms.deferral && <div><dt>{t.deferred}</dt><dd>{money(result.icms.deferred)} ({formatRate(result.icms.deferral, locale)})
          {result.deferralLegalBasis ? ` — ${result.deferralLegalBasis}` : ""}</dd></div>}
        <div><dt>{t.icmsDue}</dt><dd><strong>{money(result.icms.due)}</strong></dd></div>
        <div><dt>{t.federalTotal}</dt><dd><strong>{money(result.federalTotal)}</strong></dd></div>
        <div><dt>{t.total}</dt><dd><strong>{money(result.total)}</strong></dd></div>
      </dl>}
      <p className="muted">{t.formula}</p>
    </div>}
  </section>;
}
