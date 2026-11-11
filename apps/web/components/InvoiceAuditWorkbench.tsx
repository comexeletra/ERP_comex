"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { parseChinaInvoiceXlsx, type ChinaInvoiceDraft } from "../lib/china-invoice-xlsx";
import { classifyInvoiceDestination, distributeInvoiceParts, invoiceAssignmentsFromLines, InvoiceAuditPoint,
  invoiceCatalogCorrections, InvoiceCatalogMissing, InvoiceCatalogPoint, invoiceCatalogPoints, invoiceCodePoint,
  invoiceKeyItems, InvoiceLinePricePoint, invoiceLinePricePoint, InvoicePackingChoice, invoicePackingChoiceReady,
  invoicePackingChoiceWeights, invoicePackingDivergences, InvoicePriceChoice, invoicePriceChoiceReady, invoicePriceTolerancePercent,
  InvoiceQuantityDecision, invoiceQuantityDecisionReady, invoiceQuantityPoint, invoiceSupplierMismatches, InvoiceCountryChoice,
  InvoiceManufacturerCheck, invoiceManufacturerChecks, InvoiceManufacturerEntry, invoiceManufacturerCorrections, invoiceManufacturerCountryPoint,
  invoiceManufacturerId, invoiceManufacturerPending, invoiceOriginCountries } from "../lib/china-invoice-mapping";
import { followUpCandidates, followUpImporters, followUpPoSuggestions, followUpSameIps, parseFollowUpXlsx,
  type FollowUpCandidate, type FollowUpWorkbook } from "../lib/audit-reference-xlsx";
import type { AuditReference } from "../lib/reference-loads";
import { bulkConfirmations, bulkFlags, bulkPriceChoices, bulkSourceChoices, pendingConfirmations, pendingFlags, pendingPrices,
  pendingSources } from "../lib/invoice-bulk-decisions";
import { invoiceChangedCells, invoiceCorrectedTotals, invoiceLineCorrections, invoiceNcmFlagCells,
  writeCorrectedInvoice } from "../lib/invoice-correction-xlsx";
import { formatUsDateTime } from "../lib/date-format";
import { formatDecimal, formatNumber, formatPercentChange } from "../lib/format-number";
import type { Messages } from "../lib/i18n/pt-BR";
import { getMessages, useI18n } from "./I18nProvider";
import FilePickerField from "./FilePickerField";
import InvoiceBulkDecisions, { type BulkGroup } from "./InvoiceBulkDecisions";
import InvoiceConference from "./InvoiceConference";
import InvoiceManufacturerAudit from "./InvoiceManufacturerAudit";
import PageHeader from "./PageHeader";

const allowedRoles = new Set(["Master", "Administrador", "Importação", "Compras"]); // i18n-ignore: role values from the API
const auditSheetName = "AUDITORIA"; // i18n-ignore: sheet name kept in Portuguese, like the INV and PKL sheets
const noDecision: InvoiceQuantityDecision = { confirmed: false, reason: "" };
type LoadedInvoice = { draft: ChinaInvoiceDraft; bytes: ArrayBuffer };

/**
 * Invoice audit against the Follow Up in use (user decision, 2026-11-10): the invoice and the Follow Up are read in
 * the browser, nothing is saved, and the result is the invoice file corrected with the decisions. The DATABASE and
 * the manufacturer list are the rows of their latest load, kept apart from the catalog (stage 1f, 2026-11-11).
 */
export default function InvoiceAuditWorkbench() {
  const { m } = useI18n();
  const t = m.invoiceAudit;
  const [identity, setIdentity] = useState<{ roles: string[]; name: string } | null>(null);
  const [invoice, setInvoice] = useState<LoadedInvoice | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpWorkbook | null>(null);
  const [reference, setReference] = useState<AuditReference | null>(null);
  const [referenceFailed, setReferenceFailed] = useState(false);
  const [missingDecisions, setMissingDecisions] = useState<Record<number, InvoiceQuantityDecision>>({});
  const [flaggedNcms, setFlaggedNcms] = useState<Partial<Record<number, boolean>>>({});
  const [addressChoices, setAddressChoices] = useState<Record<number, string>>({});
  const [countryChoices, setCountryChoices] = useState<Record<number, InvoiceCountryChoice>>({});
  const [manufacturerMissing, setManufacturerMissing] = useState<Record<number, InvoiceQuantityDecision>>({});
  const [pickedManufacturers, setPickedManufacturers] = useState<Record<number, InvoiceManufacturerEntry>>({});
  const [reading, setReading] = useState<"" | "invoice" | "followUp" | "download">("");
  const [error, setError] = useState("");
  const [importerChoice, setImporterChoice] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [quantityDecisions, setQuantityDecisions] = useState<Record<number, InvoiceQuantityDecision>>({});
  const [priceChoices, setPriceChoices] = useState<Record<number, InvoicePriceChoice>>({});
  const [supplierConfirmed, setSupplierConfirmed] = useState<Record<string, boolean>>({});
  const [packingChoices, setPackingChoices] = useState<Record<string, InvoicePackingChoice>>({});
  const [poChoices, setPoChoices] = useState<Record<string, string>>({});

  useEffect(() => {
    apiFetch("/auth/me").then(async response => {
      if (!response.ok) throw new Error(getMessages().common.unexpectedError);
      const user = await response.json() as { roles: string[]; user: { displayName: string | null } };
      setIdentity({ roles: user.roles, name: user.user.displayName ?? "" });
      if (!user.roles.some(role => allowedRoles.has(role))) return;
      const loaded = await apiFetch("/api/v1/reference-loads/audit-reference");
      if (!loaded.ok) { setReferenceFailed(true); return; }
      setReference(await loaded.json() as AuditReference);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError));
  }, []);
  const database = reference?.productDatabase ?? null;
  const manufacturerList = reference?.manufacturerList ?? null;

  function resetDecisions() {
    setQuantities({}); setQuantityDecisions({}); setPriceChoices({}); setSupplierConfirmed({}); setPackingChoices({}); setPoChoices({});
  }

  async function selectInvoice(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    setError(""); setReading("invoice"); setInvoice(null); resetDecisions(); setMissingDecisions({}); setFlaggedNcms({});
    resetManufacturerDecisions();
    try { setInvoice({ draft: await parseChinaInvoiceXlsx(file, getMessages()), bytes: await file.arrayBuffer() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError); }
    finally { setReading(""); }
  }

  async function selectFollowUp(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    setError(""); setReading("followUp"); setFollowUp(null); setImporterChoice(""); resetDecisions();
    try { setFollowUp(await parseFollowUpXlsx(file, getMessages())); }
    catch (cause) { setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError); }
    finally { setReading(""); }
  }

  function resetManufacturerDecisions() {
    setAddressChoices({}); setCountryChoices({}); setManufacturerMissing({}); setPickedManufacturers({});
  }

  const draft = invoice?.draft ?? null;
  const baseParts = draft ? invoiceAssignmentsFromLines(draft.lines) : [];
  const importers = followUp ? followUpImporters(followUp.lines, baseParts.map(part => part.poNumber)) : [];
  const importer = importers.length === 1 ? importers[0] : importers.includes(importerChoice) ? importerChoice : "";
  const ready = Boolean(draft && followUp && importer);
  const parts = ready ? baseParts.map(part => {
    const poNumber = poChoices[part.key] ?? part.poNumber;
    const { poExists, items } = followUpCandidates(followUp!.lines, importer, poNumber, draft!.ipNumber);
    return { ...part, poNumber, invoiceQuantity: part.quantity, quantity: quantities[part.key] ?? part.quantity, poExists,
      keyItems: invoiceKeyItems(items, part.productCode) };
  }) : [];
  const distribution = distributeInvoiceParts(parts.map(part => ({ key: part.key, quantity: part.quantity, items: part.keyItems })));
  const taken = [...distribution.values()].flatMap(entry => entry.allocations);
  const rows = parts.map(part => {
    const line = draft!.lines.find(entry => entry.sourceRow === part.sourceRow)!;
    const decision = quantityDecisions[part.sourceRow] ?? noDecision;
    const partDistribution = distribution.get(part.key);
    const allocations = (partDistribution?.allocations ?? []).flatMap(allocation => {
      const item = part.keyItems.find(candidate => candidate.id === allocation.itemId);
      return item ? [{ item, quantity: allocation.quantity }] : [];
    });
    const points = [invoiceQuantityPoint(part.invoiceQuantity, part.quantity, line.unit, decision),
      invoiceCodePoint(part.productCode, !part.poExists || part.keyItems.length > 0, part.quantity, decision)]
      .filter((point): point is InvoiceAuditPoint => point !== null);
    const issue = classifyInvoiceDestination(part.keyItems, part.poExists, part.quantity, partDistribution);
    const suggestions = issue && issue.kind !== "INVALID_QUANTITY"
      ? followUpPoSuggestions(followUp!.lines, importer, draft!.ipNumber, part.productCode, part.poNumber,
        part.quantity, taken) : [];
    return { part, line, decision, allocations, points, issue, suggestions };
  });
  const allocatedItems = rows.flatMap(row => row.allocations.map(allocation => allocation.item));
  const pricePoints = new Map<number, InvoiceLinePricePoint>();
  for (const line of draft?.lines ?? []) {
    const items = rows.filter(row => row.part.sourceRow === line.sourceRow).flatMap(row => row.allocations.map(entry => entry.item));
    const point = invoiceLinePricePoint(line.unitPrice, items);
    if (point) pricePoints.set(line.sourceRow, point);
  }
  const supplierMismatches = draft ? invoiceSupplierMismatches(draft.exporterText, allocatedItems.map(item => item.supplier)) : [];
  const divergences = draft?.packingList.status === "READ" ? invoicePackingDivergences(draft.lines, draft.packingList.lines) : [];
  const catalog = draft && database ? invoiceCatalogPoints(draft.lines, database.products) : { points: [], missing: [] };
  // An entry the analyst found by typing joins the line's candidates, so it is chosen like a similar one.
  const manufacturerChecks = (draft && manufacturerList ? invoiceManufacturerChecks(draft.lines, manufacturerList.manufacturers) : [])
    .map(check => {
      const picked = pickedManufacturers[check.sourceRow];
      return picked && !check.candidates.some(entry => invoiceManufacturerId(entry) === invoiceManufacturerId(picked))
        ? { ...check, candidates: [...check.candidates, picked] } : check;
    });
  const manufacturerCorrections = draft
    ? invoiceManufacturerCorrections(draft.lines, manufacturerChecks, addressChoices, countryChoices) : {};
  const origin = draft ? invoiceOriginCountries(draft.countryOfOrigin, draft.lines.map(line =>
    manufacturerCorrections[line.sourceRow]?.manufacturerCountry ?? line.manufacturerCountry)) : { missing: [], corrected: null };
  const pending = rows.filter(row => row.issue !== null).length
    + rows.reduce((total, row) => total + row.points.filter(point => point.confirmed === false).length, 0)
    + [...pricePoints].filter(([row, point]) => !invoicePriceChoiceReady(point, priceChoices[row])).length
    + supplierMismatches.filter(supplier => !supplierConfirmed[supplier]).length
    + divergences.filter(divergence => !invoicePackingChoiceReady(divergence, packingChoices[divergence.key])).length
    + catalog.missing.filter(entry => !flaggedNcms[entry.sourceRow]
      && !invoiceQuantityDecisionReady(missingDecisions[entry.sourceRow] ?? noDecision)).length
    + invoiceManufacturerPending(manufacturerChecks, addressChoices, countryChoices, manufacturerMissing);
  const canDownload = ready && pending === 0 && rows.some(row => row.allocations.length > 0);
  const bulkGroups = bulkDecisionGroups();
  const sameIps = ready ? followUpSameIps(followUp!.lines, draft!.ipNumber) : [];

  /** Stage 1g: every kind of point that one decision can settle, with the points still without a decision. */
  function bulkDecisionGroups(): BulkGroup[] {
    const prices = [...pricePoints].map(([row, point]) => [row, point] as const);
    const packingKeys = divergences.map(divergence => divergence.key);
    const quantityRows = [...new Set(rows.filter(row => row.points.some(point => point.confirmed === false))
      .map(row => row.part.sourceRow))];
    // A code out of the PO is settled only by destining 0; confirming alone leaves it pending.
    const quantitySettles = (sourceRow: number) => rows.filter(row => row.part.sourceRow === sourceRow).every(row =>
      !row.points.some(point => point.kind === "CODE")
      || invoiceCodePoint(row.part.productCode, false, row.part.quantity, { confirmed: true, reason: "bulk" })?.confirmed === true);
    const countryRows = manufacturerChecks.filter(check => invoiceManufacturerCountryPoint(check, addressChoices))
      .map(check => check.sourceRow);
    const missingManufacturers = manufacturerChecks.filter(check => check.status === "MISSING"
      && !check.candidates.some(entry => invoiceManufacturerId(entry) === addressChoices[check.sourceRow]))
      .map(check => check.sourceRow);
    // An NCM not found in the DATABASE is kept (confirmation) or flagged; neither action changes the other's points.
    const catalogRows = pendingConfirmations(catalog.missing.map(entry => entry.sourceRow)
      .filter(row => !flaggedNcms[row]), missingDecisions);
    const apply = <T,>(outcome: { next: T; applied: number; left: number }, set: (next: T) => void) => {
      set(outcome.next); return { applied: outcome.applied, left: outcome.left };
    };
    return [
      { id: "price", pending: pendingPrices(prices, priceChoices).length, actions: [
        { id: "acceptPrice", needsReason: false, run: () => apply(bulkPriceChoices(prices, priceChoices, "ACCEPT"), setPriceChoices) },
        { id: "correctPrice", needsReason: false, run: () => apply(bulkPriceChoices(prices, priceChoices, "CORRECT"), setPriceChoices) },
      ] },
      { id: "packing", pending: pendingSources(packingKeys, packingChoices).length, actions: [
        { id: "keepInvoice", needsReason: true, run: reason =>
          apply(bulkSourceChoices(packingKeys, packingChoices, "INVOICE", reason), next => setPackingChoices(next as typeof packingChoices)) },
        { id: "usePacking", needsReason: true, run: reason => apply(bulkSourceChoices(packingKeys, packingChoices, "PACKING", reason,
          key => divergences.some(divergence => divergence.key === key && divergence.invoice && divergence.packing)),
        next => setPackingChoices(next as typeof packingChoices)) },
      ] },
      { id: "quantity", pending: pendingConfirmations(quantityRows, quantityDecisions).length, actions: [
        { id: "confirmQuantity", needsReason: true, run: reason => apply(bulkConfirmations(quantityRows, quantityDecisions, reason,
          quantitySettles), next => setQuantityDecisions(next as typeof quantityDecisions)) },
      ] },
      { id: "supplier", pending: pendingFlags(supplierMismatches, supplierConfirmed).length, actions: [
        { id: "confirmSupplier", needsReason: false, run: () => apply(bulkFlags(supplierMismatches, supplierConfirmed),
          next => setSupplierConfirmed(next as typeof supplierConfirmed)) },
      ] },
      { id: "catalog", pending: catalogRows.length, actions: [
        { id: "confirmCatalog", needsReason: true, run: reason => apply(bulkConfirmations(catalogRows, missingDecisions, reason),
          next => setMissingDecisions(next as typeof missingDecisions)) },
        { id: "flagCatalog", needsReason: false, run: () => apply(bulkFlags(catalogRows, flaggedNcms), setFlaggedNcms) },
      ] },
      { id: "country", pending: pendingSources(countryRows, countryChoices).length, actions: [
        { id: "keepInvoiceCountry", needsReason: true, run: reason => apply(bulkSourceChoices(countryRows, countryChoices, "INVOICE", reason),
          next => setCountryChoices(next as typeof countryChoices)) },
        { id: "useListCountry", needsReason: true, run: reason => apply(bulkSourceChoices(countryRows, countryChoices, "LIST", reason),
          next => setCountryChoices(next as typeof countryChoices)) },
      ] },
      { id: "manufacturer", pending: pendingConfirmations(missingManufacturers, manufacturerMissing).length, actions: [
        { id: "confirmManufacturer", needsReason: true, run: reason => apply(bulkConfirmations(missingManufacturers, manufacturerMissing,
          reason), next => setManufacturerMissing(next as typeof manufacturerMissing)) },
      ] },
    ];
  }

  async function download() {
    if (!invoice || !followUp || !canDownload) return;
    setError(""); setReading("download");
    const messages = getMessages();
    try {
      const prices = Object.fromEntries([...pricePoints].filter(([row]) => priceChoices[row] === "CORRECT")
        .map(([row, point]) => [row, point.poPrices[0]]));
      const referenceCorrections: Record<number, Record<string, string>> = { ...invoiceCatalogCorrections(catalog.points) };
      for (const [row, values] of Object.entries(manufacturerCorrections)) {
        referenceCorrections[Number(row)] = { ...referenceCorrections[Number(row)], ...values };
      }
      const corrections = invoiceLineCorrections(invoice.draft.lines,
        rows.map(row => ({ sourceRow: row.part.sourceRow, poNumber: row.part.poNumber, quantity: row.part.quantity })),
        prices, invoicePackingChoiceWeights(divergences, packingChoices), referenceCorrections);
      const changedCells = invoiceChangedCells(corrections, invoice.draft.layout, invoice.draft.packingList);
      const ncmFlagRows = catalog.missing.filter(entry => flaggedNcms[entry.sourceRow]).map(entry => entry.sourceRow);
      const written = await writeCorrectedInvoice(invoice.bytes, invoice.draft.layout, corrections, invoiceCorrectedTotals(corrections),
        auditSheet(messages, { draft: invoice.draft, followUp, importer, sameIps, rows, pricePoints, priceChoices, supplierMismatches,
          divergences, packingChoices, corrections, changedCells, database, catalogPoints: catalog.points,
          catalogMissing: catalog.missing, missingDecisions, flaggedNcms, manufacturerList, manufacturerChecks, addressChoices,
          countryChoices, manufacturerMissing, origin, user: identity?.name ?? "" }),
        messages.invoiceAudit.noteOriginal, invoice.draft.packingList, origin.corrected,
        { rows: ncmFlagRows, text: messages.invoiceAudit.ncmFlagCell });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([written], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      link.download = `${invoice.draft.fileName.replace(/\.xlsx$/iu, "")} - ${messages.invoiceAudit.fileSuffix}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : messages.common.unexpectedError); }
    finally { setReading(""); }
  }

  const setDecision = (sourceRow: number, change: Partial<InvoiceQuantityDecision>) => setQuantityDecisions(current =>
    ({ ...current, [sourceRow]: { ...(current[sourceRow] ?? noDecision), ...change } }));
  const allowed = identity ? identity.roles.some(role => allowedRoles.has(role)) : false;

  return <main className="shell">
    <PageHeader eyebrow={t.eyebrow} title={t.title}><p>{t.description}</p></PageHeader>
    {error && <p className="notice error" role="alert">{error}</p>}
    {identity && !allowed && <p className="notice warning">{t.noPermission}</p>}
    {allowed && <section className="card invoice-audit-page">
      <div className="operational-fields invoice-audit-files">
        {([[t.invoiceFile, draft?.fileName, selectInvoice], [t.followUpFile, followUp?.fileName, selectFollowUp]] as const)
          .map(([label, fileName, select]) => <FilePickerField key={label} label={label} fileName={fileName ?? null}
            chooseLabel={t.chooseFile} emptyLabel={t.noFileChosen} accept=".xlsx" disabled={Boolean(reading)}
            onSelect={event => void select(event)} />)}
      </div>
      {reading && reading !== "download" && <p role="status">{t.reading}</p>}
      {draft && <p className="notice invoice-summary" role="status">{t.invoiceRead(draft.fileName, draft.lines.length, draft.ipNumber)}</p>}
      {followUp && <p className="muted">{t.followUpRead(followUp.fileName, followUp.lines.length, followUp.cancelled)}</p>}
      {!reference && !referenceFailed && <p role="status">{t.referenceLoading}</p>}
      {referenceFailed && <p className="notice error" role="alert">{t.referenceError}</p>}
      {database && <p className="muted">{t.databaseRead(database.fileName, database.products.length,
        formatUsDateTime(database.loadedAt), database.loadedBy)}</p>}
      {manufacturerList && <p className="muted">{t.manufacturerRead(manufacturerList.fileName,
        manufacturerList.manufacturers.length, formatUsDateTime(manufacturerList.loadedAt), manufacturerList.loadedBy)}</p>}
      {draft && followUp && importers.length === 0 && <p className="notice error" role="alert">{t.noImporter}</p>}
      {draft && followUp && importers.length > 1 && <label className="invoice-audit-importer">{t.importer}
        <select value={importer} onChange={event => { setImporterChoice(event.target.value); resetDecisions(); }}>
          <option value="">{t.chooseImporter}</option>
          {importers.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>}
      {ready && <>
        <p className="muted">{t.importerShown(importer, draft!.importerCnpj || t.notIdentified)}</p>
        <p className="muted">{sameIps.length ? t.sameIps(sameIps.join(", ")) : t.noSameIp}</p>
        {draft!.warnings.map(warning => <p className="notice warning" key={warning}>{warning}</p>)}
        <InvoiceBulkDecisions key={draft!.fileSha256} t={t.bulk} groups={bulkGroups} />
        <InvoiceConference draft={draft!} divergences={divergences} decisions={{}} onDecision={() => undefined}
          valueParts={rows.flatMap(row => row.allocations.map(allocation => ({ quantity: allocation.quantity,
            invoicePrice: row.line.unitPrice, poPrice: allocation.item.unitPrice, poCurrency: allocation.item.currency })))}
          decisionReady={divergence => invoicePackingChoiceReady(divergence, packingChoices[divergence.key])}
          renderDecision={divergence => {
            const choice = packingChoices[divergence.key] ?? { source: null, reason: "" };
            const update = (change: Partial<InvoicePackingChoice>) => setPackingChoices(current =>
              ({ ...current, [divergence.key]: { ...choice, ...change } }));
            return <>
              <fieldset className="invoice-audit-choice"><legend>{t.packingChoice}</legend>
                <label><input type="radio" name={`packing-${divergence.key}`} checked={choice.source === "INVOICE"}
                  onChange={() => update({ source: "INVOICE" })} />{t.keepInvoice}</label>
                {divergence.invoice && divergence.packing && <label><input type="radio" name={`packing-${divergence.key}`}
                  checked={choice.source === "PACKING"} onChange={() => update({ source: "PACKING" })} />{t.usePacking}</label>}
              </fieldset>
              {divergence.fields.includes("quantity") && <p className="invoice-audit-note">{t.packingQuantityNote}</p>}
              <label className="invoice-audit-reason">{m.newRecord.conference.reason}<input required minLength={3} maxLength={1000}
                value={choice.reason} onChange={event => update({ reason: event.target.value })} /></label>
            </>;
          }} />
        {supplierMismatches.map(supplier => <div className="notice warning" key={supplier}>
          <p>{t.supplierMismatch(supplier, draft!.exporterText.split(/\r?\n/u)[0])}</p>
          <label className="invoice-audit-confirm"><input type="checkbox" checked={Boolean(supplierConfirmed[supplier])}
            onChange={event => setSupplierConfirmed(current => ({ ...current, [supplier]: event.target.checked }))} />
            {t.confirmSupplier(supplier)}</label>
        </div>)}
        {!database ? <p className="notice warning">{t.noDatabase}</p> : <CatalogAudit t={t} points={catalog.points}
          missing={catalog.missing} missingDecisions={missingDecisions} flagged={flaggedNcms}
          onMissing={(row, change) => setMissingDecisions(current =>
            ({ ...current, [row]: { ...(current[row] ?? noDecision), ...change } }))}
          onFlag={(row, flag) => setFlaggedNcms(current => ({ ...current, [row]: flag }))} />}
        <InvoiceManufacturerAudit t={t} hasList={Boolean(manufacturerList)} checks={manufacturerChecks}
          corrections={manufacturerCorrections} addressChoices={addressChoices} countryChoices={countryChoices}
          missingDecisions={manufacturerMissing} origin={origin} header={draft!.countryOfOrigin}
          list={manufacturerList?.manufacturers ?? []}
          onAddress={(row, id) => { setAddressChoices(current => ({ ...current, [row]: id }));
            setCountryChoices(current => { const next = { ...current }; delete next[row]; return next; }); }}
          onPick={(row, entry) => { setPickedManufacturers(current => ({ ...current, [row]: entry }));
            setAddressChoices(current => ({ ...current, [row]: invoiceManufacturerId(entry) }));
            setCountryChoices(current => { const next = { ...current }; delete next[row]; return next; }); }}
          onCountry={(row, change) => setCountryChoices(current =>
            ({ ...current, [row]: { ...(current[row] ?? { source: null, reason: "" }), ...change } }))}
          onMissing={(row, change) => setManufacturerMissing(current =>
            ({ ...current, [row]: { ...(current[row] ?? noDecision), ...change } }))} />
        <div className="totvs-import-table-wrap invoice-match-table-wrap"><table className="totvs-import-table invoice-match-table">
          <thead><tr><th>{t.column.line}</th><th>{t.column.product}</th><th>{t.column.quantity}</th><th>{t.column.destination}</th></tr></thead>
          <tbody>{rows.map(({ part, line, decision, allocations, points, issue, suggestions }) => {
            const pricePoint = part.key.endsWith(":0") ? pricePoints.get(part.sourceRow) : undefined;
            const choice = priceChoices[part.sourceRow];
            return <tr key={part.key}>
              <td>{part.sourceRow}<small>{t.invoicePo(part.sourcePoNumber)}</small></td>
              <td>{part.productCode}<small>{part.description}</small></td>
              <td><input aria-label={t.quantityAria(part.sourceRow)} inputMode="decimal" value={part.quantity}
                onChange={event => setQuantities(current => ({ ...current, [part.key]: event.target.value.replace(",", ".") }))} />
                <small>{t.invoiceQuantity(`${formatNumber(part.invoiceQuantity)} ${line.unit}`.trim())}</small></td>
              <td>
                {part.poNumber !== part.sourcePoNumber && <div className="notice success invoice-po-changed" role="status">
                  <p>{t.poChanged(part.sourcePoNumber, part.poNumber)}</p>
                  <button className="button secondary" type="button" onClick={() => setPoChoices(current => {
                    const next = { ...current }; delete next[part.key]; return next; })}>{t.keepInvoicePo(part.sourcePoNumber)}</button>
                </div>}
                {allocations.length > 0 && <ul className="invoice-key-items">{allocations.map(({ item, quantity }) =>
                  <li key={item.id}>{t.takes(item.poNumber, item.lineNumber, formatNumber(quantity),
                    item.unitPrice === null ? "—" : `${formatDecimal(item.unitPrice)} ${item.currency ?? ""}`.trim())}</li>)}</ul>}
                {issue && <div className="notice error" role="alert">
                  <p>{issueText(t, issue, part.productCode)}</p>
                  {issue.kind === "INSUFFICIENT_BALANCE" && <button className="button secondary" type="button"
                    onClick={() => setQuantities(current => ({ ...current, [part.key]: issue.available }))}>
                    {t.useBalance(formatNumber(issue.available))}</button>}
                  {suggestions.length > 0 && <>
                    <p><strong>{t.poSuggestionsTitle}</strong></p>
                    <ul className="invoice-suggestions">{suggestions.map(suggestion => <li key={suggestion.poNumber}>
                      <span>{t.poSuggestion(suggestion.poNumber, `${formatNumber(suggestion.available)} ${line.unit}`.trim(),
                        suggestion.ipNumber, suggestion.sourceRows.join(", "))}</span>
                      <button className="button secondary" type="button"
                        onClick={() => setPoChoices(current => ({ ...current, [part.key]: suggestion.poNumber }))}>
                        {t.usePo(suggestion.poNumber)}</button>
                    </li>)}</ul>
                  </>}
                </div>}
                {(points.length > 0 || pricePoint) && <ul className="invoice-audit-list">
                  {points.map(point => <li key={point.kind} className={`notice ${point.confirmed ? "success" : "error"}`}>
                    <div className="invoice-audit-title"><strong>{m.newRecord.auditKind[point.kind]}</strong></div>
                    <dl className="invoice-audit-values"><dt>{m.newRecord.auditInvoice}</dt><dd>{point.invoiceValue || "—"}</dd>
                      <dt>{t.followUpValue}</dt><dd>{point.poValue || (point.kind === "CODE" ? m.newRecord.codeNotInPo : "—")}</dd></dl>
                    {point.kind === "CODE" && !point.confirmed && <>
                      <p className="invoice-audit-note">{t.codeNeedsZero}</p>
                      <div className="button-row"><button className="button secondary" type="button"
                        onClick={() => setQuantities(current => ({ ...current, [part.key]: "0" }))}>{t.destineZero}</button></div>
                    </>}
                    {point === points[points.length - 1] && <>
                      <label className="invoice-audit-confirm"><input type="checkbox" checked={decision.confirmed}
                        onChange={event => setDecision(part.sourceRow, { confirmed: event.target.checked })} />{m.newRecord.confirmQuantity}</label>
                      <label className="invoice-audit-reason">{m.newRecord.quantityReason}<input required minLength={3} maxLength={1000}
                        value={decision.reason} onChange={event => setDecision(part.sourceRow, { reason: event.target.value })} /></label>
                    </>}
                  </li>)}
                  {pricePoint && <li className={`notice ${invoicePriceChoiceReady(pricePoint, choice) ? "success" : "error"}`}>
                    <div className="invoice-audit-title"><strong>{m.newRecord.auditKind.PRICE}</strong></div>
                    <dl className="invoice-audit-values"><dt>{m.newRecord.auditInvoice}</dt><dd>{`${formatDecimal(pricePoint.invoicePrice)} CNY`}</dd>
                      <dt>{t.followUpValue}</dt><dd>{pricePoint.poPrices.map(price => `${formatDecimal(price)} CNY`).join(" · ")}</dd>
                      {pricePoint.difference && <><dt>{m.newRecord.auditDifference}</dt><dd>{m.newRecord.priceDifference(
                        pricePoint.difference.percent === null ? null : formatPercentChange(pricePoint.difference.percent),
                        pricePoint.difference.withinTolerance, invoicePriceTolerancePercent)}</dd></>}</dl>
                    {!pricePoint.correctable && <p className="invoice-audit-note">{t.priceSeveral}</p>}
                    <fieldset className="invoice-audit-choice"><legend>{t.priceChoice}</legend>
                      <label><input type="radio" name={`price-${part.sourceRow}`} checked={choice === "ACCEPT"}
                        onChange={() => setPriceChoices(current => ({ ...current, [part.sourceRow]: "ACCEPT" }))} />{t.acceptPrice}</label>
                      {pricePoint.correctable && <label><input type="radio" name={`price-${part.sourceRow}`} checked={choice === "CORRECT"}
                        onChange={() => setPriceChoices(current => ({ ...current, [part.sourceRow]: "CORRECT" }))} />
                        {t.correctPrice(formatDecimal(pricePoint.poPrices[0]))}</label>}
                    </fieldset>
                  </li>}
                </ul>}
              </td>
            </tr>;
          })}</tbody>
        </table></div>
        <p className={`notice ${pending ? "warning" : "success"}`} role="status">{pending ? t.pending(pending) : t.ready}</p>
        <div className="totvs-import-actions"><button className="button" type="button" disabled={!canDownload || Boolean(reading)}
          onClick={() => void download()}>{reading === "download" ? t.downloading : t.download}</button></div>
      </>}
    </section>}
  </main>;
}

function issueText(t: Messages["invoiceAudit"], issue: NonNullable<ReturnType<typeof classifyInvoiceDestination>>, code: string): string {
  if (issue.kind === "INSUFFICIENT_BALANCE") return t.insufficient(formatNumber(issue.requested), formatNumber(issue.available));
  if (issue.kind === "ITEM_NOT_FOUND") return t.codeNotFound(code);
  if (issue.kind === "INVALID_QUANTITY") return t.invalidQuantity;
  return t.poNotFound;
}

/**
 * NCM and description against the DATABASE, which rules without question (user decision, 2026-11-10): every
 * divergence is corrected in the file and only listed here. An NCM not found in the DATABASE (product out of it or
 * without NCM there) keeps the invoice NCM with a confirmation, or is flagged in the file (user decision, 2026-11-11).
 */
function CatalogAudit({ t, points, missing, missingDecisions, flagged: flaggedRows, onMissing, onFlag }: {
  t: Messages["invoiceAudit"]; points: readonly InvoiceCatalogPoint[]; missing: readonly InvoiceCatalogMissing[];
  missingDecisions: Readonly<Record<number, InvoiceQuantityDecision>>; flagged: Readonly<Partial<Record<number, boolean>>>;
  onMissing: (row: number, change: Partial<InvoiceQuantityDecision>) => void; onFlag: (row: number, flag: boolean) => void;
}) {
  const flagged = missing.filter(entry => flaggedRows[entry.sourceRow]);
  return <section className="notice invoice-catalog" aria-label={t.catalogTitle}>
    <h3>{t.catalogTitle}</h3>
    <p>{t.catalogSummary(points.filter(point => point.field === "ncm").length,
      points.filter(point => point.field === "description").length, missing.length)}</p>
    {points.length > 0 && <details><summary>{t.catalogDetails(points.length)}</summary>
      <div className="totvs-import-table-wrap"><table className="totvs-import-table invoice-catalog-table">
        <thead><tr><th scope="col">{t.catalogColumn.line}</th><th scope="col">{t.catalogColumn.field}</th>
          <th scope="col">{t.catalogColumn.invoice}</th><th scope="col">{t.catalogColumn.database}</th></tr></thead>
        <tbody>{points.map(point => <tr key={point.key}>
          <td>{point.sourceRow}<small>{t.lineProduct(point.lineNumber, point.productCode)}</small></td>
          <td>{t.catalogField[point.field]}{point.caseOnly && <small>{t.caseOnly}</small>}</td>
          <td>{point.invoiceValue || "—"}</td><td>{point.databaseValue}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
    {flagged.length > 0 && <p className="notice warning" role="status">{t.ncmFlagNotice}</p>}
    {missing.length > 0 && <ul className="invoice-audit-list">{missing.map(entry => {
      const decision = missingDecisions[entry.sourceRow] ?? noDecision;
      const isFlagged = Boolean(flaggedRows[entry.sourceRow]);
      return <li key={entry.sourceRow}
        className={`notice ${isFlagged || invoiceQuantityDecisionReady(decision) ? "success" : "error"}`}>
        <p>{entry.reason === "NO_NCM" ? t.noNcmInDatabase(entry.sourceRow, entry.lineNumber, entry.productCode)
          : t.notInDatabase(entry.sourceRow, entry.lineNumber, entry.productCode)}</p>
        {isFlagged ? <>
          <p className="invoice-audit-note">{t.ncmFlaggedNote}</p>
          <div className="button-row"><button className="button secondary" type="button"
            onClick={() => onFlag(entry.sourceRow, false)}>{t.undoFlagNcm}</button></div>
        </> : <>
          <label className="invoice-audit-confirm"><input type="checkbox" checked={decision.confirmed}
            onChange={event => onMissing(entry.sourceRow, { confirmed: event.target.checked })} />{t.confirmNotInDatabase}</label>
          <label className="invoice-audit-reason">{t.reason}<input required minLength={3} maxLength={1000} value={decision.reason}
            onChange={event => onMissing(entry.sourceRow, { reason: event.target.value })} /></label>
          <div className="button-row"><button className="button secondary" type="button"
            onClick={() => onFlag(entry.sourceRow, true)}>{t.flagNcm}</button></div>
        </>}
      </li>;
    })}</ul>}
  </section>;
}

type AuditInput = {
  draft: ChinaInvoiceDraft; followUp: FollowUpWorkbook; importer: string; sameIps: string[]; user: string;
  rows: { part: { key: string; sourceRow: number; productCode: string; invoiceQuantity: string; quantity: string; poNumber: string;
    sourcePoNumber: string };
    line: { lineNumber: string; unit: string }; decision: InvoiceQuantityDecision; points: InvoiceAuditPoint[];
    allocations: { item: FollowUpCandidate; quantity: string }[] }[];
  pricePoints: Map<number, InvoiceLinePricePoint>; priceChoices: Record<number, InvoicePriceChoice>;
  supplierMismatches: string[]; divergences: ReturnType<typeof invoicePackingDivergences>;
  packingChoices: Record<string, InvoicePackingChoice>; corrections: ReturnType<typeof invoiceLineCorrections>;
  changedCells: ReturnType<typeof invoiceChangedCells>; database: AuditReference["productDatabase"];
  catalogPoints: InvoiceCatalogPoint[];
  catalogMissing: InvoiceCatalogMissing[]; missingDecisions: Record<number, InvoiceQuantityDecision>;
  flaggedNcms: Partial<Record<number, boolean>>;
  manufacturerList: AuditReference["manufacturerList"]; manufacturerChecks: InvoiceManufacturerCheck[];
  addressChoices: Record<number, string>; countryChoices: Record<number, InvoiceCountryChoice>;
  manufacturerMissing: Record<number, InvoiceQuantityDecision>; origin: { missing: string[]; corrected: string | null };
};

/** The AUDITORIA sheet: the files used and, per invoice line, each point with its decision and the changed cells. */
function auditSheet(m: Messages, input: AuditInput) {
  const s = m.invoiceAudit.sheet;
  const { draft } = input;
  const lineNumber = (row: number | null) => draft.lines.find(line => line.sourceRow === row)?.lineNumber ?? "";
  const cells = (row: number, fields: readonly string[]) => (input.changedCells[row] ?? [])
    .filter(entry => fields.includes(entry.field)).map(entry => entry.cell).join(", ");
  const rows: string[][] = [];
  for (const { part, line, decision, points, allocations } of input.rows) {
    if (part.poNumber !== part.sourcePoNumber) {
      rows.push([String(part.sourceRow), line.lineNumber, s.poChanged, `PO ${part.sourcePoNumber}`, `PO ${part.poNumber}`,
        s.tookSuggestedPo, "", cells(part.sourceRow, ["poCell"])]);
    }
    rows.push([String(part.sourceRow), line.lineNumber, s.destination, `PO ${part.poNumber} · ${part.productCode}`,
      allocations.map(({ item, quantity }) => s.destinationValue(item.lineNumber, formatNumber(quantity))).join("; ") || "—",
      s.destined(formatNumber(part.quantity)), "", part.key.endsWith(":0") ? cells(part.sourceRow, ["quantity", "poCell", "amount"]) : ""]);
    for (const point of points) {
      rows.push([String(part.sourceRow), line.lineNumber, m.newRecord.auditKind[point.kind], point.invoiceValue, point.poValue || "—",
        s.confirmed, decision.reason.trim(), ""]);
    }
  }
  for (const [row, point] of input.pricePoints) {
    rows.push([String(row), lineNumber(row), m.newRecord.auditKind.PRICE, `${point.invoicePrice} CNY`,
      point.poPrices.map(price => `${price} CNY`).join(" · ") + (point.difference?.percent != null
        ? ` (${formatPercentChange(point.difference.percent)})` : ""),
      input.priceChoices[row] === "CORRECT" ? s.corrected : s.accepted, "", cells(row, ["unitPrice"])]);
  }
  for (const point of input.catalogPoints) {
    rows.push([String(point.sourceRow), point.lineNumber, m.invoiceAudit.catalogField[point.field], point.invoiceValue,
      point.databaseValue, s.tookDatabase, "",
      cells(point.sourceRow, [point.field])]);
  }
  for (const entry of input.catalogMissing) {
    const flagged = Boolean(input.flaggedNcms[entry.sourceRow]);
    rows.push([String(entry.sourceRow), entry.lineNumber, entry.reason === "NO_NCM" ? s.noNcmInDatabase : s.notInDatabase,
      entry.productCode, "—", flagged ? s.ncmFlagged : s.confirmed,
      flagged ? "" : input.missingDecisions[entry.sourceRow]?.reason.trim() ?? "",
      flagged ? invoiceNcmFlagCells(draft.layout, entry.sourceRow).join(", ") : ""]);
  }
  for (const check of input.manufacturerChecks) {
    const row = String(check.sourceRow);
    const correction = input.corrections.find(entry => entry.sourceRow === check.sourceRow);
    const chosen = check.candidates.find(entry => invoiceManufacturerId(entry) === input.addressChoices[check.sourceRow]);
    if (check.status === "MISSING" && !chosen) {
      rows.push([row, check.lineNumber, s.notInList, check.invoice.name, "—", s.confirmed,
        input.manufacturerMissing[check.sourceRow]?.reason.trim() ?? "", ""]);
      continue;
    }
    for (const field of ["manufacturer", "manufacturerAddress"] as const) {
      if (!correction?.changed.includes(field)) continue;
      rows.push([row, check.lineNumber, m.invoiceAudit.manufacturerField[field], correction.original[field],
        correction.corrected[field], chosen ? (check.status === "MISSING" ? s.chosenManufacturer(chosen.code || "—")
          : s.chosenAddress(chosen.code || "—")) : check.status === "NAME" ? s.listByName : s.listValue,
        "", cells(check.sourceRow, [field])]);
    }
    const listCountry = invoiceManufacturerCountryPoint(check, input.addressChoices);
    if (listCountry) {
      const choice = input.countryChoices[check.sourceRow];
      rows.push([row, check.lineNumber, s.manufacturerCountry, check.invoice.country, listCountry,
        choice?.source === "LIST" ? s.tookListCountry : s.keptInvoiceCountry, choice?.reason.trim() ?? "",
        cells(check.sourceRow, ["manufacturerCountry"])]);
    }
  }
  for (const correction of input.corrections) {
    const listCountry = input.manufacturerChecks.some(check => check.sourceRow === correction.sourceRow
      && invoiceManufacturerCountryPoint(check, input.addressChoices));
    if (correction.changed.includes("manufacturerCountry") && !listCountry) {
      rows.push([String(correction.sourceRow), correction.lineNumber, s.manufacturerCountry, correction.original.manufacturerCountry,
        correction.corrected.manufacturerCountry, s.capitals, "", cells(correction.sourceRow, ["manufacturerCountry"])]);
    }
  }
  if (input.origin.corrected) {
    rows.push(["—", "", s.originCountry, draft.countryOfOrigin, input.origin.corrected, s.originAdded(input.origin.missing.join(", ")), "",
      "COUNTRY OF ORIGIN"]); // i18n-ignore: invoice header label
  }
  for (const supplier of input.supplierMismatches) {
    rows.push(["—", "", m.newRecord.auditKind.SUPPLIER, draft.exporterText.split(/\r?\n/u)[0], supplier, s.confirmed, "", ""]);
  }
  for (const divergence of input.divergences) {
    const choice = input.packingChoices[divergence.key];
    const values = (side: typeof divergence.invoice) => side
      ? divergence.fields.map(field => `${m.newRecord.conference.field[field]} ${side[field]}`).join("; ") : "—";
    rows.push([divergence.invoiceRow === null ? "—" : String(divergence.invoiceRow), divergence.lineNumber, s.packing,
      values(divergence.invoice), values(divergence.packing), choice?.source === "PACKING" ? s.tookPacking : s.keptInvoice,
      choice?.reason.trim() ?? "", divergence.invoiceRow === null ? "" : cells(divergence.invoiceRow, ["netWeightKg", "grossWeightKg"])]);
  }
  for (const correction of input.corrections) {
    if (!correction.destined) rows.push([String(correction.sourceRow), lineNumber(correction.sourceRow), s.notDestined, "", "", s.keptAsCame, "", ""]);
    else if (correction.changed.includes("quantity")) {
      rows.push([String(correction.sourceRow), lineNumber(correction.sourceRow), s.notice, "", "", s.weightsNotRecalculated, "", ""]);
    }
  }
  rows.sort((left, right) => (Number(left[0]) || Number.MAX_SAFE_INTEGER) - (Number(right[0]) || Number.MAX_SAFE_INTEGER));
  return { sheetName: auditSheetName, columns: s.columns, rows, summary: [
    [s.invoice, `${draft.fileName} (SHA-256 ${draft.fileSha256})`], [s.followUp, `${input.followUp.fileName} (SHA-256 ${input.followUp.fileSha256})`],
    [s.database, input.database ? s.referenceLoad(input.database.fileName, input.database.fileSha256,
      formatUsDateTime(input.database.loadedAt), input.database.loadedBy) : s.noDatabase],
    [s.manufacturerList, input.manufacturerList ? s.referenceLoad(input.manufacturerList.fileName,
      input.manufacturerList.fileSha256, formatUsDateTime(input.manufacturerList.loadedAt), input.manufacturerList.loadedBy)
      : s.noManufacturerList],
    [s.ipRef, draft.ipNumber], [s.sameIps, input.sameIps.join(", ") || "—"], [s.importer, input.importer],
    [s.date, new Date().toISOString()], [s.user, input.user], [s.note, s.noteText],
  ] as [string, string][] };
}
