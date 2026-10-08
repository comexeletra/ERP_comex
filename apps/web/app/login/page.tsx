"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";

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
        if (response.status === 403) setError("A verificação de origem recusou o acesso. Atualize a página e tente novamente.");
        else if (response.status === 429) setError("Muitas tentativas. Aguarde e tente novamente.");
        else setError("E-mail ou senha inválidos.");
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

  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-brand">
        <Image src="/logo-eletra.png" alt="Eletra Energy Solutions" width={600} height={600} priority />
        <p className="eyebrow">TMS</p>
        <h1>Supply Chain</h1>
        <p>Gestão integrada de operações e importações.</p>
      </div>
      <div className="auth-form-panel">
        <p className="eyebrow">Acesso seguro</p>
        <h2>Bem-vindo</h2>
        <p className="muted">Entre com seu e-mail e senha corporativos.</p>
        <form className="stack-form" onSubmit={(event) => void login(event)}>
          <label>E-mail<input type="email" autoComplete="username" placeholder="nome@empresa.com" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Senha<input type="password" autoComplete="current-password" placeholder="Sua senha" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="notice error" role="alert">{error}</p>}
          <button className="button auth-submit" type="submit" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        </form>
        <p className="auth-help">Em caso de dificuldade, solicite suporte ao administrador do sistema.</p>
      </div>
    </section>
  </main>;
}
