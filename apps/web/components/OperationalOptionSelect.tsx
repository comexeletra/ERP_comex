"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../lib/api";
import type { ProductPriceReference } from "../lib/product-price-reference";
import { getMessages, useI18n } from "./I18nProvider";
import { SearchableSelect } from "./SearchableSelect";

export type OperationalOption = { entity: string; value: string; shortName?: string | null };
export type OperationalCatalog = { items: OperationalOption[]; purchaseOrderGroup: boolean };

export async function loadOperationalCatalog(): Promise<OperationalCatalog> {
  const response = await apiFetch("/api/v1/operational-values", { cache: "no-store" });
  if (!response.ok) throw new Error(getMessages().catalogLoad.operationalValues);
  const result = await response.json() as { items: OperationalOption[]; capabilities?: { purchaseOrderGroup?: boolean } };
  return { items: result.items, purchaseOrderGroup: result.capabilities?.purchaseOrderGroup === true };
}

export function OperationalOptionSelect({ entity, value, values, onChange, required = false }:
  { entity: string; value: string; values: OperationalOption[]; onChange: (value: string) => void; required?: boolean }) {
  const { m } = useI18n();
  const options = values.filter(option => option.entity === entity);
  return <SearchableSelect required={required} value={value} onChange={onChange}
    ariaLabel={(m.entityValues.entities as Record<string, string>)[entity] ?? entity}
    options={options.map(option => ({ value: option.value,
      label: entity === "importer" ? option.shortName || option.value : option.value }))} />;
}

export async function loadOperationalOptions(): Promise<OperationalOption[]> {
  const response = await apiFetch("/api/v1/operational-values", { cache: "no-store" });
  if (!response.ok) throw new Error(getMessages().catalogLoad.fieldOptions);
  return (await response.json() as { items: OperationalOption[] }).items;
}

export type CatalogChoice = { code: string; name: string; status?: string; ncmCode?: string | null;
  latestTotvsDescription?: string | null; referencePrices?: ProductPriceReference[] };

export function CatalogProductSelect({ value, fallbackName, products, onChange, required = false }:
  { value: string; fallbackName?: string; products: CatalogChoice[]; onChange: (product: CatalogChoice | null) => void; required?: boolean }) {
  const { m } = useI18n();
  const t = m.productPicker;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });
  const pickerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = products.find(product => product.code === value);
  const label = selected?.name ?? fallbackName ?? value;
  const filtered = products.filter(product => `${product.code} ${product.name}`.toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase()));

  function showMenu() {
    const bounds = pickerRef.current?.getBoundingClientRect();
    if (bounds) {
      const width = Math.min(Math.max(bounds.width, 320), 520, window.innerWidth - 16);
      const height = Math.min(300, window.innerHeight - 16);
      const below = bounds.bottom + 4;
      const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, bounds.top - height - 4);
      setPosition({ top, left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)), width });
    }
    setOpen(true);
    setQuery("");
  }

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const closeOnResize = () => setOpen(false);
    const closeOnPageScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("scroll", closeOnPageScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("scroll", closeOnPageScroll, true);
    };
  }, [open]);

  return <div className="catalog-product-picker" ref={pickerRef}>
    <input aria-haspopup="listbox" aria-expanded={open} aria-label={t.product} aria-required={required} autoComplete="off"
      className="catalog-product-trigger" onClick={showMenu}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "Enter") { event.preventDefault(); showMenu(); }
        if (event.key === "Escape") setOpen(false); }} placeholder={t.placeholder} readOnly
      value={label} />
    {open && createPortal(<div className="catalog-product-menu" ref={menuRef} style={{ top: position.top, left: position.left, width: position.width }}>
      <input autoFocus aria-label={t.search} className="catalog-product-search" onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}
        placeholder={t.searchPlaceholder} value={query} />
      <div aria-label={t.products} className="catalog-product-options" role="listbox">
        {!value && <button className="catalog-product-option" onClick={() => { onChange(null); setOpen(false); }} role="option" type="button">
          {t.placeholder}
        </button>}
        {value && !selected && <button className="catalog-product-option" onClick={() => { onChange({ code: value, name: label }); setOpen(false); }}
          role="option" type="button">{m.select.currentValue(label)}</button>}
        {filtered.map(product => <button aria-selected={product.code === value} className="catalog-product-option" key={product.code}
          onClick={() => { onChange(product); setOpen(false); }} role="option" title={`${product.code} · ${product.name}`} type="button">
          {product.name}
        </button>)}
        {filtered.length === 0 && <p className="catalog-product-empty">{t.empty}</p>}
      </div>
    </div>, document.body)}
  </div>;
}

export async function loadCatalogChoices(kind: "products" | "suppliers", importer: string): Promise<CatalogChoice[]> {
  const query = new URLSearchParams({ importer });
  const response = await apiFetch(`/api/v1/${kind}/options?${query}`);
  if (!response.ok) throw new Error(getMessages().catalogLoad.choices);
  const result = await response.json() as { items: CatalogChoice[] };
  return result.items.filter(item => item.status === "ACTIVE" || item.status === "HISTORICAL_CANDIDATE");
}
