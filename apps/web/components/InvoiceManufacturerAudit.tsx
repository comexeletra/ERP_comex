"use client";

import { invoiceManufacturerCountryPoint, invoiceManufacturerId, InvoiceCountryChoice, InvoiceManufacturerCheck,
  InvoiceQuantityDecision, invoiceQuantityDecisionReady } from "../lib/china-invoice-mapping";
import type { Messages } from "../lib/i18n/pt-BR";

type ManufacturerCorrections = Record<number, Partial<Record<"manufacturer" | "manufacturerAddress" | "manufacturerCountry", string>>>;
const noDecision: InvoiceQuantityDecision = { confirmed: false, reason: "" };
const reasonReady = (reason: string) => reason.trim().length >= 3;

/**
 * Manufacturer against the manufacturer list (user decisions, 2026-11-10): the list address and name are applied and
 * only listed; the analyst chooses the address of a name with several, decides a country that differs from the list
 * and confirms a manufacturer out of it. The header country of origin gets the missing countries.
 */
export default function InvoiceManufacturerAudit({ t, hasList, checks, corrections, addressChoices, countryChoices,
  missingDecisions, origin, header, onAddress, onCountry, onMissing }: {
  t: Messages["invoiceAudit"]; hasList: boolean; checks: readonly InvoiceManufacturerCheck[]; corrections: ManufacturerCorrections;
  addressChoices: Readonly<Record<number, string>>; countryChoices: Readonly<Record<number, InvoiceCountryChoice>>;
  missingDecisions: Readonly<Record<number, InvoiceQuantityDecision>>; origin: { missing: string[]; corrected: string | null };
  header: string; onAddress: (row: number, id: string) => void;
  onCountry: (row: number, change: Partial<InvoiceCountryChoice>) => void;
  onMissing: (row: number, change: Partial<InvoiceQuantityDecision>) => void;
}) {
  const applied = checks.flatMap(check => (["manufacturer", "manufacturerAddress"] as const)
    .filter(field => corrections[check.sourceRow]?.[field] !== undefined && check.entry)
    .map(field => ({ check, field, value: corrections[check.sourceRow]![field]! })));
  const countryPoints = checks.flatMap(check => {
    const country = invoiceManufacturerCountryPoint(check, addressChoices);
    return country ? [{ check, country }] : [];
  });
  const choices = checks.filter(check => check.status === "CHOICE");
  const missing = checks.filter(check => check.status === "MISSING");
  return <section className="notice invoice-catalog" aria-label={t.manufacturerTitle}>
    <h3>{t.manufacturerTitle}</h3>
    {hasList ? <p>{t.manufacturerSummary(applied.length, choices.length, countryPoints.length, missing.length)}</p>
      : <p>{t.noManufacturerList}</p>}
    {origin.corrected && <p>{t.originCorrected(header || "—", origin.corrected)}</p>}
    {applied.length > 0 && <details><summary>{t.manufacturerDetails(applied.length)}</summary>
      <div className="totvs-import-table-wrap"><table className="totvs-import-table invoice-catalog-table">
        <thead><tr><th scope="col">{t.catalogColumn.line}</th><th scope="col">{t.catalogColumn.field}</th>
          <th scope="col">{t.catalogColumn.invoice}</th><th scope="col">{t.manufacturerListColumn}</th></tr></thead>
        <tbody>{applied.map(({ check, field, value }) => <tr key={`${check.sourceRow}:${field}`}>
          <td>{check.sourceRow}<small>{check.status === "NAME" ? t.foundByName : t.foundByAddress}</small></td>
          <td>{t.manufacturerField[field]}</td>
          <td>{field === "manufacturer" ? check.invoice.name : check.invoice.address || "—"}</td><td>{value}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
    {(choices.length > 0 || countryPoints.length > 0 || missing.length > 0) && <ul className="invoice-audit-list">
      {choices.map(check => <li key={`choice-${check.sourceRow}`}
        className={`notice ${addressChoices[check.sourceRow] ? "success" : "error"}`}>
        <p>{t.addressChoiceText(check.sourceRow, check.invoice.name, check.invoice.address || "—")}</p>
        <fieldset className="invoice-audit-choice invoice-manufacturer-candidates"><legend>{t.addressChoice}</legend>
          {check.candidates.map(entry => <label key={invoiceManufacturerId(entry)}><input type="radio"
            name={`address-${check.sourceRow}`} checked={addressChoices[check.sourceRow] === invoiceManufacturerId(entry)}
            onChange={() => onAddress(check.sourceRow, invoiceManufacturerId(entry))} />
            {t.candidate(entry.address, entry.country || "—", entry.code || "—")}</label>)}
        </fieldset>
      </li>)}
      {countryPoints.map(({ check, country }) => {
        const choice = countryChoices[check.sourceRow] ?? { source: null, reason: "" };
        return <li key={`country-${check.sourceRow}`} className={`notice ${choice.source && reasonReady(choice.reason) ? "success" : "error"}`}>
          <p>{t.countryDiffers(check.sourceRow, check.invoice.country || "—", country)}</p>
          <fieldset className="invoice-audit-choice"><legend>{t.countryChoice}</legend>
            <label><input type="radio" name={`country-${check.sourceRow}`} checked={choice.source === "INVOICE"}
              onChange={() => onCountry(check.sourceRow, { source: "INVOICE" })} />{t.keepInvoiceCountry}</label>
            <label><input type="radio" name={`country-${check.sourceRow}`} checked={choice.source === "LIST"}
              onChange={() => onCountry(check.sourceRow, { source: "LIST" })} />{t.useListCountry(country.toLocaleUpperCase("pt-BR"))}</label>
          </fieldset>
          <label className="invoice-audit-reason">{t.reason}<input required minLength={3} maxLength={1000} value={choice.reason}
            onChange={event => onCountry(check.sourceRow, { reason: event.target.value })} /></label>
        </li>;
      })}
      {missing.map(check => {
        const decision = missingDecisions[check.sourceRow] ?? noDecision;
        return <li key={`missing-${check.sourceRow}`} className={`notice ${invoiceQuantityDecisionReady(decision) ? "success" : "error"}`}>
          <p>{t.notInList(check.sourceRow, check.invoice.name || "—")}</p>
          <label className="invoice-audit-confirm"><input type="checkbox" checked={decision.confirmed}
            onChange={event => onMissing(check.sourceRow, { confirmed: event.target.checked })} />{t.confirmNotInList}</label>
          <label className="invoice-audit-reason">{t.reason}<input required minLength={3} maxLength={1000} value={decision.reason}
            onChange={event => onMissing(check.sourceRow, { reason: event.target.value })} /></label>
        </li>;
      })}
    </ul>}
  </section>;
}
