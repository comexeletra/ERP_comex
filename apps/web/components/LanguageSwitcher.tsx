"use client";

import { localeOptions } from "../lib/i18n/locales";
import { useI18n } from "./I18nProvider";
import { Tooltip } from "./Tooltip";

export default function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, m, setLocale } = useI18n();
  return <div className={className ? `language-switcher ${className}` : "language-switcher"} role="group" aria-label={m.language.label}>
    {localeOptions.map(option => <Tooltip key={option.locale} content={option.name}>
      <button type="button" lang={option.locale} className={option.locale === locale ? "language-option active" : "language-option"}
        aria-pressed={option.locale === locale} aria-label={m.language.choose(option.name)}
        onClick={() => setLocale(option.locale)}>{option.short}</button>
    </Tooltip>)}
  </div>;
}
