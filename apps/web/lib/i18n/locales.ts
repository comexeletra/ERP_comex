export const locales = ["pt-BR", "zh-CN", "en"] as const;
export type Locale = typeof locales[number];

export const defaultLocale: Locale = "pt-BR";
export const localeStorageKey = "erp-comex-locale";

/** Names shown in the language selector, each written in its own language. */
export const localeOptions: readonly { locale: Locale; short: string; name: string }[] = [
  { locale: "pt-BR", short: "PT", name: "Português (Brasil)" },
  { locale: "zh-CN", short: "中文", name: "中文（简体）" },
  { locale: "en", short: "EN", name: "English" },
];

export function normalizeLocale(value: unknown): Locale {
  return locales.includes(value as Locale) ? value as Locale : defaultLocale;
}

export function readStoredLocale(storage: Pick<Storage, "getItem">): Locale {
  try {
    return normalizeLocale(storage.getItem(localeStorageKey));
  } catch {
    return defaultLocale;
  }
}

export function storeLocale(storage: Pick<Storage, "setItem">, locale: Locale): void {
  try {
    storage.setItem(localeStorageKey, locale);
  } catch {
    // Private windows may block storage; the choice still applies to this page.
  }
}
