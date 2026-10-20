"use client";

import { FormEvent, useState } from "react";
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
      if (!response.ok) throw new Error(body?.detail || `Consulta tributária indisponível (HTTP ${response.status}).`);
      setResult(body as Result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível consultar os tratamentos tributários.");
    } finally { setLoading(false); }
  }
  return <details className="ncm-tax">
    <summary>Consultar tratamentos tributários da NCM {code}</summary>
    <p className="muted">Informe os dados da importação para ver fundamentos que podem se aplicar.
      Esta consulta não calcula impostos nem confirma benefícios fiscais.</p>
    <form className="ncm-tax-form" onSubmit={event => void consult(event)}>
      <label>Data do fato gerador<input type="date" required value={date}
        onChange={event => setDate(event.target.value)} /></label>
      <label>País de origem — código Siscomex<input inputMode="numeric" pattern="[0-9]{1,3}"
        maxLength={3} required value={country} onChange={event => setCountry(event.target.value)}
        placeholder="Ex.: 023" /></label>
      <label>UF de destino<input maxLength={2} pattern="[A-Za-z]{2}" required value={uf}
        onChange={event => setUf(event.target.value)} placeholder="Ex.: SP" /></label>
      <label>Município de destino — código IBGE<input inputMode="numeric" pattern="[0-9]{7}"
        maxLength={7} required value={city} onChange={event => setCity(event.target.value)}
        placeholder="7 dígitos" /></label>
      <button className="button secondary" disabled={loading}>{loading ? "Consultando..." : "Consultar tratamentos"}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && <div className="ncm-tax-result" role="status">
      {result.stale && <p><strong>Dados armazenados:</strong> a atualização da fonte oficial não pôde ser confirmada.</p>}
      <p><strong>Consulta parcial.</strong> {result.limitation}</p>
      <p className="muted">Data consultada: {result.referenceDate}. Fonte: <a href={result.source}
        target="_blank" rel="noreferrer">Portal Único Siscomex — TTCE</a>.
        {result.fetchedAt ? ` Arquivo obtido em ${new Date(result.fetchedAt).toLocaleString("pt-BR")}.` : ""}</p>
      {result.treatments.length ? <ul className="ncm-tax-list">{result.treatments.map((item, index) =>
        <li key={`${item.tax.code}-${item.legalBasis.code}-${index}`}>
          <strong>{item.tax.name}</strong>
          <p>Regime: {item.regime.name}. Fundamento: {item.legalBasis.name}.
            {item.legalBasis.type?.toLowerCase() === "opcional" ? " Exige escolha e comprovação do enquadramento." : ""}</p>
          {item.attributes.length > 0 && <details><summary>Dados adicionais exigidos ({item.attributes.length})</summary>
            <ul>{item.attributes.map(attribute => <li key={attribute.code}>{attribute.name}
              {attribute.fillType ? ` — ${attribute.fillType}` : ""}</li>)}</ul>
          </details>}
          <details><summary>Referência técnica</summary><p>Tributo {item.tax.code}; regime {item.regime.code};
            fundamento {item.legalBasis.code}.</p></details>
        </li>)}</ul> : <p>O arquivo consultado não listou fundamentos com atributos adicionais ou opcionais
          para esses parâmetros. Isso não significa ausência de impostos.</p>}
    </div>}
  </details>;
}
