"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "./I18nProvider";

/**
 * Modal confirmation built on the native <dialog>, used instead of window.confirm.
 * Escape and the cancel button call onCancel; extra fields (such as a reason) go in children.
 */
export default function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel, danger = false, busy = false,
  confirmDisabled = false, className, onConfirm, onCancel }: {
  open: boolean; title: string; children?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean;
  busy?: boolean; confirmDisabled?: boolean;
  /** Extra class for a dialog that needs another size, such as the export column choice. */
  className?: string; onConfirm: () => void; onCancel: () => void;
}) {
  const { m } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && !confirmDisabled) onConfirm();
  }

  return <dialog ref={dialogRef} className={className ? `dialog ${className}` : "dialog"} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    {open && <form className="dialog-body" onSubmit={submit}>
      <h2 id={titleId}>{title}</h2>
      {children}
      <div className="dialog-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={onCancel}>{cancelLabel ?? m.dialog.cancel}</button>
        <button className={danger ? "button danger" : "button"} type="submit" disabled={busy || confirmDisabled}>
          {confirmLabel ?? m.dialog.confirm}
        </button>
      </div>
    </form>}
  </dialog>;
}

type ConfirmRequest = { title: string; message: string; confirmLabel?: string; danger?: boolean };

/** Promise-based confirmation: `if (!(await confirm({ ... }))) return;`. Render `dialog` once in the component. */
export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest & { resolve: (confirmed: boolean) => void }>();
  const confirm = useCallback((options: ConfirmRequest): Promise<boolean> =>
    new Promise(resolve => setRequest({ ...options, resolve })), []);
  const close = (confirmed: boolean) => {
    request?.resolve(confirmed);
    setRequest(undefined);
  };
  const dialog = <ConfirmDialog open={request !== undefined} title={request?.title ?? ""} confirmLabel={request?.confirmLabel}
    danger={request?.danger} onConfirm={() => close(true)} onCancel={() => close(false)}>
    {request && <p>{request.message}</p>}
  </ConfirmDialog>;
  return { confirm, dialog };
}
