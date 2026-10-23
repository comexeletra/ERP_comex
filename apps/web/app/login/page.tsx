"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { useI18n } from "../../components/I18nProvider";
import LanguageSwitcher from "../../components/LanguageSwitcher";

export default function LoginPage() {
  const { m } = useI18n();
  const t = m.login;
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
        if (response.status === 403) setError(t.originRejected);
        else if (response.status === 429) setError(t.tooManyAttempts);
        else setError(t.invalidCredentials);
        return;
      }
      const session = await response.json() as { mustChangePassword: boolean };
      window.location.assign(session.mustChangePassword ? "/change-password" : "/");
    } catch {
      setError(t.failed);
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
        <p>{t.brandTagline}</p>
      </div>
      <div className="auth-form-panel">
        <LanguageSwitcher className="auth-language" />
        <p className="eyebrow">{t.secureAccess}</p>
        <h2>{t.welcome}</h2>
        <p className="muted">{t.instructions}</p>
        <form className="stack-form" onSubmit={(event) => void login(event)}>
          <label>{t.email}<input type="email" autoComplete="username" placeholder={t.emailPlaceholder} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>{t.password}<input type="password" autoComplete="current-password" placeholder={t.passwordPlaceholder} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="notice error" role="alert">{error}</p>}
          <button className="button auth-submit" type="submit" disabled={busy}>{busy ? t.submitting : t.submit}</button>
        </form>
        <p className="auth-help">{t.help}</p>
      </div>
    </section>
  </main>;
}
