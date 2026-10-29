"use client";

import { FormEvent, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { automaticAuditReason } from "../lib/audit";
import { useConfirmDialog } from "./ConfirmDialog";
import { getMessages, useI18n } from "./I18nProvider";

export type ExporterAlias = { id: string; alias: string; version: string };

/** Registers the short name under which a supplier appears in the invoice Exporter field. */
export async function createExporterAlias(supplierId: string, alias: string): Promise<ExporterAlias> {
  return readApiJson<ExporterAlias>(await apiFetch(`/api/v1/suppliers/${supplierId}/exporter-aliases`, {
    method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ alias, reason: automaticAuditReason }),
  }));
}

export default function SupplierExporterAliases({ supplierId, supplierCode, canWrite }: {
  supplierId: string; supplierCode: string; canWrite: boolean;
}) {
  const { m } = useI18n();
  const t = m.exporterAliases;
  const { confirm, dialog } = useConfirmDialog();
  const [aliases, setAliases] = useState<ExporterAlias[]>();
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const result = await readApiJson<{ items: ExporterAlias[] }>(await apiFetch(
        `/api/v1/suppliers/${supplierId}/exporter-aliases`, { cache: "no-store" }));
      setAliases(result.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : getMessages().exporterAliases.loadFailed); }
    finally { setLoading(false); }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const texts = getMessages().exporterAliases;
    setError(""); setNotice("");
    if (draft.replace(/[^A-Za-z0-9]/gu, "").length < 8) { setError(texts.tooShort); return; }
    setBusy(true);
    try {
      await createExporterAlias(supplierId, draft.trim());
      setDraft(""); setNotice(texts.created);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : texts.saveFailed); }
    finally { setBusy(false); }
  }

  async function remove(alias: ExporterAlias) {
    const texts = getMessages().exporterAliases;
    if (!(await confirm({ title: texts.removeTitle, message: texts.removeMessage(alias.alias, supplierCode),
      confirmLabel: texts.remove, danger: true }))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await readApiJson(await apiFetch(`/api/v1/suppliers/${supplierId}/exporter-aliases/${alias.id}/remove`, {
        method: "POST", headers: { "content-type": "application/json", "X-Record-Version": alias.version },
        body: JSON.stringify({ reason: automaticAuditReason }),
      }));
      setNotice(texts.removed);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : texts.removeFailed); }
    finally { setBusy(false); }
  }

  return <details className="supplier-alias"
    onToggle={event => { if (event.currentTarget.open && !aliases && !loading) void load(); }}>
    <summary>{t.title}{aliases ? ` · ${t.count(aliases.length)}` : ""}</summary>
    <p className="muted">{t.help}</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {loading && <p role="status">{t.loading}</p>}
    {aliases && (aliases.length ? <ul className="entity-value-list">{aliases.map(alias => <li key={alias.id}>
      <span>{alias.alias}</span>
      {canWrite && <button className="button secondary entity-value-action" type="button" disabled={busy}
        aria-label={t.removeAria(alias.alias)} onClick={() => void remove(alias)}>{t.remove}</button>}
    </li>)}</ul> : <p className="muted">{t.none}</p>)}
    {canWrite && <form className="entity-value-edit" onSubmit={event => void add(event)}>
      <label>{t.alias}<input required maxLength={240} value={draft} onChange={event => setDraft(event.target.value)} /></label>
      <button className="button entity-value-action" disabled={busy}>{busy ? t.saving : t.add}</button>
    </form>}
    {dialog}
  </details>;
}
