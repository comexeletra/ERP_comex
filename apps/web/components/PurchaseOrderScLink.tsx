"use client";

import { FormEvent, useState } from "react";
import { OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";
import { suggestedPurchaseRequestNumber } from "../lib/po-sc-link";
import { classifyTotvsPurchaseRequest, TotvsPurchaseRequestChoice } from "../lib/totvs-purchase-request";

export type PurchaseOrderScLinkBody = { scNumber: string; requester: string; scDate: string | null;
  approvalDate: string | null; commercialPlanReceivedDate: string | null };

export default function PurchaseOrderScLink({ importer, supplierCode, items, purchaseRequests, options, saving, onCreate }: {
  importer: string;
  supplierCode: string | null;
  items: ReadonlyArray<{ scNumber: string | null }>;
  purchaseRequests: readonly TotvsPurchaseRequestChoice[];
  options: OperationalOption[];
  saving: boolean;
  onCreate: (body: PurchaseOrderScLinkBody) => Promise<void>;
}) {
  const [scNumber, setScNumber] = useState(() => suggestedPurchaseRequestNumber(items));
  const [requester, setRequester] = useState("");
  const [scDate, setScDate] = useState("");
  const [approvalDate, setApprovalDate] = useState("");
  const [commercialPlanReceivedDate, setCommercialPlanReceivedDate] = useState("");
  const classification = classifyTotvsPurchaseRequest({ importer, scNumber, supplierCode: supplierCode ?? "", purchaseRequests });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (classification.kind !== "missing" || !requester.trim()) return;
    void onCreate({ scNumber: scNumber.trim(), requester: requester.trim(), scDate: scDate || null,
      approvalDate: approvalDate || null, commercialPlanReceivedDate: commercialPlanReceivedDate || null });
  }

  return <section className="po-entry-section" aria-label="SC da PO">
    <h4>SC da PO</h4>
    <p className="muted">Esta PO não tem SC vinculada. Crie a SC a partir do número informado nos itens ou vincule uma SC existente.</p>
    {!supplierCode && <p className="notice error" role="alert">Informe o fornecedor da PO antes de vincular a SC.</p>}
    <form className="stack-form" onSubmit={submit}>
      <label>Número da SC<input required maxLength={80} value={scNumber} onChange={event => setScNumber(event.target.value)} /></label>
      {classification.kind === "match" && <p className="notice">A SC {classification.request.scNumber} já existe para esta
        importadora e fornecedor. Selecione-a no campo SC em &quot;Dados da PO&quot; e salve.</p>}
      {classification.kind === "supplier-mismatch" && <p className="notice error" role="alert">A SC {classification.request.scNumber} já
        existe com o fornecedor {classification.request.supplierText ?? "não informado"}, diferente do fornecedor da PO.
        Corrija a SC no PCM ou o fornecedor da PO.</p>}
      {classification.kind === "missing" && <>
        <label>Solicitante<OperationalOptionSelect required entity="requester" value={requester} values={options}
          onChange={setRequester} /></label>
        <label>Data da SC<input type="date" value={scDate} onChange={event => setScDate(event.target.value)} /></label>
        <label>Data de aprovação da SC<input type="date" value={approvalDate} onChange={event => setApprovalDate(event.target.value)} /></label>
        <label>Data de recebimento do plano comercial<input type="date" value={commercialPlanReceivedDate}
          onChange={event => setCommercialPlanReceivedDate(event.target.value)} /></label>
        <button className="button" disabled={saving || !supplierCode || !requester.trim()}>Criar SC e vincular</button>
      </>}
    </form>
  </section>;
}
