"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { calendarWeeks, dateRangeLabel, dateRangePresets, dateRangeUnits, formatDateRangeDay, includesOpenPeriod, isIsoDate,
  pickCalendarDay, presetOf, relativeOffsetLabel, relativeOffsetLimits, relativeOffsets, sameRange, type DateRangeUnit,
  type DateRangeValue, type RelativeRange } from "../lib/date-range";
import { Icon } from "./E2eFlowParts";
import { useI18n } from "./I18nProvider";

type Mode = "all" | "static" | "relative" | "preset";
const defaultRange: RelativeRange = { unit: "month", from: 0, to: 0 };
const clampRange = (range: RelativeRange, unit: DateRangeUnit): RelativeRange => {
  const limit = relativeOffsetLimits[unit];
  const from = Math.max(-limit, Math.min(limit, range.from));
  return { unit, from, to: Math.max(from, Math.min(limit, range.to)) };
};
const monthOf = (value: string) => ({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) - 1 });

/**
 * Date period filter: a button with the chosen period and a panel with every date, a fixed period on the
 * calendar, a relative period (years to days, back and ahead) and the usual shortcuts. Nothing changes
 * until Apply.
 */
export default function DateRangeFilter({ value, today, ariaLabel, onApply }: {
  value: DateRangeValue; today: string; ariaLabel: string; onApply: (next: DateRangeValue) => void;
}) {
  const { m, locale } = useI18n();
  const t = m.dateRange;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("all");
  const [fixed, setFixed] = useState({ from: "", to: "" });
  const [range, setRange] = useState<RelativeRange>(defaultRange);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [view, setView] = useState(monthOf(today));
  const [position, setPosition] = useState({ top: 0, left: 0, width: 360, maxHeight: 560 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function show() {
    setMode(value.kind === "all" ? "all" : value.kind === "static" ? "static" : presetOf(value.range) ? "preset" : "relative");
    setFixed(value.kind === "static" ? { from: value.from, to: value.to } : { from: "", to: "" });
    setRange(value.kind === "relative" ? value.range : defaultRange);
    setExcludeOpen(value.kind === "relative" && value.excludeOpen);
    setView(monthOf(value.kind === "static" && isIsoDate(value.from) ? value.from : today));
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (bounds) {
      const width = Math.min(380, window.innerWidth - 16);
      const below = window.innerHeight - bounds.bottom - 12;
      const above = bounds.top - 12;
      const placeBelow = below >= 420 || below >= above;
      const maxHeight = Math.max(240, Math.min(620, placeBelow ? below : above));
      setPosition({ width, maxHeight, left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
        top: placeBelow ? bounds.bottom + 4 : Math.max(8, bounds.top - maxHeight - 4) });
    }
    setOpen(true);
  }
  function close() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnResize = () => setOpen(false);
    const closeOnPageScroll = (event: Event) => { if (!panelRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("scroll", closeOnPageScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("scroll", closeOnPageScroll, true);
    };
  }, [open]);

  const pending: DateRangeValue = mode === "all" ? { kind: "all" } : mode === "static" ? { kind: "static", ...fixed }
    : { kind: "relative", range, excludeOpen: excludeOpen && includesOpenPeriod(range) };
  const valid = mode !== "static" || (isIsoDate(fixed.from) && isIsoDate(fixed.to) && fixed.from <= fixed.to);
  const canExclude = (mode === "relative" || mode === "preset") && includesOpenPeriod(range);
  const offsets = relativeOffsets(range.unit);
  const dayFormat = new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "full" });
  const weekdayFormat = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" });
  const monthTitle = new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", year: "numeric" })
    .format(new Date(Date.UTC(view.year, view.month, 1)));
  const weekdays = Array.from({ length: 7 }, (_, index) => weekdayFormat.format(new Date(Date.UTC(2026, 10, 1 + index))));
  const rangeEnd = fixed.to || fixed.from;

  function moveMonth(step: number) {
    const next = new Date(Date.UTC(view.year, view.month + step, 1));
    setView({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  }
  function apply() {
    if (!valid) return;
    onApply(pending);
    close();
  }
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
  }

  const option = (target: Mode, label: string, pressed = mode === target) => <button type="button" className="date-range-option"
    aria-pressed={pressed} onClick={() => setMode(target)}>{label}</button>;

  return <div className="date-range-filter">
    <button type="button" className="date-range-trigger" ref={triggerRef} aria-haspopup="dialog" aria-expanded={open}
      aria-label={t.dialog(ariaLabel)} onClick={() => (open ? setOpen(false) : show())}>
      <span>{dateRangeLabel(m, value, locale)}</span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && typeof document !== "undefined" && createPortal(<div className="date-range-panel" role="dialog" aria-label={ariaLabel}
      tabIndex={-1} ref={panelRef} onKeyDown={handleKeyDown}
      style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}>
      <div className="date-range-body">
        {option("all", t.allTime)}
        {option("static", t.staticPeriod)}
        {mode === "static" && <div className="date-range-editor">
          <div className="date-range-bounds">
            <label>{t.from}<input type="date" value={fixed.from} max={fixed.to || undefined}
              onChange={event => { setFixed({ ...fixed, from: event.target.value });
                if (isIsoDate(event.target.value)) setView(monthOf(event.target.value)); }} /></label>
            <label>{t.to}<input type="date" value={fixed.to} min={fixed.from || undefined}
              onChange={event => { setFixed({ ...fixed, to: event.target.value });
                if (isIsoDate(event.target.value)) setView(monthOf(event.target.value)); }} /></label>
          </div>
          <div className="date-range-calendar">
            <div className="date-range-calendar-head">
              <button type="button" className="date-range-nav" aria-label={t.previousMonth} onClick={() => moveMonth(-1)}>
                <Icon name="prev" size={16} /></button>
              <strong>{monthTitle}</strong>
              <button type="button" className="date-range-nav" aria-label={t.nextMonth} onClick={() => moveMonth(1)}>
                <Icon name="next" size={16} /></button>
            </div>
            <div className="date-range-month">
              {weekdays.map(weekday => <span key={weekday} className="date-range-weekday" aria-hidden="true">{weekday}</span>)}
              {calendarWeeks(view.year, view.month).flat().map(day => {
                const edge = day.date === fixed.from || day.date === fixed.to;
                const inside = Boolean(fixed.from && rangeEnd) && day.date >= fixed.from && day.date <= rangeEnd;
                return <button type="button" key={day.date} aria-pressed={edge}
                  aria-label={dayFormat.format(new Date(`${day.date}T00:00:00Z`))}
                  className={`date-range-day${day.inMonth ? "" : " is-outside"}${inside ? " is-in-range" : ""}${edge ? " is-edge" : ""}${day.date === today ? " is-today" : ""}`}
                  onClick={() => setFixed(pickCalendarDay(fixed, day.date))}>{Number(day.date.slice(8))}</button>;
              })}
            </div>
            {fixed.from && !fixed.to && <p className="date-range-hint">{t.since(formatDateRangeDay(fixed.from, locale))}</p>}
          </div>
        </div>}
        {option("relative", t.relativePeriod)}
        {mode === "relative" && <div className="date-range-editor">
          <div className="tabs date-range-units" role="tablist" aria-label={t.unitsLabel}>
            {dateRangeUnits.map(unit => <button type="button" role="tab" key={unit} aria-selected={unit === range.unit}
              className={unit === range.unit ? "tab active" : "tab"} onClick={() => setRange(clampRange(range, unit))}>
              {t.units[unit]}</button>)}
          </div>
          <div className="date-range-bounds">
            <label>{t.from}<select value={range.from}
              onChange={event => { const from = Number(event.target.value); setRange({ ...range, from, to: Math.max(from, range.to) }); }}>
              {offsets.map(offset => <option key={offset} value={offset}>{relativeOffsetLabel(m, range.unit, offset)}</option>)}
            </select></label>
            <label>{t.to}<select value={range.to} onChange={event => setRange({ ...range, to: Number(event.target.value) })}>
              {offsets.filter(offset => offset >= range.from).map(offset =>
                <option key={offset} value={offset}>{relativeOffsetLabel(m, range.unit, offset)}</option>)}
            </select></label>
          </div>
        </div>}
        {dateRangeUnits.map(unit => <section key={unit} className="date-range-group" aria-label={t.groups[unit]}>
          <h3 className="date-range-group-title">{t.groups[unit]}</h3>
          {dateRangePresets.filter(preset => preset.range.unit === unit).map(preset => <button type="button" key={preset.key}
            className="date-range-option" aria-pressed={mode === "preset" && sameRange(range, preset.range)}
            onClick={() => { setMode("preset"); setRange(preset.range); }}>{t.presets[preset.key]}</button>)}
        </section>)}
      </div>
      <div className="date-range-footer">
        <label className="date-range-exclude"><input type="checkbox" checked={canExclude && excludeOpen} disabled={!canExclude}
          onChange={event => setExcludeOpen(event.target.checked)} />{t.excludeOpen}</label>
        <div className="button-row">
          <button type="button" className="button secondary" onClick={close}>{t.cancel}</button>
          <button type="button" className="button" disabled={!valid} onClick={apply}>{t.apply}</button>
        </div>
      </div>
    </div>, document.body)}
  </div>;
}
