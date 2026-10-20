"use client";

import Link from "next/link";
import { FormEvent, Fragment, useEffect, useRef, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { automaticAuditReason } from "../lib/audit";
import { matchesPurchaseOrderNumber } from "../lib/portfolio-query";
import { formatNumber } from "../lib/format-number";
import ProcessPostShipmentPanel from "./ProcessPostShipmentPanel";
import { loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";

type Cost = { id: string; type: string; currency: string; amount: string; status: string; sourceSheetName: string; sourceRowNumber: number; sourceColumn: string };
type Order = { id: string; number: string; importer: string; linkSource: string };
type PurchaseOrderChoice = { id: string; number: string; importer: string };
type CancellationDestination = { type: "IDLE" } | { type: "EXISTING"; processId: string } | { type: "NEW"; ipNumber: string };
type PurchaseOrderItemChoice = { id: string; lineNumber: number; productCode: string; description: string;
  orderedQuantity: string; remainingQuantity: string; unit: string | null; sourceStatus: string | null };
type OperationalAllocation = { id: string; poId: string; poNumber: string; productCode: string; quantity: string;
  unit: string; poItemRemainingQuantity?: string };
type Process = { id: string; ipNumber: string; importer: string; supplierEntryId?: string | null; supplierText: string | null; supplierName?: string | null; logisticsStatus: string | null;
  qualityStatus: string; sourceKind: string; priority: string | null; notes: string;
  version: string; lifecycleStatus?: "OPEN" | "CLOSED"; recordStatus?: "DRAFT" | "ACTIVE" | "CANCELLED"; closedAt: string | null;
  closedBy: string | null; closeReason: string | null;
  processDocumentCount?: number;
  purchaseOrders: Order[]; historicalCosts: Cost[];
  operationalAllocations: OperationalAllocation[] };
type Line = { id: string; sourceSheetName: string; sourceRowNumber: number; sourceValues: Record<string, unknown>; sourceColumnHeaders: Record<string, string>; purchaseOrderId: string | null; poNumber: string | null; productCode: string | null; productDescription: string | null; quantityFromSource: string | null; legacyStatus: string | null };
type LinePage = { page: number; pageSize: number; totalCount: number; items: Line[] };
type ImporterChoice = { code: string };

function quantityUnits(value: string): bigint | null {
  const match = /^(\d+)(?:[.,](\d{0,8}))?$/u.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? "").padEnd(8, "0") || "0");
}
function formatQuantityUnits(units: bigint) {
  const roundedHundredths = (units + 500_000n) / 1_000_000n;
  const whole = (roundedHundredths / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
  const fraction = (roundedHundredths % 100n).toString().padStart(2, "0");
  return `${whole},${fraction}`;
}

export default function ProcessWorkspace({ id, returnPath }: { id: string; returnPath: string }) {
  const [process, setProcess] = useState<Process>();
  const [lines, setLines] = useState<LinePage>();
  const [expandedLineId, setExpandedLineId] = useState<string>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [compatibilityWarning, setCompatibilityWarning] = useState("");
  const [saveError, setSaveError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);
  const [ipNumberDraft, setIpNumberDraft] = useState("");
  const [importerDraft, setImporterDraft] = useState("");
  const [logisticsStatusDraft, setLogisticsStatusDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [importers, setImporters] = useState<ImporterChoice[]>([]);
  const [operationalOptions, setOperationalOptions] = useState<OperationalOption[]>([]);
  const [poQuery, setPoQuery] = useState("");
  const [poOptions, setPoOptions] = useState<PurchaseOrderChoice[]>([]);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [poItems, setPoItems] = useState<PurchaseOrderItemChoice[]>([]);
  const [selectedPoItemId, setSelectedPoItemId] = useState("");
  const [allocationQuantity, setAllocationQuantity] = useState("");
  const [poSearchMessage, setPoSearchMessage] = useState("");
  const [searchingPos, setSearchingPos] = useState(false);
  const poSearchTimer = useRef<number | undefined>(undefined);
  const poSearchRequest = useRef(0);
  const [linkingPo, setLinkingPo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancellationRoutes, setCancellationRoutes] = useState<Record<string, CancellationDestination>>({});
  const [destinationIps, setDestinationIps] = useState<Array<{ id: string; ipNumber: string; recordStatus?: string }>>([]);
  const [notice, setNotice] = useState("");
  async function readSavedProcess(): Promise<Process> {
    const response = await apiFetch(`/api/v1/processes/${id}`, { cache: "no-store" });
    if (!response.ok) throw new Error("O IP foi alterado, mas não foi possível conferir os dados salvos.");
    return response.json() as Promise<Process>;
  }
  async function readPurchaseOrderState(poId: string) {
    const response = await apiFetch(`/api/v1/purchase-orders/${poId}/operational`, { cache: "no-store" });
    return readApiJson<{ items: PurchaseOrderItemChoice[]; allocations: { itemId: string; processId: string }[] }>(response);
  }
  async function choosePurchaseOrder(poId: string, searchRequestId?: number) {
    setSelectedPoId(poId); setSelectedPoItemId(""); setAllocationQuantity("");
    setPoItems([]); setSaveError(undefined); setPoSearchMessage("");
    if (!poId) return;
    setSearchingPos(true);
    try {
      const state = await readPurchaseOrderState(poId);
      if (searchRequestId !== undefined && searchRequestId !== poSearchRequest.current) return;
      const activeItemIdsForThisIp = new Set(state.allocations.filter(item => item.processId === id).map(item => item.itemId));
      const available = state.items.filter(item => (quantityUnits(item.remainingQuantity) ?? 0n) > 0n
        && !activeItemIdsForThisIp.has(item.id)
        && !["CANCELLED", "CANCELED"].includes(String(item.sourceStatus ?? "").toUpperCase()));
      setPoItems(available);
      setSelectedPoItemId(available[0]?.id ?? "");
      setPoSearchMessage(available.length
        ? `${available.length} item(ns) com saldo disponível nesta PO.`
        : "Esta PO não tem itens com saldo disponível para distribuir a este IP.");
    } catch (cause) {
      if (searchRequestId === undefined || searchRequestId === poSearchRequest.current) {
        setSaveError(cause instanceof Error ? cause.message : "Não foi possível carregar os itens e saldos da PO.");
      }
    } finally {
      if (searchRequestId === undefined || searchRequestId === poSearchRequest.current) setSearchingPos(false);
    }
  }
  async function searchPurchaseOrders(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process) return;
    const requestId = ++poSearchRequest.current;
    setSearchingPos(true); setSaveError(undefined); setPoSearchMessage("");
    try {
      const query = new URLSearchParams({ importer: process.importer, number: poQuery, pageSize: "200" });
      const response = await apiFetch(`/api/v1/purchase-orders?${query}`);
      const result = await readApiJson<{ items: PurchaseOrderChoice[] }>(response);
      if (requestId !== poSearchRequest.current) return;
      const matches = result.items.filter(order => order.importer === process.importer
        && matchesPurchaseOrderNumber(order.number, poQuery));
      setPoOptions(matches);
      const exactMatches = matches.filter(order => order.number.trim().toLocaleLowerCase()
        === poQuery.trim().toLocaleLowerCase());
      if (exactMatches.length === 1) {
        await choosePurchaseOrder(exactMatches[0].id, requestId);
        if (requestId !== poSearchRequest.current) return;
        setPoSearchMessage("");
      } else {
        if (!matches.some(order => order.id === selectedPoId)) {
          setSelectedPoId(""); setSelectedPoItemId(""); setPoItems([]);
        }
        setPoSearchMessage(matches.length === 0
          ? `Nenhuma PO encontrada para a importadora ${process.importer}. Confira o número e o importador.`
          : "");
      }
    } catch (cause) {
      if (requestId === poSearchRequest.current) setSaveError(cause instanceof Error ? cause.message : "Não foi possível buscar POs.");
    } finally { if (requestId === poSearchRequest.current) setSearchingPos(false); }
  }
  async function distributeItemToProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process || !selectedPoId || !selectedPoItemId) return;
    setLinkingPo(true); setSaveError(undefined); setPoSearchMessage("");
    try {
      const quantity = quantityUnits(allocationQuantity);
      const selectedItem = poItems.find(item => item.id === selectedPoItemId);
      const remaining = selectedItem ? quantityUnits(selectedItem.remainingQuantity) : null;
      if (quantity === null || quantity <= 0n || remaining === null || quantity > remaining) {
        throw new Error("Informe uma quantidade válida, maior que zero e dentro do saldo disponível da PO.");
      }
      const response = await apiFetch(`/api/v1/purchase-orders/${selectedPoId}/allocations`, { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ itemId: selectedPoItemId, processId: id, quantity: allocationQuantity,
          notes: "", reason: automaticAuditReason }) });
      await readApiJson<{ id: string }>(response);
      const [savedProcess, savedPo] = await Promise.all([readSavedProcess(), readPurchaseOrderState(selectedPoId)]);
      if (!savedProcess.purchaseOrders.some(order => order.id === selectedPoId)
        || !savedPo.allocations.some(allocation => allocation.itemId === selectedPoItemId && allocation.processId === id)) {
        throw new Error("A API confirmou a distribuição, mas a releitura não encontrou o vínculo e a quantidade no IP.");
      }
      setProcess(savedProcess); setPoItems(savedPo.items.filter(item => (quantityUnits(item.remainingQuantity) ?? 0n) > 0n
        && !savedPo.allocations.some(allocation => allocation.itemId === item.id && allocation.processId === id)
        && !["CANCELLED", "CANCELED"].includes(String(item.sourceStatus ?? "").toUpperCase())));
      setAllocationQuantity("");
      setSelectedPoItemId("");
      setPoSearchMessage("Quantidade distribuída. O saldo atualizado da PO foi carregado; selecione outro item se necessário.");
      setNotice("Item e quantidade distribuídos para este IP.");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Não foi possível distribuir a quantidade para este IP.");
    } finally { setLinkingPo(false); }
  }
  const selectedPoItem = poItems.find(item => item.id === selectedPoItemId);
  const remainingUnits = selectedPoItem ? quantityUnits(selectedPoItem.remainingQuantity) : null;
  const allocationUnits = quantityUnits(allocationQuantity);
  const remainingAfterAllocation = remainingUnits !== null && allocationUnits !== null
    && allocationUnits > 0n && allocationUnits <= remainingUnits
    ? formatQuantityUnits(remainingUnits - allocationUnits) : null;
  useEffect(() => {
    loadOperationalOptions().then(setOperationalOptions).catch(() => undefined);
    apiFetch("/api/v1/importers", { cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      setImporters((await response.json() as { items: ImporterChoice[] }).items);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(undefined);
    Promise.all([
      apiFetch(`/api/v1/processes/${id}`, { signal: controller.signal }),
      apiFetch(`/api/v1/processes/${id}/items?page=${page}&pageSize=50`, { signal: controller.signal }),
      apiFetch("/auth/me", { signal: controller.signal }),
    ]).then(async ([detail, items, identity]) => {
      if (detail.status === 401 || items.status === 401 || identity.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
      if (detail.status === 403 || items.status === 403) throw new Error("Seu acesso não permite consultar este IP.");
      if (detail.status === 404 || items.status === 404) throw new Error("IP não encontrado ou fora do seu escopo.");
      if (!detail.ok || !items.ok || !identity.ok) throw new Error("Não foi possível carregar o IP.");
      const [processValue, lineValue, user] = await Promise.all([detail.json() as Promise<Process>, items.json() as Promise<LinePage>, identity.json() as Promise<{ roles: string[] }>]);
      const destinationQuery = new URLSearchParams({ importer: processValue.importer, page: "1", pageSize: "200" });
      const destinationResponse = await apiFetch(`/api/v1/processes?${destinationQuery}`, { signal: controller.signal });
      const destinations = destinationResponse.ok
        ? (await destinationResponse.json() as { items: Array<{ id: string; ipNumber: string; importer: string;
          recordStatus?: string; lifecycleStatus?: string }> }).items
        : [];
      if (!controller.signal.aborted) {
        setCompatibilityWarning(processValue.lifecycleStatus === "OPEN" || processValue.lifecycleStatus === "CLOSED"
          ? "" : "A API do IP está desatualizada. O ciclo e as ações de edição ficarão indisponíveis até sua atualização.");
        setProcess(processValue); setLines(lineValue); setRoles(user.roles);
        setDestinationIps(destinations.filter(value => value.id !== processValue.id && value.importer === processValue.importer
          && value.lifecycleStatus !== "CLOSED" && value.recordStatus !== "CANCELLED"));
        setCancellationRoutes(Object.fromEntries(processValue.purchaseOrders.map(order => [order.id, { type: "IDLE" as const }])));
        setIpNumberDraft(processValue.ipNumber);
        setImporterDraft(processValue.importer);
        setLogisticsStatusDraft(processValue.logisticsStatus ?? "");
        setPriorityDraft(processValue.priority ?? "");
        setNotesDraft(processValue.notes);
      }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, page, retry]);

  async function saveProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process) return;
    setSaving(true); setSaveError(undefined); setNotice("");
    try {
      const importerChanged = importerDraft !== process.importer;
      const response = await apiFetch(`/api/v1/processes/${id}`, { method: "PATCH",
        headers: { "content-type": "application/json", "X-Record-Version": process.version },
        body: JSON.stringify({ ipNumber: ipNumberDraft, ...(importerChanged ? { importer: importerDraft } : {}),
          logisticsStatus: logisticsStatusDraft || null, priority: priorityDraft || null,
          notes: notesDraft, reason: automaticAuditReason }) });
      const body = await response.json() as { detail?: string };
      if (!response.ok) {
        if (importerChanged && response.status === 400 && body.detail === "Revise o IP.") {
          throw new Error("A API deste ambiente ainda não oferece alteração de importadora. Os dados não foram salvos; solicite a atualização da API de homologação.");
        }
        throw new Error(body.detail || "Não foi possível atualizar o IP.");
      }
      const saved = await readSavedProcess();
      if (saved.ipNumber !== ipNumberDraft || saved.importer !== importerDraft
        || saved.logisticsStatus !== (logisticsStatusDraft || null) || saved.priority !== (priorityDraft || null)
        || saved.notes !== notesDraft) {
        throw new Error("A API confirmou a alteração, mas os dados do IP não apareceram na releitura.");
      }
      setNotice("IP atualizado."); setRetry(value => value + 1);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setSaving(false); }
  }
  async function cancelProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process) return;
    setCancelling(true); setSaveError(undefined); setNotice("");
    try {
      const purchaseOrders = process.purchaseOrders.map(order => {
        const destination = cancellationRoutes[order.id] ?? { type: "IDLE" as const };
        if (destination.type === "EXISTING") return { purchaseOrderId: order.id, destinationType: "EXISTING" as const, processId: destination.processId };
        if (destination.type === "NEW") return { purchaseOrderId: order.id, destinationType: "NEW" as const, ipNumber: destination.ipNumber.trim() };
        return { purchaseOrderId: order.id, destinationType: "IDLE" as const };
      });
      if (purchaseOrders.some(item => item.destinationType === "NEW" && !item.ipNumber)) throw new Error("Informe o IP REF para cada novo destino.");
      if (purchaseOrders.some(item => item.destinationType === "EXISTING" && !item.processId)) throw new Error("Selecione um IP para cada PO encaminhada.");
      const response = await apiFetch("/api/v1/processes/" + id + "/cancel", { method: "POST",
        headers: { "content-type": "application/json", "X-Record-Version": process.version },
        body: JSON.stringify({ reason: automaticAuditReason, purchaseOrders }) });
      const result = await readApiJson<{ status: string; createdDraftIps: number; releasedAllocations: number }>(response);
      if ((await readSavedProcess()).recordStatus !== "CANCELLED") throw new Error("O IP nao aparece como cancelado na releitura.");
      const routeSummary = purchaseOrders.map(route => {
        const order = process.purchaseOrders.find(item => item.id === route.purchaseOrderId);
        const destination = route.destinationType === "IDLE" ? "sem vinculo"
          : route.destinationType === "EXISTING" ? destinationIps.find(item => item.id === route.processId)?.ipNumber ?? "IP existente"
            : route.ipNumber;
        return "PO " + (order?.number ?? route.purchaseOrderId) + " -> " + destination;
      }).join("; ");
      setNotice("IP cancelado. " + result.releasedAllocations + " distribuicao(oes) liberada(s); "
        + result.createdDraftIps + " novo(s) IP(s) aguardando invoice. " + routeSummary);
      setRetry(value => value + 1);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Nao foi possivel cancelar o IP."); }
    finally { setCancelling(false); }
  }
  async function closeProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process) return;
    setClosing(true); setSaveError(undefined); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/processes/${id}/close`, { method: "POST",
        headers: { "content-type": "application/json", "X-Record-Version": process.version },
        body: JSON.stringify({ reason: automaticAuditReason }) });
      const body = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(body.detail || "Não foi possível encerrar o IP.");
      if ((await readSavedProcess()).lifecycleStatus !== "CLOSED") {
        throw new Error("A API confirmou o encerramento, mas o IP não aparece como encerrado.");
      }
      setNotice("IP encerrado."); setRetry(value => value + 1);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setClosing(false); }
  }
  async function reopenProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process) return;
    setReopening(true); setSaveError(undefined); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/processes/${id}/reopen`, { method: "POST",
        headers: { "content-type": "application/json", "X-Record-Version": process.version },
        body: JSON.stringify({ reason: automaticAuditReason }) });
      const body = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(body.detail || "Não foi possível reabrir o IP.");
      if ((await readSavedProcess()).lifecycleStatus !== "OPEN") {
        throw new Error("A API confirmou a reabertura, mas o IP não aparece como aberto.");
      }
      setNotice("IP reaberto."); setRetry(value => value + 1);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setReopening(false); }
  }
  const canWrite = roles.some(role => ["Master", "Administrador", "Importação"].includes(role));

  return <main className="shell"><Link className="back" href={returnPath}>← Lista de IPs</Link>
    {loading && <p role="status">Carregando IP…</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
    {!loading && !error && process && lines && <>
      <header className="page-header"><p className="eyebrow">IP · {process.importer} · Fornecedor: {process.supplierName ? `${process.supplierText} · ${process.supplierName}` : process.supplierText ?? "não informado"}</p><h1>{process.ipNumber}</h1><p>Status logístico: {process.logisticsStatus ?? "não informado"}. Ciclo do IP: {process.lifecycleStatus === "CLOSED" ? "encerrado" : process.lifecycleStatus === "OPEN" ? "aberto" : "indisponível"}. Qualidade: {process.qualityStatus}. Origem: {process.sourceKind}.</p></header>
      {compatibilityWarning && <p className="notice" role="status">{compatibilityWarning}</p>}
      {process.recordStatus === "DRAFT" && <p className="notice" role="status">IP criado durante o cancelamento. As POs ficam sem saldo reservado ate a invoice ser carregada.</p>}
      {process.recordStatus === "CANCELLED" && <p className="notice" role="status">IP cancelado. As distribuicoes foram liberadas e as POs encaminhadas conforme a decisao registrada.</p>}
      <section className="metric-grid"><Metric label="POs vinculadas" value={process.purchaseOrders.length} /><Metric label="Linhas históricas" value={lines.totalCount} /><Metric label="Custos históricos" value={process.historicalCosts.length} /></section>
      <section className="card"><h2>Dados operacionais do IP</h2>
        <p>Prioridade: {process.priority ?? "não informada"}. Observações: {process.notes || "—"}.</p>
        {notice && <p className="notice success" role="status">{notice}</p>}
        {saveError && <p className="notice error" role="alert">{saveError}</p>}
        {process.lifecycleStatus === "CLOSED" && <>
          <p className="notice">IP encerrado em {process.closedAt ? new Date(process.closedAt).toLocaleString("pt-BR") : "data indisponível"}.</p>
          {canWrite && <details className="process-action"><summary className="process-action-trigger">Reabrir IP</summary><form className="stack-form" onSubmit={reopenProcess}>
            <button className="button" disabled={reopening}>{reopening ? "Reabrindo…" : "Reabrir IP"}</button>
          </form></details>}
        </>}
        {canWrite && process.lifecycleStatus === "OPEN" && process.recordStatus === "ACTIVE" && <>
          <details className="process-action"><summary className="process-action-trigger">Editar IP</summary><form className="stack-form" onSubmit={saveProcess}>
          <label>Importadora<select required disabled={process.sourceKind !== "MANUAL" || process.purchaseOrders.length > 0
            || process.operationalAllocations.length > 0 || process.historicalCosts.length > 0
            || (process.processDocumentCount ?? 0) > 0 || lines.totalCount > 0}
            value={importerDraft} onChange={event => setImporterDraft(event.target.value)}>
            {!importers.some(option => option.code === importerDraft) && <option value={importerDraft}>{importerDraft}</option>}
            {importers.map(option => <option key={option.code} value={option.code}>{option.code}</option>)}
          </select></label>
          <label>Número do IP<input required maxLength={80} disabled={process.sourceKind !== "MANUAL"}
            value={ipNumberDraft} onChange={event => setIpNumberDraft(event.target.value)} /></label>
          <label>Status logístico<OperationalOptionSelect entity="logistics_status" value={logisticsStatusDraft}
            values={operationalOptions} onChange={setLogisticsStatusDraft} /></label>
          <label>Prioridade<OperationalOptionSelect entity="priority" value={priorityDraft}
            values={operationalOptions} onChange={setPriorityDraft} /></label>
          <label>Observações<textarea maxLength={4000} value={notesDraft} onChange={event => setNotesDraft(event.target.value)} /></label>
          <button className="button" disabled={saving}>{saving ? "Salvando…" : "Salvar IP"}</button>
          </form></details>
          <details className="process-action"><summary className="process-action-trigger">Encerrar IP</summary><form className="stack-form" onSubmit={closeProcess}>
            <p>O encerramento fica a critério do analista e não depende do status logístico. Depois de encerrado, os dados e as distribuições ficam bloqueados para edição.</p>
            <button className="button" disabled={closing}>{closing ? "Encerrando…" : "Encerrar IP"}</button>
          </form></details>
        </>}
      </section>
      <section className="card"><h2>POs vinculadas</h2><p className="muted">Vínculos históricos e operacionais. O IP pode atender várias POs, e uma PO pode aparecer em vários IPs.</p>
        {process.purchaseOrders.length === 0 && <p>Nenhuma PO vinculada. Linhas sem PO podem aparecer nas observações.</p>}
        {process.purchaseOrders.map(order => <p key={order.id}><Link className="text-link" href={`/purchase-orders/${order.id}`}>PO {order.number} →</Link> · {order.importer} · {order.linkSource}</p>)}
        {canWrite && process.lifecycleStatus === "OPEN" && process.recordStatus !== "CANCELLED" && <details className="process-action">
          <summary className="process-action-trigger">Cancelar IP e encaminhar POs</summary>
          <form className="stack-form" onSubmit={cancelProcess}>
            <p>Escolha para cada PO se ela fica sem vinculo, segue para um IP existente ou aguarda invoice em um novo IP. O encaminhamento nao reserva quantidades; a invoice informara a distribuicao.</p>
            {process.purchaseOrders.length === 0 && <p>Este IP nao tem POs vinculadas.</p>}
            {process.purchaseOrders.map(order => {
              const route = cancellationRoutes[order.id] ?? { type: "IDLE" as const };
              const quantities = process.operationalAllocations.filter(allocation => allocation.poId === order.id)
                .map(allocation => allocation.productCode + ": " + formatNumber(allocation.quantity) + " " + allocation.unit);
              return <div className="operational-fields" key={order.id}>
                <strong>PO {order.number}</strong>
                <small>{quantities.length ? "Quantidades alocadas: " + quantities.join("; ") : "Nenhuma quantidade ativa alocada."}</small>
                <label>Destino<select value={route.type} onChange={event => setCancellationRoutes(current => ({
                  ...current, [order.id]: event.target.value === "EXISTING" ? { type: "EXISTING", processId: "" }
                    : event.target.value === "NEW" ? { type: "NEW", ipNumber: "" } : { type: "IDLE" },
                }))}>
                  <option value="IDLE">Deixar sem vinculo</option><option value="EXISTING">IP existente</option><option value="NEW">Criar IP em rascunho</option>
                </select></label>
                {route.type === "EXISTING" && <label>IP de destino<select required value={route.processId}
                  onChange={event => setCancellationRoutes(current => ({ ...current, [order.id]: { type: "EXISTING", processId: event.target.value } }))}>
                  <option value="">Selecione</option>{destinationIps.map(target => <option key={target.id} value={target.id}>{target.ipNumber} · {target.recordStatus}</option>)}
                </select></label>}
                {route.type === "NEW" && <label>Novo IP REF<input required maxLength={80} value={route.ipNumber}
                  onChange={event => setCancellationRoutes(current => ({ ...current, [order.id]: { type: "NEW", ipNumber: event.target.value } }))} /></label>}
              </div>;
            })}
            <button className="button" disabled={cancelling}>{cancelling ? "Cancelando..." : "Cancelar IP e confirmar destinos"}</button>
          </form>
        </details>}
        {canWrite && process.lifecycleStatus === "OPEN" && process.recordStatus === "ACTIVE" && <div className="operational-allocation">
          <div className="allocation-heading">
            <div><h3>Distribuir item de uma PO</h3>
              <p>Escolha o item, confira o saldo e defina quanto ficará neste IP. A PO será vinculada ao confirmar.</p>
            </div>
          </div>
          {saveError && <p className="notice error" role="alert">{saveError}</p>}
          {searchingPos && <p className="allocation-feedback" role="status">Buscando PO e carregando saldo...</p>}
          {poSearchMessage && <p className="allocation-feedback" role="status">{poSearchMessage}</p>}

          <div className="allocation-step-title"><span>1</span><div><h4>Encontre a PO</h4><p>Pesquise pelo número e selecione uma PO da importadora {process.importer}.</p></div></div>
          <form className="allocation-po-search" onSubmit={searchPurchaseOrders}>
            <div className="allocation-search-row">
              <label>Buscar por número<input value={poQuery} autoComplete="off" placeholder="Ex.: 030201"
                onChange={event => {
                  const value = event.target.value;
                  const form = event.currentTarget.form;
                  poSearchRequest.current += 1;
                  window.clearTimeout(poSearchTimer.current);
                  setPoQuery(value); setPoOptions([]); setPoSearchMessage(""); setSaveError(undefined);
                  setSelectedPoId(""); setSelectedPoItemId(""); setPoItems([]); setAllocationQuantity("");
                  setSearchingPos(false);
                  if (value.trim()) poSearchTimer.current = window.setTimeout(() => form?.requestSubmit(), 250);
                }} /></label>
              <button hidden className="button secondary" type="submit" disabled={searchingPos || !poQuery.trim()}>
                {searchingPos ? "Buscando…" : "Buscar PO"}
              </button>
            </div>
            {poOptions.length > 0 && <div className="allocation-po-choices">
              <h5>Selecione a PO</h5>
              <ul>{poOptions.map(order => <li key={order.id}>
                <button type="button" aria-pressed={selectedPoId === order.id}
                  className={selectedPoId === order.id ? "is-selected" : ""}
                  disabled={searchingPos} onClick={() => void choosePurchaseOrder(order.id)}>{order.number}</button>
              </li>)}</ul>
            </div>}
          </form>

          {selectedPoId && <form className="allocation-distribution" onSubmit={distributeItemToProcess}>
            <div className="allocation-step-title"><span>2</span><div><h4>Escolha o item e a quantidade</h4>
              <p>Somente itens com saldo disponível aparecem nesta lista.</p></div></div>
            <label>Item da PO<select required value={selectedPoItemId} disabled={searchingPos || poItems.length === 0}
              onChange={event => { setSelectedPoItemId(event.target.value); setAllocationQuantity(""); }}>
              <option value="">{poItems.length ? "Selecione um item" : "Nenhum item com saldo disponível"}</option>
              {poItems.map(item => <option key={item.id} value={item.id}>
                {item.productCode} · linha {item.lineNumber} · saldo {formatQuantityUnits(quantityUnits(item.remainingQuantity) ?? 0n)}{item.unit ? ` ${item.unit}` : ""}
              </option>)}
            </select></label>
            {selectedPoItem && <>
              <div className="allocation-balance" aria-live="polite">
                <div><span>Saldo disponível na PO</span><strong>{formatQuantityUnits(remainingUnits ?? 0n)}{selectedPoItem.unit ? ` ${selectedPoItem.unit}` : ""}</strong></div>
                <p>{remainingAfterAllocation !== null
                  ? <>Após distribuir, restarão <strong>{remainingAfterAllocation}{selectedPoItem.unit ? ` ${selectedPoItem.unit}` : ""}</strong> neste item.</>
                  : "Informe a quantidade para ver o saldo restante."}</p>
              </div>
              <div className="allocation-submit-row">
                <label>Quantidade para este IP<input required inputMode="decimal" value={allocationQuantity}
                  onChange={event => setAllocationQuantity(event.target.value)} placeholder="Ex.: 40" /></label>
                <button className="button" disabled={!selectedPoItemId || !allocationQuantity || searchingPos || linkingPo
                  || allocationUnits === null || allocationUnits <= 0n || remainingUnits === null || allocationUnits > remainingUnits}>
                  {linkingPo ? "Distribuindo…" : "Confirmar distribuição"}
                </button>
              </div>
              {selectedPoItem && allocationUnits !== null && remainingUnits !== null && allocationUnits > remainingUnits
                && <p className="notice error" role="alert">A quantidade informada excede o saldo disponível.</p>}
            </>}
          </form>}
        </div>}
      </section>
      <section className="card"><h2>Quantidades distribuídas para este IP</h2>
        <p className="muted">Cada linha mostra o que foi alocado a este IP e o saldo restante do item na PO, já considerando todos os IPs.</p>
        {process.operationalAllocations.length === 0 ? <p>Nenhuma quantidade distribuída operacionalmente.</p> :
          <div className="table-scroll"><table><thead><tr><th>PO</th><th>Produto</th><th>Quantidade neste IP</th><th>Saldo restante na PO</th></tr></thead><tbody>
            {process.operationalAllocations.map(item => <tr key={item.id}>
              <td><Link className="text-link" href={`/purchase-orders/${item.poId}`}>{item.poNumber}</Link></td>
              <td>{item.productCode}</td><td>{formatNumber(item.quantity)} {item.unit}</td>
              <td>{formatNumber(item.poItemRemainingQuantity)} {item.unit}</td>
            </tr>)}
          </tbody></table></div>}
      </section>
      <ProcessPostShipmentPanel id={id} />
      <details className="card historical-disclosure"><summary>Dados de origem e linhas históricas ({lines.totalCount})</summary>
        {lines.items.length === 0 && <p>Nenhuma linha nesta página.</p>}
        {lines.items.length > 0 && <div className="table-scroll"><table><thead><tr><th>Origem</th><th>PO</th><th>Produto de origem</th><th>Quantidade de origem</th><th>Status de origem</th><th>Células</th></tr></thead><tbody>
          {lines.items.map(line => <Fragment key={line.id}><tr><td>{line.sourceSheetName} · {line.sourceRowNumber}</td><td>{line.purchaseOrderId ? <Link className="text-link" href={`/purchase-orders/${line.purchaseOrderId}`}>{line.poNumber}</Link> : "Sem PO"}</td><td>{line.productCode ?? "—"}<br />{line.productDescription}</td><td>{formatNumber(line.quantityFromSource)}</td><td>{line.legacyStatus ?? "—"}</td><td><button type="button" className="source-expand-button" aria-label={`${expandedLineId === line.id ? "Ocultar" : "Ver"} campos da linha ${line.sourceRowNumber} da aba ${line.sourceSheetName}`} aria-expanded={expandedLineId === line.id} onClick={() => setExpandedLineId(current => current === line.id ? undefined : line.id)}>{expandedLineId === line.id ? "Ocultar campos" : "Ver campos"}</button></td></tr>
            {expandedLineId === line.id && <tr className="source-detail-row"><td colSpan={6}><section className="source-detail-panel"><div className="source-detail-heading"><strong>Campos preservados da origem</strong><span>Aba {line.sourceSheetName} · linha {line.sourceRowNumber}</span></div><dl className="source-field-grid">{Object.entries(line.sourceValues ?? {}).map(([column, value]) => <div className="source-field" key={column}><dt>{line.sourceColumnHeaders?.[column] || "Campo sem cabeçalho"}<small>{column}{line.sourceRowNumber}</small></dt><dd>{value == null ? "—" : String(value)}</dd></div>)}</dl></section></td></tr>}</Fragment>)}
        </tbody></table></div>}
        {lines.totalCount > lines.pageSize && <nav className="pagination"><button className="button secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page} de {Math.ceil(lines.totalCount / lines.pageSize)}</span><button className="button" disabled={page * lines.pageSize >= lines.totalCount} onClick={() => setPage(value => value + 1)}>Próxima</button></nav>}
      </details><details className="card historical-disclosure"><summary>Custos históricos ({process.historicalCosts.length})</summary>
        {process.historicalCosts.length === 0 && <p>Nenhum custo histórico registrado.</p>}
        {process.historicalCosts.length > 0 && <div className="table-scroll"><table><thead><tr><th>Tipo</th><th>Valor</th><th>Status</th><th>Origem</th></tr></thead><tbody>{process.historicalCosts.map(cost => <tr key={cost.id}><td>{cost.type}</td><td>{formatNumber(cost.amount)} {cost.currency}</td><td>{cost.status}</td><td>{cost.sourceSheetName} · {cost.sourceColumn}{cost.sourceRowNumber}</td></tr>)}</tbody></table></div>}
      </details>
    </>}
  </main>;
}

function Metric({ label, value }: { label: string; value: number }) { return <section className="metric"><span>{label}</span><strong>{value}</strong></section>; }
