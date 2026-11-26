"use client";

import { type MouseEvent, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { rippleGeometry } from "../lib/theme-ripple";

export type Theme = "light" | "dark";

const storageKey = "erp-comex-theme";

// Shared by the side menu and the login page: reads the saved theme and switches it with the ripple transition.
export function useThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const nextTheme = window.localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  function toggleTheme(event: MouseEvent<HTMLButtonElement>) {
    const nextTheme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const apply = () => {
      flushSync(() => setTheme(nextTheme));
      root.dataset.theme = nextTheme;
    };
    window.localStorage.setItem(storageKey, nextTheme);
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

  return { theme, toggleTheme };
}
