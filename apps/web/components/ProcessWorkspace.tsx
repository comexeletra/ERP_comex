"use client";

import Link from "next/link";
import { FormEvent, Fragment, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";

type Cost = { id: string; type: string; currency: string; amount: string; status: string; sourceSheetName: string; sourceRowNumber: number; sourceColumn: string };
type Order = { id: string; number: string; importer: string; linkSource: string };
type OperationalAllocation = { id: string; poId: string; poNumber: string; productCode: string; quantity: string; unit: string };
type Process = { id: string; ipNumber: string; importer: string; logisticsStatus: string | null;
  qualityStatus: string; sourceKind: string; priority: string | null; notes: string;
  version: string; lifecycleStatus: "OPEN" | "CLOSED"; closedAt: string | null;
  closedBy: string | null; closeReason: string | null;
  purchaseOrders: Order[]; historicalCosts: Cost[];
  operationalAllocations: OperationalAllocation[] };
type Line = { id: string; sourceSheetName: string; sourceRowNumber: number; sourceValues: Record<string, unknown>; sourceColumnHeaders: Record<string, string>; purchaseOrderId: string | null; poNumber: string | null; productCode: string | null; productDescription: string | null; quantityFromSource: string | null; legacyStatus: string | null };
type LinePage = { page: number; pageSize: number; totalCount: number; items: Line[] };

export default function ProcessWorkspace({ id, returnPath }: { id: string; returnPath: string }) {
  const [process, setProcess] = useState<Process>();
  const [lines, setLines] = useState<LinePage>();
  const [expandedLineId, setExpandedLineId] = useState<string>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);
  const [ipNumberDraft, setIpNumberDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [closing, setClosing] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const [notice, setNotice] = useState("");
  const [operationalOptions, setOperationalOptions] = useState<OperationalOption[]>([]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(undefined);
    Promise.all([
      apiFetch(`/api/v1/processes/${id}`, { signal: controller.signal }),
      apiFetch(`/api/v1/processes/${id}/items?page=${page}&pageSize=50`, { signal: controller.signal }),
      apiFetch("/auth/me", { signal: controller.signal }),
      loadOperationalOptions(),
    ]).then(async ([detail, items, identity, options]) => {
      if (detail.status === 401 || items.status === 401 || identity.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
      if (detail.status === 403 || items.status === 403) throw new Error("Seu acesso não permite consultar este IP.");
      if (detail.status === 404 || items.status === 404) throw new Error("IP não encontrado ou fora do seu escopo.");
      if (!detail.ok || !items.ok || !identity.ok) throw new Error("Não foi possível carregar o IP.");
      const [processValue, lineValue, user] = await Promise.all([detail.json() as Promise<Process>, items.json() as Promise<LinePage>, identity.json() as Promise<{ roles: string[] }>]);
      if (!controller.signal.aborted) {
        setProcess(processValue); setLines(lineValue); setRoles(user.roles); setOperationalOptions(options);
        setIpNumberDraft(processValue.ipNumber);
        setStatusDraft(processValue.logisticsStatus ?? ""); setPriorityDraft(processValue.priority ?? "");
        setNotesDraft(processValue.notes);
      }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, page, retry]);

  async function saveProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process) return;
    setSaving(true); setSaveError(undefined); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/processes/${id}`, { method: "PATCH",
        headers: { "content-type": "application/json", "If-Match": `"${process.version}"` },
        body: JSON.stringify({ ipNumber: ipNumberDraft, logisticsStatus: statusDraft || null, priority: priorityDraft || null,
          notes: notesDraft, reason }) });
      const body = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(body.detail || "Não foi possível atualizar o IP.");
      setNotice("IP atualizado."); setReason(""); setRetry(value => value + 1);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setSaving(false); }
  }
  async function closeProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process) return;
    setClosing(true); setSaveError(undefined); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/processes/${id}/close`, { method: "POST",
        headers: { "content-type": "application/json", "If-Match": `"${process.version}"` },
        body: JSON.stringify({ reason: closeReason }) });
      const body = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(body.detail || "Não foi possível encerrar o IP.");
      setNotice("IP encerrado."); setCloseReason(""); setRetry(value => value + 1);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setClosing(false); }
  }
  async function reopenProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process) return;
    setReopening(true); setSaveError(undefined); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/processes/${id}/reopen`, { method: "POST",
        headers: { "content-type": "application/json", "If-Match": `"${process.version}"` },
        body: JSON.stringify({ reason: reopenReason }) });
      const body = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(body.detail || "Não foi possível reabrir o IP.");
      setNotice("IP reaberto."); setReopenReason(""); setRetry(value => value + 1);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setReopening(false); }
  }
  const canWrite = roles.some(role => ["Master", "Administrador", "Importação"].includes(role));

  return <main className="shell"><Link className="back" href={returnPath}>← Lista de IPs</Link>
    {loading && <p role="status">Carregando IP…</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
    {!loading && !error && process && lines && <>
      <header className="page-header"><p className="eyebrow">IP · {process.importer}</p><h1>{process.ipNumber}</h1><p>Status logístico: {process.logisticsStatus ?? "não informado"}. Ciclo do IP: {process.lifecycleStatus === "CLOSED" ? "encerrado" : "aberto"}. Qualidade: {process.qualityStatus}. Origem: {process.sourceKind}.</p></header>
      <section className="metric-grid"><Metric label="POs vinculadas" value={process.purchaseOrders.length} /><Metric label="Linhas históricas" value={lines.totalCount} /><Metric label="Custos históricos" value={process.historicalCosts.length} /></section>
      <section className="card"><h2>Dados operacionais do IP</h2>
        <p>Prioridade: {process.priority ?? "não informada"}. Observações: {process.notes || "—"}.</p>
        {notice && <p className="notice success" role="status">{notice}</p>}
        {saveError && <p className="notice error" role="alert">{saveError}</p>}
        {process.lifecycleStatus === "CLOSED" && <>
          <p className="notice">IP encerrado em {process.closedAt ? new Date(process.closedAt).toLocaleString("pt-BR") : "data indisponível"}. Justificativa: {process.closeReason || "—"}</p>
          {canWrite && <details><summary>Reabrir IP</summary><form className="stack-form" onSubmit={reopenProcess}>
            <label>Justificativa<input required minLength={3} maxLength={1000} value={reopenReason}
              onChange={event => setReopenReason(event.target.value)} /></label>
            <button className="button" disabled={reopening}>{reopening ? "Reabrindo…" : "Reabrir IP"}</button>
          </form></details>}
        </>}
        {canWrite && process.lifecycleStatus === "OPEN" && <>
          <details><summary>Editar IP</summary><form className="stack-form" onSubmit={saveProcess}>
          <label>Número do IP<input required maxLength={80} disabled={process.sourceKind !== "MANUAL"}
            value={ipNumberDraft} onChange={event => setIpNumberDraft(event.target.value)} /></label>
          <label>Status logístico<OperationalOptionSelect entity="logistics_status" value={statusDraft} values={operationalOptions} onChange={setStatusDraft} /></label>
          <label>Prioridade<input maxLength={20} value={priorityDraft} onChange={event => setPriorityDraft(event.target.value)} /></label>
          <label>Observações<textarea maxLength={4000} value={notesDraft} onChange={event => setNotesDraft(event.target.value)} /></label>
          <label>Justificativa<input required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <button className="button" disabled={saving}>{saving ? "Salvando…" : "Salvar IP"}</button>
          </form></details>
          <details><summary>Encerrar IP</summary><form className="stack-form" onSubmit={closeProcess}>
            <p>O encerramento fica a critério do analista e não depende do status logístico. Depois de encerrado, os dados e as distribuições ficam bloqueados para edição.</p>
            <label>Justificativa<input required minLength={3} maxLength={1000} value={closeReason}
              onChange={event => setCloseReason(event.target.value)} /></label>
            <button className="button" disabled={closing}>{closing ? "Encerrando…" : "Encerrar IP"}</button>
          </form></details>
        </>}
      </section>
      <section className="card"><h2>POs vinculadas</h2><p className="muted">Vínculos históricos e operacionais. O IP pode atender várias POs, e uma PO pode aparecer em vários IPs.</p>
        {process.purchaseOrders.length === 0 && <p>Nenhuma PO vinculada. Linhas sem PO podem aparecer nas observações.</p>}
        {process.purchaseOrders.map(order => <p key={order.id}><Link className="text-link" href={`/purchase-orders/${order.id}`}>PO {order.number} →</Link> · {order.importer} · {order.linkSource}</p>)}
      </section>
      <section className="card"><h2>Quantidades distribuídas para este IP</h2>
        <p className="muted">Registros operacionais por item da PO. A quantidade de uma PO pode estar distribuída por vários IPs.</p>
        {process.operationalAllocations.length === 0 ? <p>Nenhuma quantidade distribuída operacionalmente.</p> :
          <div className="table-scroll"><table><thead><tr><th>PO</th><th>Produto</th><th>Quantidade</th></tr></thead><tbody>
            {process.operationalAllocations.map(item => <tr key={item.id}>
              <td><Link className="text-link" href={`/purchase-orders/${item.poId}`}>{item.poNumber}</Link></td>
              <td>{item.productCode}</td><td>{item.quantity} {item.unit}</td>
            </tr>)}
          </tbody></table></div>}
      </section>
      <section className="card"><h2>Observações da origem</h2><p className="muted">Células do Excel; produto, quantidade e status abaixo não são dados oficiais de item ou saldo.</p>
        {lines.items.length === 0 && <p>Nenhuma linha nesta página.</p>}
        {lines.items.length > 0 && <div className="table-scroll"><table><thead><tr><th>Origem</th><th>PO</th><th>Produto de origem</th><th>Quantidade de origem</th><th>Status de origem</th><th>Células</th></tr></thead><tbody>
          {lines.items.map(line => <Fragment key={line.id}><tr><td>{line.sourceSheetName} · {line.sourceRowNumber}</td><td>{line.purchaseOrderId ? <Link className="text-link" href={`/purchase-orders/${line.purchaseOrderId}`}>{line.poNumber}</Link> : "Sem PO"}</td><td>{line.productCode ?? "—"}<br />{line.productDescription}</td><td>{line.quantityFromSource ?? "—"}</td><td>{line.legacyStatus ?? "—"}</td><td><button type="button" className="source-expand-button" aria-label={`${expandedLineId === line.id ? "Ocultar" : "Ver"} campos da linha ${line.sourceRowNumber} da aba ${line.sourceSheetName}`} aria-expanded={expandedLineId === line.id} onClick={() => setExpandedLineId(current => current === line.id ? undefined : line.id)}>{expandedLineId === line.id ? "Ocultar campos" : "Ver campos"}</button></td></tr>
            {expandedLineId === line.id && <tr className="source-detail-row"><td colSpan={6}><section className="source-detail-panel"><div className="source-detail-heading"><strong>Campos preservados da origem</strong><span>Aba {line.sourceSheetName} · linha {line.sourceRowNumber}</span></div><dl className="source-field-grid">{Object.entries(line.sourceValues ?? {}).map(([column, value]) => <div className="source-field" key={column}><dt>{line.sourceColumnHeaders?.[column] || "Campo sem cabeçalho"}<small>{column}{line.sourceRowNumber}</small></dt><dd>{value == null ? "—" : String(value)}</dd></div>)}</dl></section></td></tr>}</Fragment>)}
        </tbody></table></div>}
        {lines.totalCount > lines.pageSize && <nav className="pagination"><button className="button secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page} de {Math.ceil(lines.totalCount / lines.pageSize)}</span><button className="button" disabled={page * lines.pageSize >= lines.totalCount} onClick={() => setPage(value => value + 1)}>Próxima</button></nav>}
      </section>
      <section className="card"><h2>Custos históricos do IP</h2><p className="muted">Valores permanecem no IP. Nenhum custo é atribuído integralmente a cada PO sem regra de rateio aprovada.</p>
        {process.historicalCosts.length === 0 && <p>Nenhum custo histórico registrado.</p>}
        {process.historicalCosts.length > 0 && <div className="table-scroll"><table><thead><tr><th>Tipo</th><th>Valor</th><th>Status</th><th>Origem</th></tr></thead><tbody>{process.historicalCosts.map(cost => <tr key={cost.id}><td>{cost.type}</td><td>{cost.amount} {cost.currency}</td><td>{cost.status}</td><td>{cost.sourceSheetName} · {cost.sourceColumn}{cost.sourceRowNumber}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </main>;
}

function Metric({ label, value }: { label: string; value: number }) { return <section className="metric"><span>{label}</span><strong>{value}</strong></section>; }
