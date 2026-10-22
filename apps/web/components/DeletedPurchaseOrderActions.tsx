"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, readApiJson } from "../lib/api";
import { deletedPurchaseOrderActions } from "../lib/po-lifecycle";
import type { PurchaseRequestPayloadChoice } from "../lib/totvs-purchase-request";

export type PurchaseOrderReplacePayload = {
  header: { number: string; supplierCode: string }; fileName: string; fileSha256: string; currency: string;
  items: Array<{ externalLineReference: string; productCode: string; description: string; orderedQuantity: string;
    unitPrice: string; unit: string; costCenter: string | null }>;
};
type ReplaceLine = { externalLineReference: string; productCode: string; currentProductCode?: string };
type ReplacePreview = { version: string; updated: ReplaceLine[]; added: ReplaceLine[]; removed: ReplaceLine[];
  reactivated: ReplaceLine[]; productChanged: ReplaceLine[]; blockers: Array<{ code: string; message: string }>;
  canApply: boolean };

const previewGroups: Array<[keyof Pick<ReplacePreview, "updated" | "added" | "removed" | "reactivated" | "productChanged">, string]> = [
  ["updated", "Atualizadas"], ["added", "Incluídas"], ["removed", "Removidas"],
  ["reactivated", "Reativadas"], ["productChanged", "Produto trocado"],
];
const listedLines = 20;

export default function DeletedPurchaseOrderActions({ purchaseOrder, canManageLifecycle, replacePayload,
  purchaseRequest, purchaseRequestBlocker }: {
  purchaseOrder: { id: string; version: string; replaceSupported: boolean };
  canManageLifecycle: boolean;
  replacePayload: PurchaseOrderReplacePayload | null;
  purchaseRequest: PurchaseRequestPayloadChoice | null;
  purchaseRequestBlocker: string | null;
}) {
  const router = useRouter();
  const actions = deletedPurchaseOrderActions(canManageLifecycle, purchaseOrder.replaceSupported);
  const [mode, setMode] = useState<"restore" | "replace" | null>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<ReplacePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const purchaseOrderHref = `/purchase-orders/${purchaseOrder.id}`;

  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação."); }
    finally { setBusy(false); }
  }
  function restore() {
    return run(async () => {
      await readApiJson(await apiFetch(`/api/v1/purchase-orders/${purchaseOrder.id}/restore`, {
        method: "POST", headers: { "content-type": "application/json", "X-Record-Version": purchaseOrder.version },
        body: JSON.stringify({ reason: reason.trim(), ...(purchaseRequest ? { purchaseRequest } : {}) }) }));
      router.push(purchaseOrderHref);
    });
  }
  function loadPreview() {
    if (!replacePayload) return;
    setMode("replace"); setPreview(null);
    return run(async () => {
      setPreview(await readApiJson<ReplacePreview>(await apiFetch(
        `/api/v1/purchase-orders/${purchaseOrder.id}/replace/preview`, { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify(replacePayload) })));
    });
  }
  function replace() {
    if (!replacePayload || !preview) return;
    return run(async () => {
      await readApiJson(await apiFetch(`/api/v1/purchase-orders/${purchaseOrder.id}/replace`, {
        method: "POST", headers: { "content-type": "application/json", "X-Record-Version": preview.version },
        body: JSON.stringify({ ...replacePayload, reason: reason.trim(), ...(purchaseRequest ? { purchaseRequest } : {}) }) }));
      router.push(purchaseOrderHref);
    });
  }

  const reasonReady = reason.trim().length >= 3;
  const purchaseRequestNotice = purchaseRequest && "newPurchaseRequest" in purchaseRequest
    ? `A SC ${purchaseRequest.newPurchaseRequest.scNumber} será criada com o solicitante `
      + `${purchaseRequest.newPurchaseRequest.requester} e vinculada à PO.`
    : purchaseRequest ? "A SC selecionada será vinculada à PO." : null;
  return <div className="notice">
    <p><Link className="text-link" href={purchaseOrderHref}>Abrir PO excluída</Link></p>
    {actions.needsManager && <p>Peça a um Master ou Administrador para restaurar ou substituir esta PO.</p>}
    {(actions.restore || actions.replace) && <div className="button-row">
      {actions.restore && <button className="button secondary" type="button" disabled={busy}
        onClick={() => { setMode("restore"); setPreview(null); }}>Restaurar PO</button>}
      {actions.replace && <button className="button secondary" type="button" disabled={busy || !replacePayload}
        onClick={() => void loadPreview()}>Substituir pela planilha</button>}
    </div>}
    {actions.replace && !replacePayload && <p className="muted">Carregue a planilha TOTVS da PO para substituir.</p>}
    {busy && <p className="muted">Processando…</p>}
    {mode === "replace" && preview && <>
      <p>Prévia da substituição: {previewGroups.map(([group, label]) => `${label} ${preview[group].length}`).join(" · ")}.</p>
      {previewGroups.filter(([group]) => preview[group].length > 0).map(([group, label]) => <p key={group}>
        {label}: {preview[group].slice(0, listedLines).map(line => line.currentProductCode
          ? `${line.externalLineReference} (${line.currentProductCode} → ${line.productCode})`
          : `${line.externalLineReference} (${line.productCode})`).join(", ")}
        {preview[group].length > listedLines ? ` e mais ${preview[group].length - listedLines}` : ""}.
      </p>)}
      {preview.blockers.map(blocker => <p key={blocker.code} className="notice error" role="alert">{blocker.message}</p>)}
    </>}
    {(mode === "restore" || (mode === "replace" && preview?.canApply)) && <>
      {purchaseRequestBlocker ? <p className="notice error" role="alert">{purchaseRequestBlocker}</p>
        : purchaseRequestNotice && <p className="muted">{purchaseRequestNotice}</p>}
      <label>Motivo<input required minLength={3} maxLength={1000} value={reason}
        onChange={event => setReason(event.target.value)} /></label>
      <button className="button" type="button" disabled={busy || !reasonReady || purchaseRequestBlocker !== null}
        onClick={() => void (mode === "restore" ? restore() : replace())}>
        {mode === "restore" ? "Confirmar restauração" : "Restaurar e substituir pela planilha"}
      </button>
    </>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </div>;
}
