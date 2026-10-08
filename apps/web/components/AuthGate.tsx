"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import AppSidebar from "./AppSidebar";

type Identity = {
  authenticated: boolean;
  user: { displayName: string | null };
  roles: string[];
  importerScopes: string[];
  mustChangePassword: boolean;
};

export default function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [identity, setIdentity] = useState<Identity>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem("erp-comex-sidebar-collapsed") === "true");
    const savedTheme = window.localStorage.getItem("erp-comex-theme");
    const nextTheme = savedTheme === "dark" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

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

  useEffect(() => {
    if (!loading && !error && !identity && pathname !== "/login") {
      window.location.replace("/login");
    }
  }, [error, identity, loading, pathname]);

  async function logout() {
    try {
      const response = await apiFetch("/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Não foi possível encerrar a sessão.");
      window.location.assign("/login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro inesperado.");
    }
  }

  function toggleSidebar() {
    setSidebarCollapsed(current => {
      const next = !current;
      window.localStorage.setItem("erp-comex-sidebar-collapsed", String(next));
      return next;
    });
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("erp-comex-theme", nextTheme);
  }

  if (pathname === "/login") return <>{children}</>;
  if (loading) return <main className="shell"><p>Verificando sessão…</p></main>;
  if (error) return <main className="shell"><p className="notice error">{error}</p><Link className="button" href="/login">Entrar</Link></main>;
  if (!identity) return <main className="shell"><p role="status">Redirecionando para o login…</p></main>;
  if (identity.mustChangePassword && pathname !== "/change-password") {
    return <main className="shell"><p className="notice">Troque sua senha inicial para continuar.</p><Link className="button" href="/change-password">Trocar senha</Link></main>;
  }

  return <div className={sidebarCollapsed ? "app-layout sidebar-collapsed" : "app-layout"}>
    <AppSidebar collapsed={sidebarCollapsed} isMaster={identity.roles.includes("Master")}
      displayName={identity.user.displayName} roles={identity.roles} importerScopes={identity.importerScopes}
      theme={theme} onToggleTheme={toggleTheme} onToggle={toggleSidebar} onLogout={() => void logout()} />
    <div className="app-main">

    {children}
    </div>
  </div>;
}
