"use client";

import { useState } from "react";
import type { Messages } from "../lib/i18n/pt-BR";

export type BulkGroup = {
  id: keyof Messages["invoiceAudit"]["bulk"]["groups"];
  pending: number;
  actions: { id: keyof Messages["invoiceAudit"]["bulk"]["actions"]; needsReason: boolean;
    run: (reason: string) => { applied: number; left: number } }[];
};

/**
 * Bulk decisions at the top of the invoice audit (stage 1g): each kind of point shows how many have no decision and
 * the actions that decide all of them; what an action cannot decide stays pending and the panel says how many.
 */
export default function InvoiceBulkDecisions({ t, groups }: { t: Messages["invoiceAudit"]["bulk"]; groups: BulkGroup[] }) {
  const [reason, setReason] = useState("");
  const [result, setResult] = useState("");
  const reasonReady = reason.trim().length >= 3;
  const visible = groups.filter(group => group.pending > 0);
  if (!visible.length && !result) return null;
  return <section className="invoice-bulk" aria-labelledby="invoice-bulk-title">
    <h3 id="invoice-bulk-title">{t.title}</h3>
    <p className="muted">{t.help}</p>
    {visible.length > 0 && <>
      <label className="invoice-audit-reason">{t.reason}<input minLength={3} maxLength={1000} value={reason}
        onChange={event => setReason(event.target.value)} /></label>
      <ul className="invoice-bulk-groups">{visible.map(group => <li key={group.id}>
        <span><strong>{t.groups[group.id]}</strong> {t.pending(group.pending)}</span>
        <span className="button-row">{group.actions.map(action => <button key={action.id} className="button secondary"
          type="button" disabled={group.pending === 0 || (action.needsReason && !reasonReady)}
          onClick={() => {
            const outcome = action.run(reason.trim());
            setResult([t.applied(outcome.applied, t.actions[action.id]),
              outcome.left ? t.left[group.id](outcome.left) : ""].filter(Boolean).join(" "));
          }}>{t.actions[action.id]}</button>)}</span>
      </li>)}</ul>
      {!reasonReady && visible.some(group => group.actions.some(action => action.needsReason))
        && <p className="invoice-audit-note">{t.reasonNeeded}</p>}
    </>}
    {result && <p className="notice success" role="status">{result}</p>}
  </section>;
}
