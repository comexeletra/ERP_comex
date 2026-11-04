"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { multiSelectLabel, multiSelectLimit, selectAllState, toggleValue, toggleVisible } from "../lib/multi-select";
import { filterSearchableOptions, type SearchableOption } from "../lib/searchable-options";
import { useI18n } from "./I18nProvider";

/**
 * List filter in the style of the Power BI slicer: a checkbox per value, a search and "select all", which
 * applies to the results while there is a search. No value checked is no filter, shown as `allLabel`.
 */
export function MultiSelectFilter({ values, options, onChange, ariaLabel, allLabel, searchPlaceholder }: {
  values: string[];
  options: SearchableOption[];
  onChange: (values: string[]) => void;
  ariaLabel: string;
  allLabel: string;
  searchPlaceholder?: string;
}) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const allRef = useRef<HTMLInputElement>(null);
  // A value chosen before (for example from a link) stays in the list even when no option has it now.
  const allOptions: SearchableOption[] = [...values.filter(value => !options.some(option => option.value === value))
    .map(value => ({ value, label: value })), ...options];
  const visible = filterSearchableOptions(allOptions, query);
  const visibleValues = visible.map(option => option.value);
  const allState = selectAllState(values, visibleValues);
  const label = multiSelectLabel(values, allOptions, allLabel, m);

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = allState === "mixed";
  });

  function show() {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (bounds) {
      const width = Math.min(Math.max(bounds.width, 280), 520, window.innerWidth - 16);
      const height = Math.min(380, window.innerHeight - 16);
      const below = bounds.bottom + 4;
      const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, bounds.top - height - 4);
      setPosition({ top, left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)), width });
    }
    setQuery("");
    setOpen(true);
  }
  function close() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnResize = () => setOpen(false);
    const closeOnPageScroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("scroll", closeOnPageScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("scroll", closeOnPageScroll, true);
    };
  }, [open]);

  // Esc closes; the arrows move between the search and the checkboxes, and the space bar checks.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const fields = [...(menuRef.current?.querySelectorAll<HTMLInputElement>("input") ?? [])];
    const index = fields.indexOf(document.activeElement as HTMLInputElement);
    const next = fields[Math.max(0, Math.min(fields.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) { event.preventDefault(); next.focus(); }
  }

  return <div className="multi-select">
    <button type="button" className="multi-select-trigger" ref={triggerRef} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${ariaLabel}: ${label}`} onClick={() => (open ? setOpen(false) : show())}>
      <span>{label}</span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && typeof document !== "undefined" && createPortal(<div className="searchable-select-menu" role="dialog"
      aria-label={ariaLabel} ref={menuRef} onKeyDown={handleKeyDown}
      style={{ top: position.top, left: position.left, width: position.width }}>
      <input aria-label={m.select.searchNamed(ariaLabel)} autoComplete="off" className="searchable-select-search"
        onChange={event => setQuery(event.target.value)} placeholder={searchPlaceholder ?? m.select.searchPlaceholder}
        ref={searchRef} type="search" value={query} />
      <div className="searchable-select-options" role="group" aria-label={ariaLabel}>
        {visible.length > 0 && <label className="multi-select-option multi-select-all">
          <input type="checkbox" ref={allRef} checked={allState === "checked"}
            onChange={() => onChange(toggleVisible(values, visibleValues))} />
          <span>{m.select.selectAll}</span>
        </label>}
        {visible.map(option => <label className="multi-select-option" key={option.value}>
          <input type="checkbox" checked={values.includes(option.value)} onChange={() => onChange(toggleValue(values, option.value))} />
          <span>{option.label}</span>
        </label>)}
        {visible.length === 0 && <p className="searchable-select-empty">{m.select.empty}</p>}
      </div>
      {values.length > multiSelectLimit && values.length < allOptions.length
        && <p className="notice warning" role="status">{m.select.limit(multiSelectLimit)}</p>}
    </div>, document.body)}
  </div>;
}
