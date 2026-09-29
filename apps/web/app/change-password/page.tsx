"use client";

import { FormEvent, useState } from "react";
import { apiFetch } from "../../lib/api";

export default function ChangePasswordPage() {
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
        setError(response.status === 401 ? "Senha atual inválida." : "Não foi possível trocar a senha.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Não foi possível trocar a senha. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="shell auth-shell">
    <section className="card auth-card">
      <p className="eyebrow">ERP Comex</p><h1>Trocar senha</h1>
      <p className="muted">Escolha uma senha com pelo menos 15 caracteres.</p>
      <form className="stack-form" onSubmit={(event) => void change(event)}>
        <label>Senha atual<input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label>Nova senha<input type="password" autoComplete="new-password" minLength={15} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button className="button" type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar nova senha"}</button>
      </form>
    </section>
  </main>;
}
