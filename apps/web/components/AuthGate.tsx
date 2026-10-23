"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MouseEvent, ReactNode, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { apiFetch } from "../lib/api";
import { rippleGeometry } from "../lib/theme-ripple";
import AppSidebar from "./AppSidebar";
import { useI18n } from "./I18nProvider";

type Identity = {
  authenticated: boolean;
  user: { displayName: string | null };
  roles: string[];
  importerScopes: string[];
  mustChangePassword: boolean;
};

export default function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { m, messages } = useI18n();
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
        if (!response.ok) throw new Error(messages().auth.sessionCheckFailed);
        setIdentity(await response.json() as Identity);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : messages().common.unexpectedError))
      .finally(() => setLoading(false));
  }, [messages, pathname]);

  useEffect(() => {
    if (!loading && !error && !identity && pathname !== "/login") {
      window.location.replace("/login");
    }
  }, [error, identity, loading, pathname]);

  async function logout() {
    try {
      const response = await apiFetch("/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(m.auth.logoutFailed);
      window.location.assign("/login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : m.common.unexpectedError);
    }
  }

  function toggleSidebar() {
    setSidebarCollapsed(current => {
      const next = !current;
      window.localStorage.setItem("erp-comex-sidebar-collapsed", String(next));
      return next;
    });
  }

  function toggleTheme(event: MouseEvent<HTMLButtonElement>) {
    const nextTheme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const apply = () => {
      flushSync(() => setTheme(nextTheme));
      root.dataset.theme = nextTheme;
    };
    window.localStorage.setItem("erp-comex-theme", nextTheme);
    if (typeof document.startViewTransition !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      apply();
      return;
    }
    const ripple = rippleGeometry(event, event.currentTarget.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
    root.style.setProperty("--ripple-x", `${ripple.x}px`);
    root.style.setProperty("--ripple-y", `${ripple.y}px`);
    root.style.setProperty("--ripple-end", `${ripple.radius}px`);
    root.dataset.themeRipple = "";
    document.startViewTransition(apply).finished.finally(() => {
      delete root.dataset.themeRipple;
      for (const name of ["--ripple-x", "--ripple-y", "--ripple-end"]) root.style.removeProperty(name);
    });
  }

  const layoutClass = sidebarCollapsed ? "app-layout sidebar-collapsed" : "app-layout";
  // Session checks keep the sidebar space, so the page does not jump when the menu appears.
  const pendingFrame = (content: ReactNode) => <div className={layoutClass}>
    <div className={sidebarCollapsed ? "app-sidebar is-collapsed" : "app-sidebar"} aria-hidden="true" />
    <div className="app-main"><main className="shell">{content}</main></div>
  </div>;

  if (pathname === "/login") return <>{children}</>;
  if (loading) return pendingFrame(<p role="status">{m.auth.checkingSession}</p>);
  if (error) return pendingFrame(<><p className="notice error" role="alert">{error}</p><Link className="button" href="/login">{m.auth.signIn}</Link></>);
  if (!identity) return pendingFrame(<p role="status">{m.auth.redirecting}</p>);
  if (identity.mustChangePassword && pathname !== "/change-password") {
    return pendingFrame(<><p className="notice warning">{m.auth.mustChangePassword}</p><Link className="button" href="/change-password">{m.auth.changePassword}</Link></>);
  }

  return <div className={layoutClass}>
    <AppSidebar collapsed={sidebarCollapsed} isMaster={identity.roles.includes("Master")}
      displayName={identity.user.displayName} roles={identity.roles} importerScopes={identity.importerScopes}
      theme={theme} onToggleTheme={toggleTheme} onToggle={toggleSidebar} onLogout={() => void logout()} />
    <div className="app-main">{children}</div>
  </div>;
}
