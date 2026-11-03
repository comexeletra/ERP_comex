"use client";

import { useState } from "react";
import { useI18n } from "../../components/I18nProvider";
import PageHeader from "../../components/PageHeader";
import QualityCurrentRules from "../../components/QualityCurrentRules";
import QualityLoadQueue from "../../components/QualityLoadQueue";

export default function QualityPage() {
  const { m } = useI18n();
  const t = m.quality;
  const [tab, setTab] = useState<"current" | "load">("current");
  return <main className="shell">
    <PageHeader eyebrow={t.eyebrow} title={t.title} />
    <nav className="tabs" aria-label={t.tabs.label}>
      {(["current", "load"] as const).map(key => <button key={key} type="button" className={tab === key ? "tab active" : "tab"}
        aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>{t.tabs[key]}</button>)}
    </nav>
    {tab === "current" ? <QualityCurrentRules /> : <QualityLoadQueue />}
  </main>;
}
