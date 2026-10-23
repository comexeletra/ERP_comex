"use client";

import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { formatUsDateTime } from "../../../lib/date-format";
import { canWriteRequests } from "../../../lib/request-permissions";
import { getMessages, useI18n } from "../../../components/I18nProvider";
import PageHeader from "../../../components/PageHeader";
import { loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "../../../components/OperationalOptionSelect";

type RequestDetail = { id: string; requestNumber: string; importer: string; sourceKind: string;
  requesterReference: string; reason: string; notes: string; status: string; version: string;
  createdAt: string; items: Array<{ id: string; lineNumber: number; description: string;
    purposeText: string | null; costCenterText: string | null; sourceKind: string }> };
type DraftItem = { id?: string; description: string; purposeText: string; costCenterText: string };
type RequestDraft = { requesterReference: string; reason: string; notes: string; items: DraftItem[] };
type HistoryEntry = { id: string; operation: string; changedFields: string[]; actor: string;
  occurredAt: string; reason: string | null };
type HistoryPage = { page: number; pageSize: number; totalCount: number; items: HistoryEntry[] };
const blankItem = (): DraftItem => ({ description: "", purposeText: "", costCenterText: "" });

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { m } = useI18n();
  const t = m.requestDetail;
  const r = m.requests;
  const [request, setRequest] = useState<RequestDetail>();
  const [options, setOptions] = useState<OperationalOption[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [draft, setDraft] = useState<RequestDraft>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch("/auth/me", { signal: controller.signal }),
      apiFetch(`/api/v1/requests/${encodeURIComponent(id)}`, { signal: controller.signal }),
      loadOperationalOptions(),
    ])
      .then(async ([identityResponse, response, optionValues]) => {
        const text = getMessages();
        if (!identityResponse.ok) throw new Error(text.common.sessionExpired);
        const identity = await identityResponse.json() as { roles: string[] };
        if (!controller.signal.aborted) {
          setCanWrite(canWriteRequests(identity.roles)); setOptions(optionValues);
        }
        if (response.status === 401) throw new Error(text.common.sessionExpired);
        if (response.status === 403) throw new Error(text.requestDetail.forbidden);
        if (response.status === 404) throw new Error(text.requestDetail.notFound);
        if (!response.ok) throw new Error(text.requestDetail.loadFailed);
        return await response.json() as RequestDetail;
      })
      .then(data => { if (!controller.signal.aborted) setRequest(data); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/v1/requests/${encodeURIComponent(id)}/history?page=${historyPage}&pageSize=25`,
      { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(getMessages().requestDetail.historyFailed);
        return await response.json() as HistoryPage;
      })
      .then(data => {
        if (controller.signal.aborted) return;
        setHistory(current => historyPage === 1 ? data.items : [...current, ...data.items]);
        setHistoryTotal(data.totalCount);
        setHistoryError("");
      })
      .catch(cause => {
        if (!controller.signal.aborted) setHistoryError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError);
      })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [id, historyPage, historyRevision]);

  function beginEditing() {
    if (!canWrite || !request || request.status !== "SUBMITTED") return;
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
        method: "PATCH", headers: { "content-type": "application/json", "X-Record-Version": request.version },
        body: JSON.stringify({ ...draft, items: draft.items.map(item => ({ ...item,
          purposeText: item.purposeText || null, costCenterText: item.costCenterText || null })) }),
      });
      const data = await response.json() as RequestDetail & { detail?: string; code?: string };
      if (!response.ok) {
        if (response.status === 409 && data.code === "VERSION_CONFLICT") {
          throw new Error(t.versionConflict);
        }
        if (response.status === 409 && data.code === "REQUEST_NOT_EDITABLE") {
          throw new Error(t.notEditable);
        }
        throw new Error(data.detail || t.saveFailed);
      }
      setRequest(data); setDraft(undefined); setNotice(t.saved);
      setHistoryPage(1); setHistoryRevision(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : m.common.unexpectedError); }
    finally { setSaving(false); }
  }

  function updateItem(index: number, changes: Partial<DraftItem>) {
    setDraft(current => current && ({ ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item) }));
  }

  return <main className="shell">
    <PageHeader back={{ href: "/requests", label: t.back }} eyebrow={t.eyebrow} title={request?.requestNumber ?? t.fallbackTitle} />
    <section className="card" aria-live="polite">
      {loading && <p role="status">{t.loading}</p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {notice && <p className="notice success" role="status">{notice}</p>}
      {request && <>
        <dl className="field-list">
          <dt>{r.importer}</dt><dd>{request.importer}</dd>
          <dt>{t.source}</dt><dd>{request.sourceKind}</dd>
          <dt>{r.requesterShort}</dt><dd>{request.requesterReference}</dd>
          <dt>{r.status}</dt><dd>{(r.statuses as Record<string, string>)[request.status] ?? request.status}</dd>
          <dt>{t.version}</dt><dd>{request.version}</dd>
          <dt>{m.postShipment.reason}</dt><dd>{request.reason}</dd>
          {request.notes && <><dt>{m.followup.notes}</dt><dd>{request.notes}</dd></>}
          <dt>{t.createdAt}</dt><dd>{formatUsDateTime(request.createdAt)}</dd>
        </dl>
        {!draft && <><h2>{r.items}</h2>
        {request.items.map(item => <article className="request-line" key={item.id}>
          <h3>{r.item(item.lineNumber)}</h3><p>{item.description}</p>
          <p className="muted">{t.sourceLine(item.sourceKind)}</p>
          {item.purposeText && <p><strong>{t.purposeInformed}</strong> {item.purposeText}</p>}
          {item.costCenterText && <p><strong>{t.costCenterInformed}</strong> {item.costCenterText}</p>}
        </article>)}</>}
        {!draft && canWrite && request.status === "SUBMITTED" && <button className="button" type="button" onClick={beginEditing}>{t.edit}</button>}
        {draft && <form className="stack-form request-form" onSubmit={save}>
          <h2>{t.edit}</h2>
          <p className="muted">{t.editHelp}</p>
          <label>{r.requester}<OperationalOptionSelect required entity="requester" value={draft.requesterReference} values={options}
            onChange={requesterReference => setDraft(current => current && ({ ...current, requesterReference }))} /></label>
          <label>{r.reason}<textarea required minLength={8} maxLength={2000} value={draft.reason}
            onChange={event => setDraft(current => current && ({ ...current, reason: event.target.value }))} /></label>
          <label>{r.notes}<textarea maxLength={2000} value={draft.notes}
            onChange={event => setDraft(current => current && ({ ...current, notes: event.target.value }))} /></label>
          <h3>{r.items}</h3>
          {draft.items.map((item, index) => <fieldset className="request-line" key={item.id ?? `new-${index}`}>
            <legend>{r.item(index + 1)}</legend>
            <label>{r.description}<textarea required maxLength={1000} value={item.description}
              onChange={event => updateItem(index, { description: event.target.value })} /></label>
            <div className="catalog-controls">
              <label>{r.purpose}<OperationalOptionSelect entity="purpose" value={item.purposeText} values={options}
                onChange={purposeText => updateItem(index, { purposeText })} /></label>
              <label>{r.costCenter}<OperationalOptionSelect entity="cost_center" value={item.costCenterText} values={options}
                onChange={costCenterText => updateItem(index, { costCenterText })} /></label>
            </div>
            {draft.items.length > 1 && <button className="button secondary" type="button" aria-label={r.removeItemAria(index + 1)}
              onClick={() => setDraft(current => current && ({ ...current,
                items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}>{r.removeItem}</button>}
          </fieldset>)}
          {draft.items.length < 100 && <button className="button secondary" type="button"
            onClick={() => setDraft(current => current && ({ ...current, items: [...current.items, blankItem()] }))}>{r.addItem}</button>}
          <div><button className="button" type="submit" disabled={saving}>{saving ? t.saving : t.save}</button>
            <button className="button secondary" type="button" disabled={saving} onClick={() => { setDraft(undefined); setError(""); }}>{t.cancelEdit}</button></div>
        </form>}
      </>}
    </section>
    {request && <section className="card request-history" aria-label={t.history}>
      <h2>{t.history}</h2>
      {historyError && <p className="notice error" role="alert">{historyError}</p>}
      {historyLoading && history.length === 0 && <p role="status">{t.historyLoading}</p>}
      {!historyLoading && !historyError && history.length === 0 && <p className="muted">{t.noEvents}</p>}
      <ol className="request-history-list">
        {history.map(entry => <li key={entry.id}>
          <strong>{entry.operation === "CREATE" ? t.created : t.changed}</strong>
          <span className="muted">{formatUsDateTime(entry.occurredAt)} · {entry.actor}</span>
          {entry.changedFields.length > 0 && <p>{t.fields(entry.changedFields.join(", "))}</p>}
          {entry.reason && <p>{t.recordedReason(entry.reason)}</p>}
        </li>)}
      </ol>
      {history.length < historyTotal && <button className="button secondary" type="button" disabled={historyLoading}
        onClick={() => { setHistoryLoading(true); setHistoryPage(value => value + 1); }}>
        {historyLoading ? t.loadingMore : t.loadMore}
      </button>}
    </section>}
  </main>;
}
