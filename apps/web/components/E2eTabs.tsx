"use client";

import Link from "next/link";
import { useI18n } from "./I18nProvider";

const sections = [
  { key: "lines", href: "/end-to-end" }, { key: "po", href: "/end-to-end/po" },
  { key: "model", href: "/end-to-end/model" }, { key: "targets", href: "/end-to-end/targets" },
] as const;

/** Navigation between the End to End screens. */
export default function E2eTabs({ current }: { current: typeof sections[number]["key"] }) {
  const { m } = useI18n();
  return <nav className="tabs" aria-label={m.e2eTabs.label}>
    {sections.map(section => <Link key={section.key} href={section.href} className={section.key === current ? "tab active" : "tab"}
      aria-current={section.key === current ? "page" : undefined}>{m.e2eTabs[section.key]}</Link>)}
  </nav>;
}
