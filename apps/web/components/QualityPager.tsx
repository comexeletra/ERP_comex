"use client";

import { useI18n } from "./I18nProvider";

/** Previous and next page of a quality list. */
export default function QualityPager({ page, pageSize, total, onPage }: {
  page: number; pageSize: number; total: number; onPage: (page: number) => void;
}) {
  const { m } = useI18n();
  const t = m.quality;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return <nav className="quality-pager" aria-label={t.pageOf(page, pages)}>
    <button className="button secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t.previous}</button>
    <span>{t.pageOf(page, pages)}</span>
    <button className="button secondary" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t.next}</button>
  </nav>;
}
