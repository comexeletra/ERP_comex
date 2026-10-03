"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type Identity = {
  authenticated: boolean;
  user: { displayName: string | null };
  roles: string[];
  mustChangePassword: boolean;
};

export default function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [identity, setIdentity] = useState<Identity>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (pathname === "/login") {
      setLoading(false);
      return;
    }
    apiFetch("/auth/me")
      .then(async (response) => {
        if (response.status === 401) return;
        if (!response.ok) throw new Error("Não foi possível verificar a sessão.");
        setIdentity(await response.json() as Identity);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Erro inesperado."))
      .finally(() => setLoading(false));
  }, [pathname]);

  async function logout() {
    try {
      const response = await apiFetch("/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Não foi possível encerrar a sessão.");
      window.location.assign("/login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro inesperado.");
    }
  }

  if (pathname === "/login") return <>{children}</>;
  if (loading) return <main className="shell"><p>Verificando sessão…</p></main>;
  if (error) return <main className="shell"><p className="notice error">{error}</p><Link className="button" href="/login">Entrar</Link></main>;
  if (!identity) return <main className="shell"><header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Acesso ao portal</h1><p>Entre com sua conta para consultar as POs e a fila de qualidade.</p><Link className="button" href="/login">Entrar</Link></header></main>;
  if (identity.mustChangePassword && pathname !== "/change-password") {
    return <main className="shell"><p className="notice">Troque sua senha inicial para continuar.</p><Link className="button" href="/change-password">Trocar senha</Link></main>;
  }

  return <>
    <div className="session-bar">
      <span>{identity.user.displayName ?? "Usuário autenticado"}</span>
      {identity.roles.includes("Master") && <Link className="text-link" href="/admin/users">Gerenciar acessos</Link>}
      {identity.roles.includes("Master") && <Link className="text-link" href="/admin/outbox">Fila de eventos</Link>}
      <Link className="text-link" href="/change-password">Trocar senha</Link>
      <button className="button secondary" type="button" onClick={() => void logout()}>Sair</button>
    </div>
    {children}
  </>;
}
