"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { useI18n } from "../../components/I18nProvider";
import LanguageSwitcher from "../../components/LanguageSwitcher";
import { Tooltip } from "../../components/Tooltip";
import { useThemeToggle } from "../../components/useThemeToggle";

export default function LoginPage() {
  const { m } = useI18n();
  const t = m.login;
  const { theme, toggleTheme } = useThemeToggle();
  const themeLabel = theme === "dark" ? m.theme.lightAria : m.theme.darkAria;
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
        <div className="auth-toolbar">
          <LanguageSwitcher className="auth-language" />
          <Tooltip content={themeLabel}>
            <button className="auth-theme-toggle" type="button" onClick={toggleTheme} aria-label={themeLabel} aria-pressed={theme === "dark"}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {theme === "dark"
                  ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>
                  : <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z" />}
              </svg>
            </button>
          </Tooltip>
        </div>
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
