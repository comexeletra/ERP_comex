"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { formatUsDateTime } from "../../lib/date-format";

type RequestLine = { id: string; lineNumber: number; description: string; purposeText: string | null; costCenterText: string | null };
type ImportRequest = { id: string; requestNumber: string; importer: string; requesterReference: string;
  notes: string; status: string; version: string; itemCount: number; items?: RequestLine[]; createdAt: string };
type RequestPage = { totalCount: number; items: ImportRequest[] };
type DraftLine = { description: string; purposeText: string; costCenterText: string };
const blankLine = (): DraftLine => ({ description: "", purposeText: "", costCenterText: "" });

export default function RequestsPage() {
  const [importers, setImporters] = useState<Array<{ code: string }>>([]);
  const [requests, setRequests] = useState<ImportRequest[]>([]);
  const [importer, setImporter] = useState("");
  const [requesterReference, setRequesterReference] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [importerResponse, requestResponse] = await Promise.all([
        apiFetch("/api/v1/importers"), apiFetch("/api/v1/requests?page=1&pageSize=100"),
      ]);
      if (!importerResponse.ok || !requestResponse.ok) {
        const response = !importerResponse.ok ? importerResponse : requestResponse;
        throw new Error(response.status === 401 ? "Sua sessão expirou. Entre novamente." :
          response.status === 403 ? "Seu perfil não pode consultar solicitações." : "Não foi possível carregar os dados.");
      }
      const importerData = await importerResponse.json() as { items: Array<{ code: string }> };
      const requestData = await requestResponse.json() as RequestPage;
      setImporters(importerData.items); setRequests(requestData.items);
      if (!importer && importerData.items[0]) setImporter(importerData.items[0].code);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setLoading(false); }
  }, [importer]);

  useEffect(() => { void load(); }, [load, reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/requests", {
        method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ importer, requesterReference, reason, notes,
          items: lines.map(line => ({ description: line.description, purposeText: line.purposeText || null,
            costCenterText: line.costCenterText || null })) }),
      });
      const data = await response.json() as ImportRequest & { detail?: string };
      if (!response.ok) throw new Error(data.detail || "Não foi possível registrar a solicitação.");
      setNotice(`Solicitação ${data.requestNumber} registrada.`);
      setRequesterReference(""); setReason(""); setNotes(""); setLines([blankLine()]); setReload(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setSaving(false); }
  }

  return <main className="shell">
    <header className="page-header">
      <p className="eyebrow">ERP Comex</p><h1>Solicitações de importação</h1>
      <p>Registre uma solicitação nova e seus itens descritos pelo solicitante. Solicitações não são criadas a partir das linhas históricas da planilha.</p>
      <Link className="text-link" href="/">← Carteira de POs</Link>
    </header>
    <section className="card">
      <h2>Nova solicitação</h2>
      <p className="muted">O número é gerado pelo servidor. Produto, quantidade/unidade, finalidade e centro de custo oficiais ainda dependem de confirmação. Finalidade e centro de custo abaixo são referências livres informadas pelo solicitante.</p>
      {error && <div className="notice error" role="alert">{error} <button className="button secondary" type="button" onClick={() => setReload(value => value + 1)}>Tentar novamente</button></div>}
      {notice && <p className="notice success" role="status">{notice}</p>}
      <form className="stack-form request-form" onSubmit={submit}>
        <label>Importador<select required value={importer} onChange={event => setImporter(event.target.value)}>
          <option value="">Selecione</option>{importers.map(value => <option key={value.code} value={value.code}>{value.code}</option>)}
        </select></label>
        <label>Solicitante / referência<input required maxLength={160} value={requesterReference} onChange={event => setRequesterReference(event.target.value)} placeholder="Nome ou área informada" /></label>
        <label>Motivo da solicitação<textarea required minLength={8} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <label>Observações gerais<textarea maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <h3>Itens solicitados</h3>
        {lines.map((line, index) => <fieldset className="request-line" key={index}>
          <legend>Item {index + 1}</legend>
          <label>Descrição informada pelo solicitante<textarea required maxLength={1000} value={line.description}
            onChange={event => setLines(current => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} /></label>
          <div className="catalog-controls">
            <label>Finalidade informada (opcional)<input maxLength={500} value={line.purposeText}
              onChange={event => setLines(current => current.map((item, i) => i === index ? { ...item, purposeText: event.target.value } : item))} /></label>
            <label>Centro de custo informado (opcional)<input maxLength={160} value={line.costCenterText}
              onChange={event => setLines(current => current.map((item, i) => i === index ? { ...item, costCenterText: event.target.value } : item))} /></label>
          </div>
          {lines.length > 1 && <button className="button secondary" type="button" onClick={() => setLines(current => current.filter((_, i) => i !== index))}>Remover item</button>}
        </fieldset>)}
        {lines.length < 100 && <button className="button secondary" type="button" onClick={() => setLines(current => [...current, blankLine()])}>Adicionar item</button>}
        <button className="button" disabled={saving || !importer}>{saving ? "Registrando…" : "Registrar solicitação"}</button>
      </form>
    </section>
    <section className="card" aria-live="polite">
      <h2>Solicitações recentes</h2>
      {loading && <p role="status">Carregando…</p>}
      {!loading && !error && requests.length === 0 && <p>Nenhuma solicitação nativa registrada.</p>}
      {!loading && requests.length > 0 && <div className="table-scroll"><table>
        <thead><tr><th>Número</th><th>Importador</th><th>Solicitante</th><th>Itens</th><th>Status</th><th>Data</th><th>Ação</th></tr></thead>
        <tbody>{requests.map(item => <tr key={item.id}><td><strong>{item.requestNumber}</strong></td><td>{item.importer}</td>
          <td>{item.requesterReference}</td><td>{item.itemCount}</td><td>{item.status}</td>
          <td>{formatUsDateTime(item.createdAt)}</td><td><Link className="button" href={`/requests/${item.id}`}>Abrir</Link></td></tr>)}</tbody>
      </table></div>}
    </section>
  </main>;
}
