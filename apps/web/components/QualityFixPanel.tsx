"use client";

import { useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { canFixQuality, canRegisterNcms, canRegisterProducts } from "../lib/quality-permissions";
import { qualityEvidenceFields, qualityFixAction, qualityFixPayload, qualityNcmCodes, qualityProductsPayload, qualitySkipLabel,
  type QualityFixForm } from "../lib/quality-issues";
import ConfirmDialog from "./ConfirmDialog";
import { getMessages, useI18n } from "./I18nProvider";
import { loadCatalogChoices, loadOperationalOptions } from "./OperationalOptionSelect";
import { SearchableSelect } from "./SearchableSelect";

export type FixableItem = { entityId: string; importer: string | null; labels: Record<string, unknown>; values: Record<string, unknown> };
type FixEntry = { entityId: string; before: Record<string, unknown>; after: Record<string, unknown> };
type FixResult = { applied: FixEntry[]; skipped: Array<{ entityId: string; code: string }> };
type Option = { value: string; label: string };

// Options load once per page, on the first card opened, instead of once per card.
let currencyOptions: Promise<Option[]> | undefined;
const supplierOptions = new Map<string, Promise<Option[]>>();
function currencies() {
  currencyOptions ??= loadOperationalOptions().then(items => items.filter(item => item.entity === "currency")
    .map(item => ({ value: item.value, label: item.value })));
  return currencyOptions;
}
function suppliers(importer: string) {
  if (!supplierOptions.has(importer)) {
    supplierOptions.set(importer, loadCatalogChoices("suppliers", importer).then(items => items
      .filter(item => item.status === "ACTIVE").map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }))));
  }
  return supplierOptions.get(importer)!;
}

/** Registration fix of one card, or of the cards selected for a bulk fix. */
export default function QualityFixPanel({ rule, items, roles, bulk = false, onDone }: {
  rule: string; items: FixableItem[]; roles: string[]; bulk?: boolean; onDone: (message: string) => void;
}) {
  const { m } = useI18n();
  const t = m.quality.fixes;
  const action = qualityFixAction(rule);
  const [open, setOpen] = useState(bulk);
  const [form, setForm] = useState<QualityFixForm>({});
  const [reason, setReason] = useState("");
  const [options, setOptions] = useState<{ currencies: Option[]; suppliers: Option[] }>({ currencies: [], suppliers: [] });
  const [preview, setPreview] = useState<FixResult & { key: string }>();
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!action || !items.length) return null;
  const allowed = action === "PRODUCT" ? canRegisterProducts(roles) : action === "NCM_OFFICIAL" ? canRegisterNcms(roles)
    : canFixQuality(roles);
  if (!allowed) return <p className="muted">{t.noPermission}</p>;
  const ids = items.map(item => item.entityId);
  const importer = items[0].importer ?? "";
  const labels = m.quality.evidenceLabels as Record<string, string | undefined>;
  const show = (value: unknown) => value == null || value === "" ? "—" : String(value);
  const describe = (entry: FixEntry) => Object.keys(entry.after).map(key => `${labels[key] ?? key}: ${t.change(show(entry.before[key]), show(entry.after[key]))}`).join(" · ");
  const identify = (entityId: string) => {
    const found = items.find(item => item.entityId === entityId);
    return found ? qualityEvidenceFields(m, found.labels, { hideIds: true }).filter(field => field.key !== "description")
      .map(field => field.value).join(" · ") : entityId;
  };

  async function start() {
    setOpen(true); setError(undefined);
    try {
      setOptions({ currencies: action === "ITEM_CURRENCY" || action === "ITEM_PRICE" ? await currencies() : [],
        suppliers: action === "PO_SUPPLIER" ? await suppliers(importer) : [] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : getMessages().common.unexpectedError);
    }
  }

  async function requestPreview() {
    if (!action) return;
    setBusy(true); setError(undefined);
    try {
      const response = await apiFetch("/api/v1/quality/current/fixes", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify(qualityFixPayload(action, ids, form, reason, true)) });
      setPreview({ ...await readApiJson<FixResult>(response), key: crypto.randomUUID() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : getMessages().quality.fixes.failed);
    } finally { setBusy(false); }
  }

  async function applyFix() {
    if (!action || !preview) return;
    setBusy(true); setError(undefined);
    try {
      const response = await apiFetch("/api/v1/quality/current/fixes", { method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": preview.key },
        body: JSON.stringify(qualityFixPayload(action, ids, form, reason, false)) });
      const result = await readApiJson<FixResult>(response);
      setPreview(undefined);
      onDone(getMessages().quality.fixes.applied(result.applied.length, result.skipped.length));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : getMessages().quality.fixes.failed);
    } finally { setBusy(false); }
  }

  async function register() {
    setBusy(true); setError(undefined);
    try {
      if (action === "PRODUCT") {
        const response = await apiFetch("/api/v1/products/bulk", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(qualityProductsPayload(items)) });
        const result = await readApiJson<{ createdCount: number; skippedCount: number }>(response);
        onDone(getMessages().quality.fixes.productsRegistered(result.createdCount, result.skippedCount));
      } else {
        let created = 0; const failures: string[] = [];
        for (const code of qualityNcmCodes(items)) {
          const response = await apiFetch("/api/v1/ncms/import-official", { method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ code }) });
          try { await readApiJson(response); created += 1; } catch (reason) {
            failures.push(`${code}: ${reason instanceof Error ? reason.message : ""}`);
            // While Siscomex is on hold every code fails the same way; stop instead of retrying it.
            if (response.status === 503) break;
          }
        }
        if (failures.length) setError(failures.join(" · "));
        onDone(getMessages().quality.fixes.ncmsRegistered(created, failures.length));
      }
      setRegistering(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : getMessages().quality.fixes.failed);
    } finally { setBusy(false); }
  }

  if (action === "PRODUCT" || action === "NCM_OFFICIAL") {
    const count = action === "PRODUCT" ? qualityProductsPayload(items).items.length : qualityNcmCodes(items).length;
    return <div className="quality-fix">
      {error && <p className="notice error">{error}</p>}
      {action === "NCM_OFFICIAL" && !count ? <p className="muted">{t.ncmInvalid}</p>
        : <button className="button" type="button" onClick={() => setRegistering(true)}>
          {action === "PRODUCT" ? t.registerProduct(count) : t.registerNcm(count)}</button>}
      <ConfirmDialog open={registering} title={action === "PRODUCT" ? t.registerProduct(count) : t.registerNcm(count)}
        confirmLabel={t.apply} cancelLabel={m.quality.cancel} busy={busy} onConfirm={() => void register()} onCancel={() => setRegistering(false)}>
        <p>{action === "PRODUCT" ? t.registerProductHelp : t.registerNcmHelp}</p>
        <ul>{(action === "PRODUCT" ? qualityProductsPayload(items).items.map(entry => `${entry.code} · ${entry.description}`)
          : qualityNcmCodes(items)).map(line => <li key={line}>{line}</li>)}</ul>
      </ConfirmDialog>
    </div>;
  }

  if (!open) return <button className="button secondary" type="button" onClick={() => void start()}>{t.title}</button>;
  const field = (key: keyof QualityFixForm) => (value: string) => setForm(current => ({ ...current, [key]: value }));
  return <div className="quality-fix">
    {error && <p className="notice error">{error}</p>}
    <div className="review-form">
      {action === "ITEM_CURRENCY" && <label>{t.currency}<SearchableSelect ariaLabel={t.currency} placeholder={t.suggestedCurrency}
        value={form.currency ?? ""} onChange={field("currency")}
        options={[{ value: "", label: t.suggestedCurrency }, ...options.currencies]} /></label>}
      {action === "ITEM_PRICE" && <>
        <label>{t.unitPrice}<input inputMode="decimal" value={form.unitPrice ?? ""} onChange={event => field("unitPrice")(event.target.value)} /></label>
        <label>{t.currency}<SearchableSelect ariaLabel={t.currency} required value={form.currency ?? ""} onChange={field("currency")}
          options={options.currencies} /></label>
      </>}
      {action === "ITEM_NCM" && <>
        <label>{t.ncm}<input inputMode="numeric" maxLength={10} value={form.ncm ?? ""} placeholder={t.ncmPlaceholder}
          onChange={event => field("ncm")(event.target.value)} /></label>
        {canRegisterProducts(roles) && <label className="quality-fix-check"><input type="checkbox" checked={form.alsoProduct ?? false}
          onChange={event => setForm(current => ({ ...current, alsoProduct: event.target.checked }))} />{t.alsoProduct}</label>}
      </>}
      {action === "PO_SUPPLIER" && <label>{t.supplier}<SearchableSelect ariaLabel={t.supplier} required value={form.supplierCode ?? ""}
        onChange={field("supplierCode")} options={options.suppliers} /></label>}
      <label>{t.reason}<textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
      <div><button className="button" type="button" disabled={busy || reason.trim().length < 8} onClick={() => void requestPreview()}>{t.preview}</button>
        {!bulk && <button className="button secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>{m.quality.cancel}</button>}</div>
    </div>
    <ConfirmDialog open={!!preview} title={t.previewTitle} confirmLabel={t.apply} cancelLabel={m.quality.cancel} busy={busy}
      confirmDisabled={!preview?.applied.length} onConfirm={() => void applyFix()} onCancel={() => setPreview(undefined)}>
      {preview && !preview.applied.length && <p>{t.nothingToChange}</p>}
      {!!preview?.applied.length && <><p>{t.willChange(preview.applied.length)}</p>
        <ul>{preview.applied.map(entry => <li key={entry.entityId}>{identify(entry.entityId)} — {describe(entry)}</li>)}</ul></>}
      {!!preview?.skipped.length && <><p>{t.willSkip(preview.skipped.length)}</p>
        <ul>{preview.skipped.map(entry => <li key={entry.entityId}>{identify(entry.entityId)} — {qualitySkipLabel(m, entry.code)}</li>)}</ul></>}
    </ConfirmDialog>
  </div>;
}
