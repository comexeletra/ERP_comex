"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { getMessages, useI18n } from "../../../components/I18nProvider";
import { SearchableSelect } from "../../../components/SearchableSelect";
import { roleLabel } from "../../../lib/i18n/labels";

const roles = ["Administrador", "PCM", "Importação", "Compras", "Fiscal", "Logística", "Gestor", "Consulta"] as const;
type Role = typeof roles[number];
type User = {
  id: string; email: string; displayName: string | null; isActive: boolean;
  role: string | null; importerScopes: string[]; mustChangePassword: boolean;
};

export default function UsersPage() {
  const { m } = useI18n();
  const t = m.users;
  const [isMaster, setIsMaster] = useState<boolean | null>(null);
  const [accessError, setAccessError] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [importers, setImporters] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("Consulta");
  const [scopes, setScopes] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [usersResponse, importersResponse] = await Promise.all([
      apiFetch("/api/v1/admin/users"), apiFetch("/api/v1/admin/importers"),
    ]);
    if (!usersResponse.ok || !importersResponse.ok) throw new Error(getMessages().users.loadFailed);
    setUsers((await usersResponse.json() as { items: User[] }).items);
    setImporters((await importersResponse.json() as { items: string[] }).items);
  }

  useEffect(() => {
    let active = true;
    apiFetch("/auth/me")
      .then(async response => {
        if (!response.ok) throw new Error(getMessages().admin.accessCheckFailed);
        return await response.json() as { roles: string[] };
      })
      .then(identity => { if (active) setIsMaster(identity.roles.includes("Master")); })
      .catch(reason => {
        if (active) setAccessError(reason instanceof Error ? reason.message : getMessages().common.unexpectedError);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (isMaster !== true) return;
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : getMessages().common.unexpectedError));
  }, [isMaster]);

  function resetForm() {
    setEditingId(undefined); setEmail(""); setDisplayName(""); setRole("Consulta"); setScopes([]);
  }

  function edit(user: User) {
    if (user.role === "Master") return;
    setEditingId(user.id); setEmail(user.email); setDisplayName(user.displayName ?? "");
    setRole(roles.find((item) => item === user.role) ?? "Consulta");
    setScopes(user.importerScopes); setTemporaryPassword(""); setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setTemporaryPassword("");
    try {
      const payload = editingId
        ? { displayName, role, importerScopes: scopes }
        : { email, displayName, role, importerScopes: scopes };
      const response = await apiFetch(editingId ? `/api/v1/admin/users/${editingId}` : "/api/v1/admin/users", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? t.saveFailed);
      }
      if (!editingId) setTemporaryPassword((await response.json() as { temporaryPassword: string }).temporaryPassword);
      resetForm();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : m.common.unexpectedError);
    } finally { setBusy(false); }
  }

  async function updateStatus(user: User) {
    setBusy(true); setError(""); setTemporaryPassword("");
    try {
      const response = await apiFetch(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      if (!response.ok) throw new Error(t.statusFailed);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : m.common.unexpectedError); }
    finally { setBusy(false); }
  }

  async function resetPassword(user: User) {
    setBusy(true); setError(""); setTemporaryPassword("");
    try {
      const response = await apiFetch(`/api/v1/admin/users/${user.id}/reset-password`, { method: "POST" });
      if (!response.ok) throw new Error(t.resetFailed);
      setTemporaryPassword((await response.json() as { temporaryPassword: string }).temporaryPassword);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : m.common.unexpectedError); }
    finally { setBusy(false); }
  }

  if (isMaster === null) return <main className="shell">
    <p className={accessError ? "notice error" : "notice"} role={accessError ? "alert" : "status"}>
      {accessError || m.admin.checkingAccess}
    </p>
    {accessError && <Link className="text-link" href="/">{m.admin.backToPortfolio}</Link>}
  </main>;

  if (!isMaster) return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>{t.title}</h1>
      <Link className="text-link" href="/">{t.back}</Link>
    </header>
    <p className="notice">{m.admin.masterOnly}</p>
  </main>;

  return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>{t.title}</h1>
      <p>{t.intro}</p>
      <Link className="text-link" href="/">{t.back}</Link>
    </header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {temporaryPassword && <div className="notice credential-notice" role="status">
      <strong>{t.initialPassword}</strong> <code>{temporaryPassword}</code>
      <p>{t.sendSecurely}</p>
    </div>}
    <section className="card"><h2>{editingId ? t.edit : t.create}</h2>
      <form className="stack-form" onSubmit={(event) => void save(event)}>
        <label>{t.email}<input type="email" value={email} disabled={Boolean(editingId)} required onChange={(event) => setEmail(event.target.value)} /></label>
        <label>{t.name}<input value={displayName} required minLength={2} maxLength={200} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label>{t.role}<SearchableSelect ariaLabel={t.role} placeholder="" value={role} onChange={value => setRole(value as Role)}
          options={roles.map(item => ({ value: item, label: roleLabel(m, item) }))} /></label>
        <fieldset className="scope-list"><legend>{t.allowedImporters}</legend>
          {importers.map((importer) => <label key={importer}><input type="checkbox" checked={scopes.includes(importer)} onChange={(event) => setScopes((old) => event.target.checked ? [...old, importer] : old.filter((item) => item !== importer))} /> {importer}</label>)}
          {importers.length === 0 && <p className="muted">{t.noImporters}</p>}
        </fieldset>
        <div><button className="button" type="submit" disabled={busy}>{editingId ? t.saveChanges : t.createAccess}</button>
          {editingId && <button className="button secondary" type="button" onClick={resetForm}>{t.cancel}</button>}</div>
      </form>
    </section>
    <section className="card"><h2>{t.usersTitle}</h2><table><thead><tr>
      <th>{t.user}</th><th>{t.role}</th><th>{t.importers}</th><th>{t.status}</th><th>{t.actions}</th>
    </tr></thead><tbody>{users.map((user) => <tr key={user.id}>
      <td><strong>{user.displayName ?? user.email}</strong><br /><span className="muted">{user.email}</span></td>
      <td>{user.role ? roleLabel(m, user.role) : null}</td><td>{user.role === "Master" ? t.all : user.importerScopes.join(", ")}</td>
      <td>{user.isActive ? t.active : t.inactive}{user.mustChangePassword && <><br /><span className="muted">{t.passwordPending}</span></>}</td>
      <td>{user.role !== "Master" && <>
        <button className="button secondary" type="button" aria-label={t.editAria(user.displayName ?? user.email)} disabled={busy} onClick={() => edit(user)}>{t.editButton}</button>
        <button className="button secondary" type="button" aria-label={t.toggleAria(!user.isActive, user.displayName ?? user.email)} disabled={busy} onClick={() => void updateStatus(user)}>{user.isActive ? t.deactivate : t.activate}</button>
        <button className="button secondary" type="button" aria-label={t.resetAria(user.displayName ?? user.email)} disabled={busy} onClick={() => void resetPassword(user)}>{t.reset}</button>
      </>}</td>
    </tr>)}</tbody></table></section>
  </main>;
}
