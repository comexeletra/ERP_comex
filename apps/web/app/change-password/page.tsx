"use client";

import { FormEvent, useState } from "react";
import { useI18n } from "../../components/I18nProvider";
import PageHeader from "../../components/PageHeader";
import { apiFetch } from "../../lib/api";

// Exact API error texts; the API answers in Portuguese.
const invalidCurrentPasswordError = "Senha atual inválida."; // i18n-ignore: API contract
const samePasswordError = "A nova senha deve ser diferente."; // i18n-ignore: API contract

export default function ChangePasswordPage() {
  const { m } = useI18n();
  const t = m.changePassword;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/auth/local/password", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        if (response.status === 401 && payload?.error === invalidCurrentPasswordError) {
          setError(t.invalidCurrent);
        } else if (response.status === 401) {
          setError(t.sessionExpired);
        } else if (response.status === 403) {
          setError(t.securityRejected);
        } else if (response.status === 400 && payload?.error === samePasswordError) {
          setError(t.mustDiffer);
        } else {
          setError(t.failed);
        }
        return;
      }
      window.location.assign("/");
    } catch {
      setError(t.failedRetry);
    } finally {
      setBusy(false);
    }
  }

  return <main className="shell auth-shell">
    <PageHeader eyebrow={m.sidebar.account} title={t.title}><p>{t.instructions}</p></PageHeader>
    <section className="card">
      <form className="stack-form" onSubmit={(event) => void change(event)}>
        <label>{t.current}<input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label>{t.next}<input type="password" autoComplete="new-password" minLength={15} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button className="button" type="submit" disabled={busy}>{busy ? t.saving : t.submit}</button>
      </form>
    </section>
  </main>;
}
