"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { en } from "../lib/i18n/en";
import { defaultLocale, Locale, localeStorageKey, readStoredLocale, storeLocale } from "../lib/i18n/locales";
import { Messages, ptBR } from "../lib/i18n/pt-BR";
import { zhCN } from "../lib/i18n/zh-CN";

export const dictionaries: Record<Locale, Messages> = { "pt-BR": ptBR, "zh-CN": zhCN, en };

/**
 * `m` is the dictionary for rendering. `messages` is a stable getter for effects and
 * async callbacks, so changing the language does not re-run data loading.
 */
type I18nValue = { locale: Locale; m: Messages; messages: () => Messages; setLocale: (locale: Locale) => void };

const I18nContext = createContext<I18nValue>({
  locale: defaultLocale, m: ptBR, messages: () => ptBR, setLocale: () => undefined,
});

const listeners = new Set<() => void>();
// Keeps the choice for this page when the browser blocks storage.
let chosenLocale: Locale | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== localeStorageKey) return;
    chosenLocale = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const currentLocale = () => chosenLocale ?? readStoredLocale(window.localStorage);
const serverLocale = () => defaultLocale;
const currentMessages = () => typeof window === "undefined" ? ptBR : dictionaries[currentLocale()];

export default function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, currentLocale, serverLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    chosenLocale = next;
    storeLocale(window.localStorage, next);
    listeners.forEach(listener => listener());
  }, []);

  const value = useMemo(() => ({ locale, m: dictionaries[locale], messages: currentMessages, setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
