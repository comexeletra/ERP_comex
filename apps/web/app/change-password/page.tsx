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
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        if (response.status === 401 && payload?.error === "Senha atual inválida.") {
          setError("Senha atual inválida. Use a mesma senha com que entrou nesta conta.");
        } else if (response.status === 401) {
          setError("Sua sessão expirou. Entre novamente antes de trocar a senha.");
        } else if (response.status === 403) {
          setError("A verificação de segurança recusou a solicitação. Atualize a página e tente novamente.");
        } else if (response.status === 400 && payload?.error === "A nova senha deve ser diferente.") {
          setError(payload.error);
        } else {
          setError("Não foi possível trocar a senha.");
        }
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
