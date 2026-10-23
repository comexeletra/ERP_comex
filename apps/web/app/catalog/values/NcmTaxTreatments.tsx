"use client";

import { FormEvent, useState } from "react";
import { useI18n } from "../../../components/I18nProvider";
import { apiFetch } from "../../../lib/api";

type Treatment = {
  tax: { code: string; name: string };
  regime: { code: string; name: string };
  legalBasis: { code: string; name: string; type?: string };
  attributes: Array<{ code: string; name: string; fillType: string | null }>;
};
type Result = {
  status: "partial" | "needs_input"; referenceDate: string; treatments: Treatment[];
  source: string; sourceHash: string | null; fetchedAt: string | null; stale: boolean;
  limitation: string; matchedIntervals?: number;
};

function todayInBrasilia(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function NcmTaxTreatments({ id, code }: { id: string; code: string }) {
  const { m } = useI18n();
  const t = m.taxTreatments;
  const [date, setDate] = useState(todayInBrasilia);
  const [country, setCountry] = useState("");
  const [uf, setUf] = useState("");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  async function consult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const query = new URLSearchParams({ date, originCountry: country,
        destinationUf: uf.toUpperCase(), destinationCity: city });
      const response = await apiFetch(`/api/v1/ncms/${id}/tax-treatments?${query}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail || t.unavailable(response.status));
      setResult(body as Result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.failed);
    } finally { setLoading(false); }
  }
  return <details className="ncm-tax">
    <summary>{t.summary(code)}</summary>
    <p className="muted">{t.help}</p>
    <form className="ncm-tax-form" onSubmit={event => void consult(event)}>
      <label>{t.date}<input type="date" required value={date}
        onChange={event => setDate(event.target.value)} /></label>
      <label>{t.country}<input inputMode="numeric" pattern="[0-9]{1,3}"
        maxLength={3} required value={country} onChange={event => setCountry(event.target.value)}
        placeholder={t.countryPlaceholder} /></label>
      <label>{t.uf}<input maxLength={2} pattern="[A-Za-z]{2}" required value={uf}
        onChange={event => setUf(event.target.value)} placeholder={t.ufPlaceholder} /></label>
      <label>{t.city}<input inputMode="numeric" pattern="[0-9]{7}"
        maxLength={7} required value={city} onChange={event => setCity(event.target.value)}
        placeholder={t.cityPlaceholder} /></label>
      <button className="button secondary" disabled={loading}>{loading ? t.consulting : t.consult}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && <div className="ncm-tax-result" role="status">
      {result.stale && <p><strong>{t.storedBefore}</strong>{t.storedAfter}</p>}
      <p><strong>{t.partial}</strong> {result.limitation}</p>
      <p className="muted">{t.referenceDate(result.referenceDate)}<a href={result.source}
        target="_blank" rel="noreferrer">{t.sourceLink}</a>.
        {result.fetchedAt ? t.fetchedAt(new Date(result.fetchedAt).toLocaleString("pt-BR")) : ""}</p>
      {result.treatments.length ? <ul className="ncm-tax-list">{result.treatments.map((item, index) =>
        <li key={`${item.tax.code}-${item.legalBasis.code}-${index}`}>
          <strong>{item.tax.name}</strong>
          <p>{t.regime(item.regime.name, item.legalBasis.name)}
            {item.legalBasis.type?.toLowerCase() === "opcional" ? t.optional : ""}</p>
          {item.attributes.length > 0 && <details><summary>{t.extraData(item.attributes.length)}</summary>
            <ul>{item.attributes.map(attribute => <li key={attribute.code}>{attribute.name}
              {attribute.fillType ? ` — ${attribute.fillType}` : ""}</li>)}</ul>
          </details>}
          <details><summary>{t.technical}</summary><p>{t.technicalCodes(item.tax.code, item.regime.code, item.legalBasis.code)}</p></details>
        </li>)}</ul> : <p>{t.none}</p>}
    </div>}
  </details>;
}
