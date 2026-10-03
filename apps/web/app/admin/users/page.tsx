"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

const roles = ["Administrador", "Importação", "Compras", "Fiscal", "Logística", "Gestor", "Consulta"] as const;
type Role = typeof roles[number];
type User = {
  id: string; email: string; displayName: string | null; isActive: boolean;
  role: string | null; importerScopes: string[]; mustChangePassword: boolean;
};

export default function UsersPage() {
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
    if (!usersResponse.ok || !importersResponse.ok) throw new Error("Não foi possível carregar os acessos.");
    setUsers((await usersResponse.json() as { items: User[] }).items);
    setImporters((await importersResponse.json() as { items: string[] }).items);
  }

  useEffect(() => {
    let active = true;
    apiFetch("/auth/me")
      .then(async response => {
        if (!response.ok) throw new Error("Não foi possível verificar seu acesso.");
        return await response.json() as { roles: string[] };
      })
      .then(identity => { if (active) setIsMaster(identity.roles.includes("Master")); })
      .catch(reason => {
        if (active) setAccessError(reason instanceof Error ? reason.message : "Erro inesperado.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (isMaster !== true) return;
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Erro inesperado."));
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
        throw new Error(data.error ?? "Não foi possível salvar o usuário.");
      }
      if (!editingId) setTemporaryPassword((await response.json() as { temporaryPassword: string }).temporaryPassword);
      resetForm();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro inesperado.");
    } finally { setBusy(false); }
  }

  async function updateStatus(user: User) {
    setBusy(true); setError(""); setTemporaryPassword("");
    try {
      const response = await apiFetch(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      if (!response.ok) throw new Error("Não foi possível alterar o acesso.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro inesperado."); }
    finally { setBusy(false); }
  }

  async function resetPassword(user: User) {
    setBusy(true); setError(""); setTemporaryPassword("");
    try {
      const response = await apiFetch(`/api/v1/admin/users/${user.id}/reset-password`, { method: "POST" });
      if (!response.ok) throw new Error("Não foi possível redefinir a senha.");
      setTemporaryPassword((await response.json() as { temporaryPassword: string }).temporaryPassword);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro inesperado."); }
    finally { setBusy(false); }
  }

  if (isMaster === null) return <main className="shell">
    <p className={accessError ? "notice error" : "notice"} role={accessError ? "alert" : "status"}>
      {accessError || "Verificando acesso..."}
    </p>
    {accessError && <Link className="text-link" href="/">Voltar à carteira</Link>}
  </main>;

  if (!isMaster) return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Gerenciar acessos</h1>
      <Link className="text-link" href="/">← Voltar à carteira</Link>
    </header>
    <p className="notice">Esta área é restrita a usuários Master. Entre em contato com o administrador do sistema.</p>
  </main>;

  return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Gerenciar acessos</h1>
      <p>Os usuários têm acesso apenas às importadoras e permissões atribuídas aqui.</p>
      <Link className="text-link" href="/">← Voltar à carteira</Link>
    </header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {temporaryPassword && <div className="notice credential-notice" role="status">
      <strong>Senha inicial, exibida apenas agora:</strong> <code>{temporaryPassword}</code>
      <p>Envie-a ao usuário por um canal seguro. Ele deverá trocá-la no primeiro acesso.</p>
    </div>}
    <section className="card"><h2>{editingId ? "Editar usuário" : "Criar usuário"}</h2>
      <form className="stack-form" onSubmit={(event) => void save(event)}>
        <label>E-mail<input type="email" value={email} disabled={Boolean(editingId)} required onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Nome<input value={displayName} required minLength={2} maxLength={200} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label>Papel<select value={role} onChange={(event) => setRole(event.target.value as Role)}>
          {roles.map((item) => <option key={item} value={item}>{item}</option>)}
        </select></label>
        <fieldset className="scope-list"><legend>Importadoras permitidas</legend>
          {importers.map((importer) => <label key={importer}><input type="checkbox" checked={scopes.includes(importer)} onChange={(event) => setScopes((old) => event.target.checked ? [...old, importer] : old.filter((item) => item !== importer))} /> {importer}</label>)}
          {importers.length === 0 && <p className="muted">Nenhuma importadora encontrada nos dados TOTVS. Você pode criar o usuário agora e atribuir escopos após importar os dados; até lá, ele não verá POs.</p>}
        </fieldset>
        <div><button className="button" type="submit" disabled={busy}>{editingId ? "Salvar alterações" : "Criar acesso"}</button>
          {editingId && <button className="button secondary" type="button" onClick={resetForm}>Cancelar</button>}</div>
      </form>
    </section>
    <section className="card"><h2>Usuários</h2><table><thead><tr>
      <th>Usuário</th><th>Papel</th><th>Importadoras</th><th>Status</th><th>Ações</th>
    </tr></thead><tbody>{users.map((user) => <tr key={user.id}>
      <td><strong>{user.displayName ?? user.email}</strong><br /><span className="muted">{user.email}</span></td>
      <td>{user.role}</td><td>{user.role === "Master" ? "Todas" : user.importerScopes.join(", ")}</td>
      <td>{user.isActive ? "Ativo" : "Inativo"}{user.mustChangePassword && <><br /><span className="muted">Troca de senha pendente</span></>}</td>
      <td>{user.role !== "Master" && <>
        <button className="button secondary" disabled={busy} onClick={() => edit(user)}>Editar</button>
        <button className="button secondary" disabled={busy} onClick={() => void updateStatus(user)}>{user.isActive ? "Desativar" : "Ativar"}</button>
        <button className="button secondary" disabled={busy} onClick={() => void resetPassword(user)}>Redefinir senha</button>
      </>}</td>
    </tr>)}</tbody></table></section>
  </main>;
}
