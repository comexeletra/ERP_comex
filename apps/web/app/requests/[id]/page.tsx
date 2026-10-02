"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { formatUsDateTime } from "../../../lib/date-format";

type RequestDetail = { id: string; requestNumber: string; importer: string; sourceKind: string;
  requesterReference: string; reason: string; notes: string; status: string; version: string;
  createdAt: string; items: Array<{ id: string; lineNumber: number; description: string;
    purposeText: string | null; costCenterText: string | null; sourceKind: string }> };
type DraftItem = { id?: string; description: string; purposeText: string; costCenterText: string };
type RequestDraft = { requesterReference: string; reason: string; notes: string; items: DraftItem[] };
const blankItem = (): DraftItem => ({ description: "", purposeText: "", costCenterText: "" });

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<RequestDetail>();
  const [draft, setDraft] = useState<RequestDraft>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/v1/requests/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
        if (response.status === 403) throw new Error("Seu perfil não pode consultar esta solicitação.");
        if (response.status === 404) throw new Error("Solicitação não encontrada no seu escopo.");
        if (!response.ok) throw new Error("Não foi possível carregar a solicitação.");
        return await response.json() as RequestDetail;
      })
      .then(data => { if (!controller.signal.aborted) setRequest(data); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);

  function beginEditing() {
    if (!request || request.status !== "SUBMITTED") return;
    setError(""); setNotice("");
    setDraft({ requesterReference: request.requesterReference, reason: request.reason, notes: request.notes,
      items: request.items.map(item => ({ id: item.id, description: item.description,
        purposeText: item.purposeText ?? "", costCenterText: item.costCenterText ?? "" })) });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request || !draft) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/requests/${encodeURIComponent(request.id)}`, {
        method: "PATCH", headers: { "content-type": "application/json", "If-Match": `"${request.version}"` },
        body: JSON.stringify({ ...draft, items: draft.items.map(item => ({ ...item,
          purposeText: item.purposeText || null, costCenterText: item.costCenterText || null })) }),
      });
      const data = await response.json() as RequestDetail & { detail?: string; code?: string };
      if (!response.ok) {
        if (response.status === 409 && data.code === "VERSION_CONFLICT") {
          throw new Error("A solicitação mudou desde que você a abriu. Seu rascunho foi mantido; recarregue a página para comparar.");
        }
        if (response.status === 409 && data.code === "REQUEST_NOT_EDITABLE") {
          throw new Error("Esta solicitação não aceita mais edição porque seu status mudou.");
        }
        throw new Error(data.detail || "Não foi possível salvar a solicitação.");
      }
      setRequest(data); setDraft(undefined); setNotice("Alterações salvas.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setSaving(false); }
  }

  function updateItem(index: number, changes: Partial<DraftItem>) {
    setDraft(current => current && ({ ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item) }));
  }

  return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex · Solicitações</p>
      <h1>{request?.requestNumber ?? "Detalhe da solicitação"}</h1>
      <Link className="text-link" href="/requests">← Voltar às solicitações</Link>
    </header>
    <section className="card" aria-live="polite">
      {loading && <p role="status">Carregando solicitação…</p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {notice && <p className="notice success" role="status">{notice}</p>}
      {request && <>
        <dl className="field-list">
          <dt>Importador</dt><dd>{request.importer}</dd>
          <dt>Origem</dt><dd>{request.sourceKind}</dd>
          <dt>Solicitante</dt><dd>{request.requesterReference}</dd>
          <dt>Status</dt><dd>{request.status}</dd>
          <dt>Versão</dt><dd>{request.version}</dd>
          <dt>Motivo</dt><dd>{request.reason}</dd>
          {request.notes && <><dt>Observações</dt><dd>{request.notes}</dd></>}
          <dt>Criada em</dt><dd>{formatUsDateTime(request.createdAt)}</dd>
        </dl>
        {!draft && <><h2>Itens solicitados</h2>
        {request.items.map(item => <article className="request-line" key={item.id}>
          <h3>Item {item.lineNumber}</h3><p>{item.description}</p>
          <p className="muted">Origem: {item.sourceKind}</p>
          {item.purposeText && <p><strong>Finalidade informada:</strong> {item.purposeText}</p>}
          {item.costCenterText && <p><strong>Centro de custo informado:</strong> {item.costCenterText}</p>}
        </article>)}</>}
        {!draft && request.status === "SUBMITTED" && <button className="button" type="button" onClick={beginEditing}>Editar solicitação</button>}
        {draft && <form className="stack-form request-form" onSubmit={save}>
          <h2>Editar solicitação</h2>
          <p className="muted">A edição está disponível enquanto o status for Enviada. Número, importador e status não podem ser alterados aqui.</p>
          <label>Solicitante / referência<input required maxLength={160} value={draft.requesterReference}
            onChange={event => setDraft(current => current && ({ ...current, requesterReference: event.target.value }))} /></label>
          <label>Motivo da solicitação<textarea required minLength={8} maxLength={2000} value={draft.reason}
            onChange={event => setDraft(current => current && ({ ...current, reason: event.target.value }))} /></label>
          <label>Observações gerais<textarea maxLength={2000} value={draft.notes}
            onChange={event => setDraft(current => current && ({ ...current, notes: event.target.value }))} /></label>
          <h3>Itens solicitados</h3>
          {draft.items.map((item, index) => <fieldset className="request-line" key={item.id ?? `new-${index}`}>
            <legend>Item {index + 1}</legend>
            <label>Descrição informada pelo solicitante<textarea required maxLength={1000} value={item.description}
              onChange={event => updateItem(index, { description: event.target.value })} /></label>
            <div className="catalog-controls">
              <label>Finalidade informada (opcional)<input maxLength={500} value={item.purposeText}
                onChange={event => updateItem(index, { purposeText: event.target.value })} /></label>
              <label>Centro de custo informado (opcional)<input maxLength={160} value={item.costCenterText}
                onChange={event => updateItem(index, { costCenterText: event.target.value })} /></label>
            </div>
            {draft.items.length > 1 && <button className="button secondary" type="button"
              onClick={() => setDraft(current => current && ({ ...current,
                items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}>Remover item</button>}
          </fieldset>)}
          {draft.items.length < 100 && <button className="button secondary" type="button"
            onClick={() => setDraft(current => current && ({ ...current, items: [...current.items, blankItem()] }))}>Adicionar item</button>}
          <div><button className="button" type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar alterações"}</button>
            <button className="button secondary" type="button" disabled={saving} onClick={() => { setDraft(undefined); setError(""); }}>Cancelar edição</button></div>
        </form>}
      </>}
    </section>
  </main>;
}
