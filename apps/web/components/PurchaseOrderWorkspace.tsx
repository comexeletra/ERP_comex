"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { formatNumber } from "../lib/format-number";
import OperationalPoPanel from "./OperationalPoPanel";
import FollowupPanel from "./FollowupPanel";
import { useI18n } from "./I18nProvider";

type Process = {
  id: string;
  ipNumber: string;
  logisticsStatus: string | null;
  qualityStatus: string;
  linkSource: string;
  linkedPurchaseOrderCount: number;
  costs: { type: string; currency: string; amount: string; status: string }[];
};
type Overview = {
  id: string;
  number: string;
  importer: string;
  lifecycleStatus: "ACTIVE" | "CANCELLED" | "CLOSED" | "DELETED";
  itemCount: number;
  processes: Process[];
};

export default function PurchaseOrderWorkspace({ id, returnPath }: { id: string; returnPath: string }) {
  const { m, messages } = useI18n();
  const t = m.poWorkspace;
  const [data, setData] = useState<Overview>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [operationalRevision, setOperationalRevision] = useState(0);

  function refreshOverview() {
    void apiFetch(`/api/v1/purchase-orders/${id}/overview`)
      .then(async response => { if (response.ok) setData(await response.json() as Overview); })
      .catch(() => undefined);
  }

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    setLoading(true);
    apiFetch(`/api/v1/purchase-orders/${id}/overview`, { signal: controller.signal })
      .then(async overviewResponse => {
        const text = messages();
        if (overviewResponse.status === 401) throw new Error(text.common.sessionExpired);
        if (overviewResponse.status === 403) throw new Error(text.poWorkspace.forbidden);
        if (overviewResponse.status === 404) {
          throw new Error(text.poWorkspace.notFound);
        }
        if (!overviewResponse.ok) {
          throw new Error(text.poWorkspace.loadFailed);
        }
        const overview = await overviewResponse.json() as Overview;
        if (!controller.signal.aborted) setData(overview);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : messages().common.unexpectedError);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, messages, retry]);

  if (loading || error || !data) return <main className="shell">
    <Link href={returnPath} className="back">{m.common.backToPortfolio}</Link>
    {loading && <p role="status">{t.loading}</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>{m.common.retry}</button></div>}
  </main>;

  return (
    <main className="shell">
      <Link href={returnPath} className="back">{m.common.backToPortfolio}</Link>
      <header className="page-header">
        <p className="eyebrow">PO TOTVS · {data.importer}</p>
        <h1>{data.number}</h1>
        <p>{t.status(m.poStatus[data.lifecycleStatus] ?? m.poStatus.ACTIVE)}</p>
        <p>{t.counts(data.itemCount, data.processes.length)}</p>
        <p>{t.flowHelp}</p>
      </header>

      <nav className="po-workflow-nav" aria-label={t.steps}>
        <a href="#po-record">{t.step1}</a>
        <a href="#ip-distribution">{t.step2}</a>
        <a href="#shipment-followup">{t.step3}</a>
      </nav>

      <OperationalPoPanel id={id} onChanged={() => { refreshOverview(); setOperationalRevision(value => value + 1); }} />
      <FollowupPanel key={operationalRevision} id={id} />

      <details id="linked-ips" className="card po-linked-ip-summary">
        <summary>{t.linkedSummary(data.processes.length)}</summary>
        {data.processes.length === 0 && <p>{t.noLinked}</p>}
        {data.processes.map(process => <article className="process" key={process.id}><h3>{process.ipNumber} <span>{process.logisticsStatus ?? t.noLogisticsStatus}</span></h3>
          <p className="muted">{t.ipQuality(process.qualityStatus, process.linkSource, process.linkedPurchaseOrderCount)}</p>
          <Link className="text-link" href={`/processes/${process.id}`}>{t.openIp}</Link>
          {process.costs.length > 0 && <details className="historical-costs"><summary>{t.historicalCosts(process.costs.length)}</summary><ul>{process.costs.map((cost, index) => <li key={`${cost.type}-${cost.currency}-${index}`}>{cost.type}: {formatNumber(cost.amount)} {cost.currency} · {cost.status}</li>)}</ul></details>}
        </article>)}
      </details>
    </main>
  );
}
