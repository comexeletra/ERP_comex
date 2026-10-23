"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { formatNumber } from "../lib/format-number";
import { emptyProductLineFilters, parseProductLineFilters, productLineFilterBody, productLineQuery,
  productLineStatuses, type ProductLineFilters } from "../lib/purchase-order-lines";

type Value = string | number | boolean | null | undefined;
type ProductLine = {
  lineId: string; lineKind: "ALLOCATION" | "BALANCE"; quantity: string; factoryShipDate: string | null;
  purchaseOrder: { id: string; number: string; importer: string; supplierText: string | null };
  item: { id: string; productCode: string; description: string; unit: string | null };
  process: (Record<string, Value> & { id: string; ipNumber: string }) | null;
  calculated: Record<string, Value | string[]> & { status: string };
};
type LinesPage = { page: number; pageSize: number; totalCount: number; lines: ProductLine[] };
const pageSize = 50;

function show(value: Value | string[]): string {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return value == null || value === "" ? "—" : String(value);
}

/** Every PO product line with the shipment data of its IP: the system view of the Pré Embarque sheet. */
export default function ProductLinesView({ initialQuery }: { initialQuery: string }) {
  const [initial] = useState(() => {
    const query = new URLSearchParams(initialQuery);
    const requestedPage = Number(query.get("page"));
    return { filters: parseProductLineFilters(query),
      page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1 };
  });
  const [draft, setDraft] = useState<ProductLineFilters>(initial.filters);
  const [applied, setApplied] = useState<ProductLineFilters>(initial.filters);
  const [page, setPage] = useState(initial.page);
  const [response, setResponse] = useState<{ query: string; data?: LinesPage; error?: string }>();
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const query = productLineQuery(applied, page, pageSize).toString();

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/v1/purchase-order-lines?${query}`, { signal: controller.signal })
      .then(result => readApiJson<LinesPage>(result))
      .then(data => { if (!controller.signal.aborted) setResponse({ query, data }); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setResponse({ query, error: reason instanceof Error ? reason.message : "Erro inesperado." });
      });
    return () => controller.abort();
  }, [query]);
  const current = response?.query === query ? response : undefined;
  const loading = !current;
  const result = current?.data;
  const error = current?.error ?? "";

  function navigate(filters: ProductLineFilters, nextPage: number) {
    setApplied(filters); setPage(nextPage);
    window.history.replaceState(null, "", `/purchase-orders/lines?${productLineQuery(filters, nextPage, pageSize)}`);
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(draft, 1);
  }

  async function downloadExcel() {
    if (exporting || !result?.totalCount) return;
    setExporting(true); setExportError(""); setExportStatus("Enviando exportação para a fila…");
    try {
      const created = await apiFetch("/api/v1/exports/purchase-order-lines", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(productLineFilterBody(applied)),
      });
      if (!created.ok) {
        const body = await created.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "Não foi possível iniciar a exportação.");
      }
      const { id } = await created.json() as { id: string };
      let complete = false;
      while (!complete) {
        await new Promise(resolve => window.setTimeout(resolve, 1500));
        const statusResponse = await apiFetch(`/api/v1/exports/${id}`);
        if (!statusResponse.ok) throw new Error("Não foi possível consultar o andamento da exportação.");
        const status = await statusResponse.json() as { status: string; errorCode?: string | null };
        if (status.status === "failed") {
          throw new Error(status.errorCode === "EXPORT_TOO_LARGE"
            ? "A exportação suporta até 5.000 linhas. Refine os filtros e tente novamente."
            : "A exportação falhou. Tente novamente mais tarde.");
        }
        if (status.status === "completed") complete = true;
        else setExportStatus(status.status === "running" ? "Gerando arquivo Excel em segundo plano…" : "Aguardando processamento…");
      }
      setExportStatus("Baixando arquivo…");
      const file = await apiFetch(`/api/v1/exports/${id}/download`);
      if (!file.ok) throw new Error("O arquivo expirou ou não está mais disponível. Gere uma nova exportação.");
      const url = URL.createObjectURL(await file.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `carteira-por-produto-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Erro inesperado na exportação.");
    } finally { setExporting(false); setExportStatus(""); }
  }

  const totalPages = result ? Math.ceil(result.totalCount / pageSize) : 0;
  return <main className="shell">
    <header className="page-header portfolio-header">
      <p className="eyebrow">ERP Comex</p><h1>Carteira por produto</h1>
      <p>Cada linha é a parcela de um produto da PO dentro de um IP. As datas de pós embarque vêm do IP e são as
        mesmas para todos os produtos dele; o saldo ainda sem IP aparece como “A distribuir”.</p>
    </header>
    <section className="card">
      <form className="portfolio-filter" onSubmit={filter}>
        <label>Número da PO<input value={draft.purchaseOrder} onChange={event => setDraft({ ...draft, purchaseOrder: event.target.value })} /></label>
        <label>Importador<input value={draft.importer} onChange={event => setDraft({ ...draft, importer: event.target.value })} /></label>
        <label>Produto<input value={draft.product} onChange={event => setDraft({ ...draft, product: event.target.value })} placeholder="Código ou descrição" /></label>
        <label>IP<input value={draft.ipNumber} onChange={event => setDraft({ ...draft, ipNumber: event.target.value })} /></label>
        <label>Status<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as ProductLineFilters["status"] })}>
          <option value="">Todos</option>
          {productLineStatuses.map(status => <option key={status} value={status}>{status}</option>)}
        </select></label>
        <label>ETA a partir de<input type="date" value={draft.etaFrom} onChange={event => setDraft({ ...draft, etaFrom: event.target.value })} /></label>
        <label>ETA até<input type="date" value={draft.etaTo} onChange={event => setDraft({ ...draft, etaTo: event.target.value })} /></label>
        <label>Situação<select value={draft.situation} onChange={event => setDraft({ ...draft, situation: event.target.value as ProductLineFilters["situation"] })}>
          <option value="open">Em aberto (sem entregues e cancelados)</option>
          <option value="all">Todas</option>
        </select></label>
        <button className="button" type="submit">Aplicar filtros</button>
        <button className="button secondary" type="button" onClick={() => { setDraft(emptyProductLineFilters); navigate(emptyProductLineFilters, 1); }}>Limpar</button>
      </form>
    </section>
    <section className="card" aria-live="polite">
      {loading && <p role="status">Carregando linhas…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {!loading && !error && result && <>
        <p>{result.totalCount} linhas encontradas{result.totalCount > 0 && ` · página ${page} de ${totalPages}`}</p>
        {result.totalCount > 0 && <p><button className="button secondary" type="button" disabled={exporting}
          onClick={() => void downloadExcel()}>{exporting ? "Processando exportação…" : "Exportar linhas filtradas (Excel)"}</button></p>}
        {exportStatus && <p className="muted" role="status">{exportStatus}</p>}
        {exportError && <p className="notice error" role="alert">{exportError}</p>}
        {result.lines.length === 0 && result.totalCount > 0 && <p>Esta página está fora do intervalo. <button className="button" onClick={() => navigate(applied, 1)}>Ir para a primeira página</button></p>}
        {result.totalCount === 0 && <p>Nenhuma linha encontrada. Revise os filtros.</p>}
        {result.lines.length > 0 && <div className="table-scroll"><table><thead><tr>
          <th>PO</th><th>Produto</th><th>Quantidade</th><th>IP</th><th>Status</th><th>ETD</th><th>Departure</th>
          <th>BL date</th><th>ETA</th><th>Chegada</th><th>ETE</th><th>Entrega</th><th>Saída da fábrica</th><th>Invoice</th>
        </tr></thead><tbody>{result.lines.map(line => <tr key={`${line.lineKind}-${line.lineId}`}>
          <td><Link className="text-link" href={`/purchase-orders/${line.purchaseOrder.id}`}>{line.purchaseOrder.number}</Link>
            <small>{line.purchaseOrder.importer}</small></td>
          <td><strong>{line.item.productCode}</strong><small>{line.item.description}</small></td>
          <td>{formatNumber(line.quantity)} {line.item.unit ?? ""}</td>
          <td>{line.process ? <Link className="text-link" href={`/processes/${line.process.id}`}>{line.process.ipNumber}</Link>
            : <span className="po-ip-pending">Sem IP</span>}</td>
          <td>{line.calculated.status}</td>
          <td>{show(line.process?.etd)}</td><td>{show(line.process?.actualPortDepartureDate)}</td>
          <td>{show(line.process?.blDate)}</td><td>{show(line.calculated.eta)}</td>
          <td>{show(line.process?.arrivalDate)}</td><td>{show(line.calculated.ete)}</td>
          <td>{show(line.process?.deliveryDate)}</td><td>{show(line.factoryShipDate)}</td>
          <td>{show(line.calculated.invoiceNumbers)}</td>
        </tr>)}</tbody></table></div>}
        {totalPages > 1 && <nav className="pagination" aria-label="Páginas da carteira por produto">
          <button className="button secondary" disabled={page <= 1} onClick={() => navigate(applied, page - 1)}>Anterior</button>
          <span>Página {page} de {totalPages}</span>
          <button className="button" disabled={page >= totalPages} onClick={() => navigate(applied, page + 1)}>Próxima</button>
        </nav>}
      </>}
    </section>
  </main>;
}
