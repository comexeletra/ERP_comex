"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { filterSearchableOptions, type SearchableOption } from "../lib/searchable-options";

export function SearchableSelect({
  value,
  options,
  onChange,
  required = false,
  disabled = false,
  placeholder = "Selecione",
  searchPlaceholder = "Digite para buscar",
  emptyMessage = "Nenhuma opção encontrada.",
  ariaLabel,
}: {
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = `searchable-options-${useId().replaceAll(":", "")}`;
  const selected = options.find(option => option.value === value);
  const fallback = value && !selected ? { value, label: `${value} (valor atual)` } : undefined;
  const allOptions: SearchableOption[] = [
    ...(placeholder ? [{ value: "", label: placeholder }] : []),
    ...(fallback ? [fallback] : []),
    ...options,
  ];
  const filtered = filterSearchableOptions(allOptions, query);
  const activeOption = filtered.filter(option => !option.disabled)[activeIndex];

  function showMenu() {
    if (disabled) return;
    const bounds = pickerRef.current?.getBoundingClientRect();
    if (bounds) {
      const width = Math.min(Math.max(bounds.width, 280), 520, window.innerWidth - 16);
      const height = Math.min(320, window.innerHeight - 16);
      const below = bounds.bottom + 4;
      const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, bounds.top - height - 4);
      setPosition({ top, left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)), width });
    }
    setQuery("");
    setActiveIndex(Math.max(0, allOptions.filter(option => !option.disabled).findIndex(option => option.value === value)));
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function choose(option: SearchableOption) {
    if (option.disabled) return;
    onChange(option.value);
    closeMenu();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !value ? "Selecione uma opção." : "");
  }, [required, value]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const closeOnResize = () => closeMenu();
    const closeOnPageScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("scroll", closeOnPageScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("scroll", closeOnPageScroll, true);
    };
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) showMenu();
      else setActiveIndex(index => Math.min(index + 1, Math.max(0, filtered.filter(option => !option.disabled).length - 1)));
    } else if (event.key === "ArrowUp" && open) {
      event.preventDefault();
      setActiveIndex(index => Math.max(0, index - 1));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (activeOption) choose(activeOption);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu();
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  const activeOptionId = activeOption ? `${listId}-option-${filtered.indexOf(activeOption)}` : undefined;
  return <div className="searchable-select" ref={pickerRef}>
    <input aria-activedescendant={open ? activeOptionId : undefined} aria-autocomplete="list" aria-controls={listId}
      aria-expanded={open} aria-haspopup="listbox" aria-label={ariaLabel} aria-required={required} autoComplete="off"
      className="searchable-select-trigger" disabled={disabled} required={required} onChange={event => {
        if (!open) showMenu();
        setQuery(event.target.value); setActiveIndex(0);
        if (value) onChange("");
      }} onClick={() => { if (!open) showMenu(); }}
      onKeyDown={handleKeyDown} placeholder={placeholder} ref={inputRef} role="combobox" type="text"
      value={selected?.label ?? fallback?.label.replace(" (valor atual)", "") ?? ""} />
    {open && typeof document !== "undefined" && createPortal(<div className="searchable-select-menu" ref={menuRef}
      style={{ top: position.top, left: position.left, width: position.width }}>
      <input aria-activedescendant={activeOptionId} aria-autocomplete="list" aria-controls={listId}
        aria-expanded="true" aria-haspopup="listbox"
        aria-label={ariaLabel ? `Buscar ${ariaLabel.toLocaleLowerCase("pt-BR")}` : "Buscar opção"} autoComplete="off"
        className="searchable-select-search" onChange={event => {
          setQuery(event.target.value); setActiveIndex(0);
          if (value) onChange("");
        }}
        onKeyDown={handleKeyDown} placeholder={searchPlaceholder} ref={searchRef} role="combobox" value={query} />
      <div className="searchable-select-options" id={listId} role="listbox">
        {filtered.map((option, index) => <button aria-disabled={option.disabled || undefined}
          aria-selected={option.value === value} className="searchable-select-option" id={`${listId}-option-${index}`}
          key={`${option.value}:${option.label}`} onClick={() => choose(option)} role="option" type="button">
          {option.label}
        </button>)}
        {filtered.length === 0 && <p className="searchable-select-empty">{emptyMessage}</p>}
      </div>
    </div>, document.body)}
  </div>;
}
