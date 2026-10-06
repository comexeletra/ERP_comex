"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { automaticAuditReason } from "../../lib/audit";
import { formatUsDate, formatUsDateTime, parseUsDate } from "../../lib/date-format";

type Resource = "suppliers" | "products" | "ncms";
type Importer = { code: string; historicalPoCount: number; status: string };
type Candidate = { importer: string; rawCode: string; observationCount: number;
  sampleSourceRowId: string; sampleSheetName: string; sampleRowNumber: number; eligibleFormat: boolean };
type Entry = { id: string; importer: string; code: string; name: string; status: string;
  evidence: string; validFrom: string | null; validTo: string | null; version: string; provenance: string };
type AuditEvent = { id: string; operation: string; fieldName: string | null; oldValue: unknown;
  newValue: unknown; actor: string; occurredAt: string; reason: string | null };
type AuditPage = { page: number; pageSize: number; totalCount: number; items: AuditEvent[] };
type Page<T> = { page: number; totalCount: number; items: T[] };
const labels: Record<Resource, string> = { suppliers: "Fornecedores", products: "Produtos", ncms: "NCM" };

async function responseJson<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
  if (response.status === 403) throw new Error("Seu perfil não permite esta operação.");
  if (response.status === 404) throw new Error("O registro não está disponível no seu escopo.");
  if (response.status === 409) throw new Error("Conflito de código ou versão. Recarregue e confira o cadastro.");
  if (!response.ok) throw new Error("Não foi possível concluir a operação. Confira os campos e tente novamente.");
  return await response.json() as T;
}

export default function CatalogPage() {
  const [resource, setResource] = useState<Resource>("suppliers");
  const [importers, setImporters] = useState<Importer[]>([]);
  const [importer, setImporter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [registered, setRegistered] = useState<Page<Entry>>();
  const [candidates, setCandidates] = useState<Page<Candidate>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [draft, setDraft] = useState({ code: "", name: "", evidence: "", validFrom: "" });
  const [editing, setEditing] = useState<Entry>();
  const [historyEntry, setHistoryEntry] = useState<Entry>();
  const [history, setHistory] = useState<AuditPage>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historyRequest = useRef(0);
  const [editDraft, setEditDraft] = useState({ name: "", status: "ACTIVE", evidence: "" });

  useEffect(() => {
    apiFetch("/auth/me").then(responseJson<{ roles: string[] }>)
      .then(data => setRoles(data.roles)).catch(() => undefined);
    apiFetch("/api/v1/importers").then(responseJson<{ items: Importer[] }>)
      .then(data => { setImporters(data.items); setImporter(current => current || data.items[0]?.code || ""); })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Erro ao carregar importadores."));
  }, []);

  useEffect(() => {
    if (!importer) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(undefined); setRegistered(undefined); setCandidates(undefined);
    const query = new URLSearchParams({ importer, page: String(page), pageSize: "25" });
    if (search) query.set("search", search);
    Promise.all([
      apiFetch(`/api/v1/${resource}?${query}`, { signal: controller.signal }).then(responseJson<Page<Entry>>),
      apiFetch(`/api/v1/${resource}/candidates?${query}`, { signal: controller.signal }).then(responseJson<Page<Candidate>>),
    ]).then(([entries, source]) => { if (!controller.signal.aborted) { setRegistered(entries); setCandidates(source); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Erro ao carregar cadastros."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [resource, importer, search, page, refresh]);

  function chooseResource(next: Resource) { historyRequest.current += 1; setHistoryLoading(false); setResource(next); setPage(1); setDraft({ code: "", name: "", evidence: "", validFrom: "" }); setEditing(undefined); setHistoryEntry(undefined); setHistory(undefined); }
  function chooseCandidate(candidate: Candidate) {
    setDraft({ code: candidate.rawCode, name: resource === "ncms" ? candidate.rawCode : "",
      evidence: `Origem ${candidate.sampleSheetName}, linha ${candidate.sampleRowNumber}; documento de confirmação: `,
      validFrom: "" });
    document.getElementById("catalog-create")?.scrollIntoView({ behavior: "smooth" });
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(undefined); setMessage(undefined);
    const validFrom = resource === "ncms" ? parseUsDate(draft.validFrom) : null;
    if (resource === "ncms" && !validFrom) {
      setError("Informe uma data válida no formato MM/DD/YYYY."); setSaving(false); return;
    }
    try {
      const response = await apiFetch(`/api/v1/${resource}`, { method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ importer, code: draft.code, name: draft.name, evidence: draft.evidence,
          reason: automaticAuditReason, validFrom }) });
      await responseJson<Entry>(response);
      setDraft({ code: "", name: "", evidence: "", validFrom: "" });
      setMessage("Cadastro registrado.");
      setPage(1); setRefresh(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao salvar."); }
    finally { setSaving(false); }
  }
  function startEdit(entry: Entry) {
    setEditing(entry); setEditDraft({ name: entry.name, status: entry.status, evidence: entry.evidence });
  }
  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    setSaving(true); setError(undefined); setMessage(undefined);
    try {
      const response = await apiFetch(`/api/v1/${resource}/${editing.id}`, { method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Record-Version": editing.version },
        body: JSON.stringify({ ...editDraft, reason: automaticAuditReason }) });
      await responseJson<Entry>(response);
      setEditing(undefined); setMessage("Cadastro atualizado com auditoria."); setRefresh(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao atualizar."); }
    finally { setSaving(false); }
  }
  async function loadHistory(entry: Entry, nextPage = 1) {
    const requestId = ++historyRequest.current;
    setHistoryEntry(entry); setHistoryLoading(true); setHistoryError("");
    try {
      const query = new URLSearchParams({ page: String(nextPage), pageSize: "25" });
      const response = await apiFetch(`/api/v1/${resource}/${entry.id}/history?${query}`);
      const data = await responseJson<AuditPage>(response);
      if (historyRequest.current === requestId) setHistory(data);
    } catch (reason) {
      if (historyRequest.current === requestId) {
        setHistory(undefined);
        setHistoryError(reason instanceof Error ? reason.message : "Erro ao carregar histórico.");
      }
    } finally { if (historyRequest.current === requestId) setHistoryLoading(false); }
  }

  const canWrite = roles.includes("Master") || roles.includes("Administrador")
    || roles.includes(resource === "ncms" ? "Fiscal" : "Compras");
  const canRegisterPo = roles.some(role => ["Master", "Administrador", "Importação", "Compras"].includes(role));
  const canRegisterIp = roles.some(role => ["Master", "Administrador", "Importação"].includes(role));
  return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Cadastros</h1>
      <div className="catalog-links"><Link className="text-link" href="/">← Carteira de POs</Link></div></header>
    <section className="card" aria-labelledby="registration-options-title">
      <h2 id="registration-options-title">Novo cadastro</h2>
      <nav className="catalog-links" aria-label="Tipos de cadastro">
        <Link className="button secondary" href={canWrite ? "#catalog-create" : "#catalog-controls"}>Fornecedores, produtos e NCM</Link>
        <Link className="button secondary" href="/catalog/values">Valores das entidades</Link>
        {canRegisterPo && <Link className="button secondary" href="/purchase-orders/new">Cadastrar PO do TOTVS</Link>}
        {canRegisterIp && <Link className="button secondary" href="/processes/new?from=catalog">Cadastrar IP</Link>}
      </nav>
    </section>
    <section className="card catalog-controls" id="catalog-controls">
      <div role="group" aria-label="Tipo de cadastro">{(Object.keys(labels) as Resource[]).map(key =>
        <button type="button" key={key} className={`button ${resource === key ? "" : "secondary"}`} onClick={() => chooseResource(key)}>{labels[key]}</button>)}</div>
      <label>Importador<select value={importer} onChange={event => { historyRequest.current += 1; setHistoryLoading(false); setImporter(event.target.value); setPage(1); setHistoryEntry(undefined); setHistory(undefined); }}>
        {importers.map(value => <option key={value.code} value={value.code}>{value.code} · {value.historicalPoCount} POs históricas</option>)}
      </select></label>
      <label>Pesquisar código ou nome<input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    </section>
    {error && <div className="notice error" role="alert">{error} <button className="button" type="button" onClick={() => setRefresh(value => value + 1)}>Tentar novamente</button></div>}
    {message && <p className="notice" role="status">{message}</p>}
    {loading && <p role="status">Carregando cadastros…</p>}
    {!loading && !error && <>
      <section className="card"><h2>{labels[resource]} cadastrados</h2>
        <p className="muted">{registered?.totalCount ?? 0} registros</p>
        {registered?.items.length === 0 && <p>Nenhum cadastro encontrado.</p>}
        {!!registered?.items.length && <div className="table-scroll"><table><thead><tr><th>Código</th><th>Nome</th><th>Situação</th><th>Vigência</th><th>Versão</th><th>Ação</th></tr></thead><tbody>
          {registered.items.map(entry => <tr key={entry.id}><td>{entry.code}</td><td>{entry.name}</td><td>{entry.status === "ACTIVE" ? "Ativo" : "Inativo"}</td>
            <td>{formatUsDate(entry.validFrom) || "—"}{entry.validTo ? ` a ${formatUsDate(entry.validTo)}` : ""}</td><td>{entry.version}</td>
            <td><button className="button secondary" type="button" aria-label={`Ver histórico de ${labels[resource].toLowerCase()} ${entry.code}`} disabled={historyLoading} onClick={() => void loadHistory(entry)}>Histórico</button>
              {canWrite && <button className="button secondary" type="button" aria-label={`Editar ${labels[resource].toLowerCase()} ${entry.code}`} onClick={() => startEdit(entry)}>Editar</button>}</td></tr>)}
        </tbody></table></div>}
      </section>
      {historyEntry && <section className="card request-history" aria-label={`Histórico do cadastro ${historyEntry.code}`}>
        <div className="quality-heading"><h2>Histórico: {historyEntry.code} · {historyEntry.name}</h2>
          <button className="button secondary" type="button" onClick={() => { historyRequest.current += 1; setHistoryLoading(false); setHistoryEntry(undefined); setHistory(undefined); }}>Fechar</button></div>
        {historyError && <p className="notice error" role="alert">{historyError}</p>}
        {historyLoading && <p role="status">Carregando histórico…</p>}
        {!historyLoading && history && <>
          {history.items.length === 0 && <p className="muted">Nenhuma alteração auditada para este cadastro.</p>}
          <ol className="request-history-list">{history.items.map(event => <li key={event.id}>
            <strong>{event.fieldName ?? event.operation}</strong>
            <span className="muted">{event.actor} · {formatUsDateTime(event.occurredAt)}</span>
            <p>Antes: {formatAuditValue(event.oldValue)} · Depois: {formatAuditValue(event.newValue)}</p>
          </li>)}</ol>
          {history.totalCount > history.pageSize && <nav className="pagination" aria-label="Páginas do histórico">
            <button className="button secondary" disabled={history.page <= 1} onClick={() => void loadHistory(historyEntry, history.page - 1)}>Anterior</button>
            <span>Página {history.page} de {Math.ceil(history.totalCount / history.pageSize)}</span>
            <button className="button" disabled={history.page * history.pageSize >= history.totalCount} onClick={() => void loadHistory(historyEntry, history.page + 1)}>Próxima</button>
          </nav>}
        </>}
      </section>}
      <details className="card catalog-candidates"><summary>Candidatos de origem <span>{candidates?.totalCount ?? 0}</span></summary><p className="muted">{candidates?.totalCount ?? 0} valores encontrados</p>
        {candidates?.items.length === 0 && <p>Nenhum candidato encontrado.</p>}
        {!!candidates?.items.length && <div className="table-scroll"><table><thead><tr><th>Valor literal</th><th>Observações</th><th>Origem</th><th>Ação</th></tr></thead><tbody>
          {candidates.items.map((value, index) => <tr key={`${value.rawCode}-${index}`}><td>{value.rawCode}</td><td>{value.observationCount}</td><td>{value.sampleSheetName}, linha {value.sampleRowNumber}</td>
            <td>{value.eligibleFormat ? canWrite && <button className="button secondary" type="button" onClick={() => chooseCandidate(value)}>Preparar revisão</button> : "Formato inválido; revisar origem"}</td></tr>)}
        </tbody></table></div>}
      </details>
      <nav className="pagination" aria-label="Páginas dos cadastros"><button className="button secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page}</span><button className="button" disabled={Math.max(registered?.totalCount ?? 0, candidates?.totalCount ?? 0) <= page * 25} onClick={() => setPage(page + 1)}>Próxima</button></nav>
    </>}
    {canWrite && <section className="card" id="catalog-create"><h2>Registrar {labels[resource].toLowerCase()}</h2>
      <p className="muted">Informe os dados do novo cadastro.</p>
      <form className="stack-form" onSubmit={event => void create(event)}>
        <label>Código ou nome da origem<input required maxLength={120} value={draft.code} onChange={event => setDraft(value => ({ ...value, code: event.target.value }))} /></label>
        <label>Nome operacional<input required maxLength={240} value={draft.name} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} /></label>
        {resource === "ncms" && <label>Início da vigência (MM/DD/YYYY)<input required type="text" inputMode="numeric" maxLength={10} pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}" placeholder="MM/DD/YYYY" value={draft.validFrom} onChange={event => setDraft(value => ({ ...value, validFrom: event.target.value }))} /></label>}
        <label>Evidência da revisão<textarea required minLength={8} maxLength={2000} value={draft.evidence} onChange={event => setDraft(value => ({ ...value, evidence: event.target.value }))} placeholder="Documento, número, data e onde conferir" /></label>
        <button className="button" disabled={saving || !importer} type="submit">{saving ? "Salvando…" : "Registrar cadastro"}</button>
      </form>
    </section>}
    {editing && <section className="card"><h2>Editar {editing.code}</h2><p className="muted">Versão {editing.version}. Inativação preserva o histórico e o código original.</p>
      <form className="stack-form" onSubmit={event => void saveEdit(event)}>
        <label>Nome<input required value={editDraft.name} onChange={event => setEditDraft(value => ({ ...value, name: event.target.value }))} /></label>
        <label>Situação<select value={editDraft.status} onChange={event => setEditDraft(value => ({ ...value, status: event.target.value }))}><option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option></select></label>
        <label>Evidência<textarea required minLength={8} value={editDraft.evidence} onChange={event => setEditDraft(value => ({ ...value, evidence: event.target.value }))} /></label>
        <div><button className="button" disabled={saving} type="submit">Salvar alteração</button><button className="button secondary" type="button" onClick={() => setEditing(undefined)}>Cancelar</button></div>
      </form></section>}
  </main>;
}

function formatAuditValue(value: unknown): string {
  if (value == null) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
