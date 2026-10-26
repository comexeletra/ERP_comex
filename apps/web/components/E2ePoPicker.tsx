"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { matchesPurchaseOrderNumber } from "../lib/portfolio-query";
import { getMessages, useI18n } from "./I18nProvider";

type PurchaseOrderChoice = { id: string; number: string; importer: string };

/** Finds a PO by number and opens its end-to-end analysis. */
export default function E2ePoPicker() {
  const { m } = useI18n();
  const t = m.e2eAnalysis;
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PurchaseOrderChoice[]>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true); setError("");
    try {
      const params = new URLSearchParams({ number: query.trim(), pageSize: "20" });
      const result = await readApiJson<{ items: PurchaseOrderChoice[] }>(await apiFetch(`/api/v1/purchase-orders?${params}`));
      setMatches(result.items.filter(order => matchesPurchaseOrderNumber(order.number, query)));
    } catch {
      setMatches(undefined); setError(getMessages().e2eAnalysis.searchFailed);
    } finally {
      setSearching(false);
    }
  }

  return <section className="card e2e-picker" aria-labelledby="e2e-picker-title">
    <div className="e2e-panel-heading"><h2 id="e2e-picker-title">{t.pickerTitle}</h2><span className="muted">{t.pickerHelp}</span></div>
    <form className="e2e-picker-form" onSubmit={search}>
      <label>{t.poNumber}<input value={query} onChange={event => setQuery(event.target.value)} placeholder="030201" /></label>
      <button className="button" disabled={searching || !query.trim()}>{searching ? t.searching : t.search}</button>
    </form>
    {error && <div className="notice error" role="alert"><p>{error}</p></div>}
    {matches && !matches.length && <p className="muted" role="status">{t.noMatch}</p>}
    {matches && matches.length > 0 && <ul className="e2e-picker-list" aria-label={t.matches}>
      {matches.map(order => <li key={order.id}>
        <Link className="button secondary" href={`/end-to-end?po=${encodeURIComponent(order.id)}`}>{t.analyze(order.number, order.importer)}</Link>
      </li>)}
    </ul>}
  </section>;
}
