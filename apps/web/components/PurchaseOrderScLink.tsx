"use client";

import { FormEvent, useState } from "react";
import { useI18n } from "./I18nProvider";
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
  const { m } = useI18n();
  const t = m.scLink;
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

  return <section className="po-entry-section" aria-label={t.title}>
    <h4>{t.title}</h4>
    <p className="muted">{t.intro}</p>
    {!supplierCode && <p className="notice error" role="alert">{t.supplierFirst}</p>}
    <form className="stack-form" onSubmit={submit}>
      <label>{m.fields.scNumber}<input required maxLength={80} value={scNumber} onChange={event => setScNumber(event.target.value)} /></label>
      {classification.kind === "match" && <p className="notice">{t.exists(classification.request.scNumber)}</p>}
      {classification.kind === "supplier-mismatch" && <p className="notice error" role="alert">
        {t.supplierMismatch(classification.request.scNumber, classification.request.supplierText ?? t.supplierNotInformed)}</p>}
      {classification.kind === "missing" && <>
        <label>{m.fields.requester}<OperationalOptionSelect required entity="requester" value={requester} values={options}
          onChange={setRequester} /></label>
        <label>{m.fields.scDate}<input type="date" value={scDate} onChange={event => setScDate(event.target.value)} /></label>
        <label>{m.fields.scApprovalDate}<input type="date" value={approvalDate} onChange={event => setApprovalDate(event.target.value)} /></label>
        <label>{m.fields.commercialPlanReceivedDate}<input type="date" value={commercialPlanReceivedDate}
          onChange={event => setCommercialPlanReceivedDate(event.target.value)} /></label>
        <button className="button" disabled={saving || !supplierCode || !requester.trim()}>{t.create}</button>
      </>}
    </form>
  </section>;
}
