"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/local/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? "Muitas tentativas. Aguarde e tente novamente." : "E-mail ou senha inválidos.");
        return;
      }
      const session = await response.json() as { mustChangePassword: boolean };
      window.location.assign(session.mustChangePassword ? "/change-password" : "/");
    } catch {
      setError("Não foi possível entrar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="shell auth-shell">
    <section className="card auth-card">
      <p className="eyebrow">ERP Comex</p>
      <h1>Entrar</h1>
      <p className="muted">Use o acesso fornecido pelo usuário master.</p>
      <form className="stack-form" onSubmit={(event) => void login(event)}>
        <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button className="button" type="submit" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </section>
  </main>;
}
