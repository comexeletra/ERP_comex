"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { automaticAuditReason } from "../../../lib/audit";

const entities = [
  ["importer", "Importadora"], ["incoterm", "Incoterm"], ["transport_mode", "Modal"], ["port_loading", "POL / porto de origem"],
  ["port_discharge", "POD / porto de destino"], ["currency", "Moeda"], ["category", "Categoria"],
  ["product_group", "Grupo de produto"], ["group", "Group"], ["purpose", "Finalidade"], ["demand", "Demanda"],
  ["logistics_status", "Status logístico"], ["customs_channel", "Canal aduaneiro"],
  ["container_type", "Tipo de container"], ["priority", "Prioridade"],
  ["unit_of_measure", "Unidade de medida"], ["product", "Produto"], ["ncm", "NCM"],
  ["requester", "Solicitante"], ["cost_center", "Centro de custo"], ["broker", "Despachante"],
  ["forwarder", "Agente de carga"], ["supplier", "Fornecedor"],
] as const;
type Option = { id: string; entity: string; code?: string | null; value: string };
type Supplier = { id: string; code: string; name: string; status: string };
type Product = { id: string; importer: string; code: string; name: string; status: string; version: string };
type Importer = { code: string; historicalPoCount: number };

function parseCsv(source: string): string[][] {
  const text = source.replace(/^\uFEFF/u, "");
  const countColumns = (delimiter: string) => {
    let quoted = false;
    let count = 1;
    for (let index = 0; index < text.length && text[index] !== "\n" && text[index] !== "\r"; index += 1) {
      const char = text[index];
      if (char === '"' && text[index + 1] === '"' && quoted) { index += 1; continue; }
      if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) count += 1;
    }
    return count;
  };
  const delimiter = countColumns(";") > countColumns(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && text[index + 1] === '"' && quoted) { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(value => value !== "")) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("O CSV contém aspas sem fechamento.");
  row.push(cell.trim());
  if (row.some(value => value !== "")) rows.push(row);
  if (!rows.length) throw new Error("O CSV está vazio.");
  return rows;
}

function normalizeCsvHeader(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[\s_-]+/gu, "").trim();
}

export default function OperationalValuesPage() {
  const [options, setOptions] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState({ code: "", name: "", evidence: "" });
  const [supplierRefresh, setSupplierRefresh] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productImporters, setProductImporters] = useState<Importer[]>([]);
  const [productImporter, setProductImporter] = useState("");
  const [productDraft, setProductDraft] = useState({ code: "", description: "", evidence: "" });
  const [productRefresh, setProductRefresh] = useState(0);
  const [entity, setEntity] = useState<string>(entities[0][0]);
  const [value, setValue] = useState("");
  const [valueCode, setValueCode] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editValue, setEditValue] = useState("");
  const [jsonValues, setJsonValues] = useState<string[]>([]);
  const [jsonFileName, setJsonFileName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvError, setCsvError] = useState("");
  const csvFileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [valuesResponse, identityResponse] = await Promise.all([
      apiFetch("/api/v1/operational-values", { cache: "no-store" }), apiFetch("/auth/me"),
    ]);
    const values = await valuesResponse.json() as { items?: Option[]; detail?: string };
    const identity = await identityResponse.json() as { roles?: string[] };
    if (!valuesResponse.ok || !identityResponse.ok) throw new Error(values.detail || "Não foi possível carregar os cadastros.");
    setOptions(values.items ?? []);
    setCanWrite((identity.roles ?? []).some(role => ["Master", "Administrador", "Compras"].includes(role)));
  }, []);

  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : "Erro ao carregar.")); }, [load]);

  useEffect(() => {
    if (entity !== "supplier") { setSuppliers([]); return; }
    const controller = new AbortController();
    setSuppliersLoading(true);
    const query = new URLSearchParams({ page: "1", pageSize: "100" });
    apiFetch(`/api/v1/suppliers?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { items?: Supplier[]; detail?: string };
        if (!response.ok) throw new Error(data.detail || "Não foi possível carregar os fornecedores.");
        if (!controller.signal.aborted) setSuppliers(data.items ?? []);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro ao carregar fornecedores."); })
      .finally(() => { if (!controller.signal.aborted) setSuppliersLoading(false); });
    return () => controller.abort();
  }, [entity, supplierRefresh]);

  useEffect(() => {
    if (entity !== "product") { setProducts([]); return; }
    const controller = new AbortController();
    setProductsLoading(true);
    const query = new URLSearchParams({ page: "1", pageSize: "100" });
    if (productImporter) query.set("importer", productImporter);
    Promise.all([
      apiFetch("/api/v1/importers", { cache: "no-store", signal: controller.signal })
        .then(async response => {
          const data = await response.json() as { items?: Importer[]; detail?: string };
          if (!response.ok) throw new Error(data.detail || "Não foi possível carregar as importadoras.");
          return data.items ?? [];
        }),
      apiFetch(`/api/v1/products?${query}`, { cache: "no-store", signal: controller.signal })
        .then(async response => {
          const data = await response.json() as { items?: Product[]; detail?: string };
          if (!response.ok) throw new Error(data.detail || "Não foi possível carregar os produtos.");
          return data.items ?? [];
        }),
    ]).then(([availableImporters, entries]) => {
      if (controller.signal.aborted) return;
      setProductImporters(availableImporters);
      setProducts(entries);
      if (!productImporter && availableImporters[0]) setProductImporter(availableImporters[0].code);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro ao carregar produtos.");
    }).finally(() => { if (!controller.signal.aborted) setProductsLoading(false); });
    return () => controller.abort();
  }, [entity, productImporter, productRefresh]);

  async function addSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/suppliers", { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ code: supplierDraft.code,
          name: supplierDraft.name, evidence: supplierDraft.evidence, reason: automaticAuditReason }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível cadastrar o fornecedor.");
      setSupplierDraft({ code: "", name: "", evidence: "" });
      const query = new URLSearchParams({ page: "1", pageSize: "100" });
      const listResponse = await apiFetch(`/api/v1/suppliers?${query}`, { cache: "no-store" });
      const list = await listResponse.json() as { items?: Supplier[]; detail?: string };
      if (!listResponse.ok) throw new Error(list.detail || "Fornecedor salvo, mas não foi possível atualizar a lista.");
      setSuppliers(list.items ?? []);
      setNotice("Fornecedor cadastrado e disponível para associação às POs e aos IPs.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao cadastrar fornecedor."); }
    finally { setBusy(false); }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/products", { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ importer: productImporter, code: productDraft.code,
          name: productDraft.description, evidence: productDraft.evidence, reason: automaticAuditReason }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível cadastrar o produto.");
      setProductDraft({ code: "", description: "", evidence: "" });
      setProductRefresh(current => current + 1);
      setNotice("Produto cadastrado com código e descrição.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao cadastrar produto."); }
    finally { setBusy(false); }
  }

  async function selectCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setCsvRows([]); setCsvFileName(""); setCsvError(""); setError(""); setNotice("");
    if (!file) return;
    if (file.size > 2_000_000) { setCsvError("O arquivo CSV deve ter no máximo 2 MB."); return; }
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error("Inclua o cabeçalho e ao menos uma linha de dados.");
      if (rows.length > 501) throw new Error("Cada importação aceita até 500 linhas de dados.");
      setCsvRows(rows); setCsvFileName(file.name);
    } catch (cause) {
      setCsvError(cause instanceof Error ? cause.message : "Não foi possível ler o CSV.");
    }
  }

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (csvRows.length < 2) return;
    setBusy(true); setError(""); setCsvError(""); setNotice("");
    try {
      const headers = csvRows[0].map(normalizeCsvHeader);
      const column = (...names: string[]) => headers.findIndex(header => names.includes(header));
      const codeColumn = column("code", "codigo", "productcode", "suppliercode", "groupcode");
      const valueColumn = column("value", "valor", normalizeCsvHeader(entities.find(([key]) => key === entity)?.[1] ?? ""));
      const nameColumn = column("name", "nome", "description", "descricao", "supplier", "fornecedor");
      const requiredColumn = (index: number, label: string) => {
        if (index < 0) throw new Error(`Coluna obrigatória não encontrada: ${label}.`);
        return index;
      };
      let records: Array<{ code?: string; name?: string; value?: string }>;
      if (entity === "supplier" || entity === "product") {
        const codeIndex = requiredColumn(codeColumn, "codigo");
        const nameIndex = requiredColumn(nameColumn, entity === "product" ? "descricao" : "nome");
        records = csvRows.slice(1).map((row, index) => ({
          code: row[codeIndex]?.trim(), name: row[nameIndex]?.trim(),
          value: `linha ${index + 2}`,
        }));
        const invalid = records.find(record => !record.code || !record.name);
        if (invalid) throw new Error(`Código ou descrição vazios na ${invalid.value}.`);
        if (entity === "product" && !productImporter) throw new Error("Selecione uma importadora para cadastrar os produtos.");
      } else if (entity === "group") {
        const codeIndex = requiredColumn(codeColumn, "codigo");
        const valueIndex = requiredColumn(valueColumn, "valor");
        records = csvRows.slice(1).map((row, index) => ({ code: row[codeIndex]?.trim(), name: row[valueIndex]?.trim(), value: `linha ${index + 2}` }));
        const invalid = records.find(record => !record.code || !record.name);
        if (invalid) throw new Error(`Código ou valor vazios na ${invalid.value}.`);
      } else {
        const valueIndex = requiredColumn(valueColumn >= 0 ? valueColumn : column("name", "nome"), "valor");
        records = csvRows.slice(1).map((row, index) => ({ name: row[valueIndex]?.trim(), value: `linha ${index + 2}` }));
        const invalid = records.find(record => !record.name);
        if (invalid) throw new Error(`Valor vazio na ${invalid.value}.`);
      }

      let createdCount = 0;
      let skippedCount = 0;
      if (entity !== "supplier" && entity !== "product" && entity !== "group") {
        const response = await apiFetch("/api/v1/operational-values/bulk", { method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entity, values: records.map(record => record.name), reason: automaticAuditReason }) });
        const result = await response.json() as { createdCount?: number; skippedCount?: number; detail?: string };
        if (!response.ok) throw new Error(result.detail || "Não foi possível importar os valores do CSV.");
        createdCount = result.createdCount ?? 0; skippedCount = result.skippedCount ?? 0;
      } else {
        const failures: string[] = [];
        const indexedRecords = records.map((record, index) => ({ record, index }));
        for (let start = 0; start < indexedRecords.length; start += 5) {
          const batch = indexedRecords.slice(start, start + 5);
          const results = await Promise.all(batch.map(async ({ record, index }) => {
            const line = index + 2;
            const evidence = `Importado via ${csvFileName}, linha ${line}.`;
            const endpoint = entity === "supplier" ? "/api/v1/suppliers"
              : entity === "product" ? "/api/v1/products" : "/api/v1/operational-values";
            const body = entity === "group"
              ? { entity: "GROUP", code: record.code, value: record.name, reason: automaticAuditReason }
              : { ...(entity === "product" ? { importer: productImporter } : {}), code: record.code,
                name: record.name, evidence, reason: automaticAuditReason };
            const response = await apiFetch(endpoint, { method: "POST",
              headers: { "content-type": "application/json", ...(entity !== "group" ? { "Idempotency-Key": crypto.randomUUID() } : {}) },
              body: JSON.stringify(body) });
            const result = await response.json() as { detail?: string };
            if (response.status === 409) return { skipped: true as const };
            if (!response.ok) return { error: `linha ${line}: ${result.detail || "falha ao importar"}` };
            return { created: true as const };
          }));
          for (const result of results) {
            if ("created" in result) createdCount += 1;
            else if ("skipped" in result) skippedCount += 1;
            else failures.push(result.error);
          }
        }
        if (failures.length) {
          if (entity === "supplier") setSupplierRefresh(current => current + 1);
          else if (entity === "product") setProductRefresh(current => current + 1);
          else if (createdCount > 0) await load();
          throw new Error(`${createdCount} adicionados, ${skippedCount} duplicados ignorados. ${failures.slice(0, 5).join("; ")}`);
        }
      }

      if (entity === "supplier") setSupplierRefresh(current => current + 1);
      else if (entity === "product") setProductRefresh(current => current + 1);
      else await load();
      setCsvRows([]); setCsvFileName("");
      if (csvFileInput.current) csvFileInput.current.value = "";
      setNotice(`Importação concluída: ${createdCount} adicionados; ${skippedCount} já existiam e foram ignorados.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao importar CSV."); }
    finally { setBusy(false); }
  }

  function downloadCsvTemplate() {
    const headers = entity === "product" ? "codigo;descricao" : entity === "supplier" ? "codigo;nome"
      : entity === "group" ? "codigo;valor" : "valor";
    const url = URL.createObjectURL(new Blob([`\uFEFF${headers}\r\n`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${entity}-modelo.csv`; anchor.click();
    URL.revokeObjectURL(url);
  }

  function chooseEntity(next: string) {
    setEntity(next); setCsvRows([]); setCsvFileName(""); setCsvError("");
    setError(""); setNotice(""); setEditingId("");
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/operational-values", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ entity, ...(entity === "group" ? { code: valueCode } : {}), value, reason: automaticAuditReason }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível adicionar o valor.");
      setValue(""); setValueCode(""); await load(); setNotice("Valor adicionado ao cadastro e disponível nos seletores.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao adicionar valor."); }
    finally { setBusy(false); }
  }

  function startEditing(option: Option) {
    setEditingId(option.id);
    setEditCode(option.code ?? "");
    setEditValue(option.value);
    setError("");
    setNotice("");
  }

  function cancelEditing() {
    setEditingId("");
    setEditCode("");
    setEditValue("");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, option: Option) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/operational-values/${option.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedValue: option.value, ...(entity === "group" ? { expectedCode: option.code ?? null, code: editCode } : {}), value: editValue, reason: automaticAuditReason }),
      });
      const result = await response.json() as { detail?: string; value?: string; unchanged?: boolean };
      if (!response.ok) throw new Error(result.detail || "Não foi possível editar o valor.");
      cancelEditing();
      await load();
      setNotice(result.unchanged ? "O valor não foi alterado." : "Valor atualizado nos seletores.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao editar valor."); }
    finally { setBusy(false); }
  }

  async function selectJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setJsonValues([]); setJsonFileName(""); setError(""); setNotice("");
    if (!file) return;
    if (file.size > 750_000) { setError("O arquivo deve ter no máximo 750 KB."); return; }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const values = Array.isArray(parsed) ? parsed
        : typeof parsed === "object" && parsed !== null && "values" in parsed
          ? (parsed as { values: unknown }).values : null;
      if (!Array.isArray(values) || values.length === 0 || values.length > 500
        || values.some(item => typeof item !== "string" || !item.trim())) {
        throw new Error("Use uma lista JSON de textos ou um objeto { \"values\": [\"valor\"] }, com 1 a 500 valores não vazios.");
      }
      setJsonValues(values.map(item => (item as string).trim()));
      setJsonFileName(file.name);
    } catch (cause) {
      setError(cause instanceof SyntaxError ? "O arquivo não contém um JSON válido." :
        cause instanceof Error ? cause.message : "Não foi possível ler o arquivo.");
    }
  }

  async function importJson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/operational-values/bulk", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity, values: jsonValues, reason: automaticAuditReason }) });
      let result: { createdCount?: number; skippedCount?: number; detail?: string };
      if (response.status === 404) {
        let createdCount = 0;
        let skippedCount = 0;
        for (const [index, item] of jsonValues.entries()) {
          const itemResponse = await apiFetch("/api/v1/operational-values", { method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ entity, value: item, reason: automaticAuditReason }) });
          const itemResult = await itemResponse.json() as { detail?: string };
          if (itemResponse.status === 409) {
            skippedCount += 1;
            continue;
          }
          if (!itemResponse.ok) {
            throw new Error(`${itemResult.detail || "Não foi possível importar os valores."} Importação interrompida após ${index} de ${jsonValues.length} valores.`);
          }
          createdCount += 1;
        }
        result = { createdCount, skippedCount };
      } else {
        result = await response.json() as { createdCount?: number; skippedCount?: number; detail?: string };
        if (!response.ok) throw new Error(result.detail || "Não foi possível importar os valores.");
      }
      setJsonValues([]); setJsonFileName("");
      if (fileInput.current) fileInput.current.value = "";
      await load();
      setNotice(`Importação concluída: ${result.createdCount ?? 0} adicionados; ${result.skippedCount ?? 0} já existiam e foram ignorados.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao importar valores."); }
    finally { setBusy(false); }
  }

  const visible = options.filter(option => option.entity === entity).sort((a, b) => a.value.localeCompare(b.value));
  const csvImportSection = canWrite && <section className="card entity-value-form">
    <h2>Importar entidades por CSV</h2>
    <p className="muted">Use uma coluna <code>valor</code> para entidades simples, <code>codigo;descricao</code> para Produto, <code>codigo;nome</code> para Fornecedor e <code>codigo;valor</code> para Group. Aceita vírgula ou ponto e vírgula.</p>
    <form className="stack-form" onSubmit={event => void importCsv(event)}>
      <label>Arquivo CSV<input className="file-upload-input" ref={csvFileInput} type="file" accept=".csv,text/csv" onChange={event => void selectCsv(event)} /></label>
      <div className="button-row"><button className="button secondary" type="button" onClick={downloadCsvTemplate}>Baixar modelo CSV</button>
        <button className="button" disabled={busy || csvRows.length < 2}>{busy ? "Importando…" : `Importar ${csvRows.length > 1 ? csvRows.length - 1 : "linhas"}`}</button></div>
    </form>
    {csvError && <p className="notice error" role="alert">{csvError}</p>}
    {csvFileName && <p className="muted" role="status">{csvFileName}: {csvRows.length - 1} linhas prontas para importar.</p>}
  </section>;
  if (entity === "product") return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Valores das entidades</h1>
      <p>Gerencie as opções usadas nos campos do sistema.</p>
      <Link className="text-link" href="/catalog">Todos os cadastros</Link></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card entity-values-card">
      <h2>Campo e opções</h2>
      <label>Campo<select value={entity} onChange={event => chooseEntity(event.target.value)}>
        {entities.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <p className="muted">Cada produto é cadastrado com seu código e sua descrição.</p>
      <label>Importadora<select value={productImporter} onChange={event => setProductImporter(event.target.value)}>
        {productImporters.map(value => <option key={value.code} value={value.code}>{value.code}</option>)}
      </select></label>
      <h3>Produtos cadastrados · {products.length}</h3>
      {productsLoading ? <p role="status">Carregando produtos…</p> : products.length ? <ul className="entity-value-list">
        {products.map(product => <li key={product.id}><span><strong>{product.code}</strong> · {product.name}</span>
          <span className="muted">{product.status === "ACTIVE" ? "Ativo" : "Inativo"}</span></li>)}
      </ul> : <p className="muted">Ainda não há produtos cadastrados para esta importadora.</p>}
      {canWrite && <form className="stack-form" onSubmit={event => void addProduct(event)}>
        <h3>Adicionar produto</h3>
        <label>Código do produto<input required maxLength={120} value={productDraft.code} onChange={event => setProductDraft(current => ({ ...current, code: event.target.value }))} /></label>
        <label>Descrição do produto<input required maxLength={240} value={productDraft.description} onChange={event => setProductDraft(current => ({ ...current, description: event.target.value }))} /></label>
        <label>Evidência da revisão<textarea required minLength={8} maxLength={2000} value={productDraft.evidence} onChange={event => setProductDraft(current => ({ ...current, evidence: event.target.value }))} placeholder="Documento, número, data e onde conferir" /></label>
        <button className="button" disabled={busy || !productImporter}>{busy ? "Salvando…" : "Adicionar produto"}</button>
      </form>}
    </section>
    {csvImportSection}
  </main>;
  if (entity === "supplier") return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Valores das entidades</h1>
      <p>Gerencie as opções usadas nos campos do sistema.</p>
      <Link className="text-link" href="/catalog">Todos os cadastros</Link></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card entity-values-card">
      <h2>Campo e opções</h2>
      <label>Campo<select value={entity} onChange={event => chooseEntity(event.target.value)}>
        {entities.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <p className="muted">Fornecedores são entidades globais, compartilhadas entre importadoras. O mesmo cadastro é usado nas POs e nos IPs.</p>
      <h3>Fornecedores cadastrados · {suppliers.length}</h3>
      {suppliersLoading ? <p role="status">Carregando fornecedores…</p> : suppliers.length ? <ul className="entity-value-list">
        {suppliers.map(supplier => <li key={supplier.id}><span>{supplier.code} · {supplier.name}</span><span className="muted">{supplier.status === "ACTIVE" ? "Ativo" : "Inativo"}</span></li>)}
      </ul> : <p className="muted">Ainda não há fornecedores cadastrados para esta importadora.</p>}
      {canWrite && <form className="stack-form" onSubmit={event => void addSupplier(event)}>
        <h3>Adicionar fornecedor</h3>
        <label>Código do fornecedor<input required maxLength={120} value={supplierDraft.code} onChange={event => setSupplierDraft(current => ({ ...current, code: event.target.value }))} /></label>
        <label>Nome do fornecedor<input required maxLength={240} value={supplierDraft.name} onChange={event => setSupplierDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label>Evidência da revisão<textarea required minLength={8} maxLength={2000} value={supplierDraft.evidence} onChange={event => setSupplierDraft(current => ({ ...current, evidence: event.target.value }))} placeholder="Documento, número, data e onde conferir" /></label>
        <button className="button" disabled={busy}>{busy ? "Salvando…" : "Adicionar fornecedor"}</button>
      </form>}
      <Link className="button secondary" href="/catalog">Gerenciar e editar fornecedores</Link>
    </section>
    {csvImportSection}
  </main>;
  return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Valores das entidades</h1>
      <p>Gerencie as opções usadas nos campos do sistema.</p>
      <Link className="text-link" href="/catalog">Todos os cadastros</Link></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card entity-values-card">
      <h2>Campo e opções</h2>
      <label>Campo<select value={entity} onChange={event => chooseEntity(event.target.value)}>
        {entities.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <h3>Valores cadastrados · {visible.length}</h3>
      {visible.length ? <ul className="entity-value-list">{visible.map(option => <li key={option.id}>
        {editingId === option.id ? <form className="entity-value-edit" onSubmit={event => void saveEdit(event, option)}>
          {entity === "group" && <><label className="sr-only" htmlFor={`operational-code-${option.id}`}>Código</label>
            <input id={`operational-code-${option.id}`} required maxLength={120} value={editCode} onChange={event => setEditCode(event.target.value)} /></>}
          <label className="sr-only" htmlFor={`operational-value-${option.id}`}>Valor atualizado</label>
          <input id={`operational-value-${option.id}`} required maxLength={240} value={editValue}
            onChange={event => setEditValue(event.target.value)} />
          <button className="button entity-value-action" disabled={busy || !editValue.trim()}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
          <button className="button secondary entity-value-action" type="button" disabled={busy} onClick={cancelEditing}>Cancelar</button>
        </form> : <>
          <span>{entity === "group" && option.code ? <><strong>{option.code}</strong> · </> : null}{option.value}</span>
          <button className="button secondary entity-value-action" type="button" disabled={busy}
            aria-label={`Editar ${option.value}`} onClick={() => startEditing(option)}>Editar</button>
        </>}
      </li>)}</ul> :
        <p className="muted">Ainda não há valores cadastrados para este campo.</p>}
    </section>
    {csvImportSection}
    {canWrite && <section className="card entity-value-form">
      <h2>Adicionar valor à entidade</h2>
      <form className="stack-form" onSubmit={add}>
        {entity === "group" && <label>Código<input required maxLength={120} value={valueCode} onChange={event => setValueCode(event.target.value)} /></label>}
        <label>Novo valor<input required maxLength={240} value={value} onChange={event => setValue(event.target.value)} /></label>
        <button className="button" disabled={busy || !value.trim()}>{busy ? "Salvando…" : "Adicionar valor"}</button>
      </form>
    </section>}
    {canWrite && entity !== "group" && <section className="card entity-value-form">
      <h2>Importar valores por JSON</h2>
      <p className="muted">Selecione um arquivo com uma lista de textos ou com a propriedade <code>values</code>. Máximo de 500 valores por importação.</p>
      <form className="stack-form" onSubmit={importJson}>
        <label>Arquivo JSON<input className="file-upload-input" ref={fileInput} type="file" accept=".json,application/json" onChange={event => void selectJson(event)} /></label>
        <button className="button" disabled={busy || jsonValues.length === 0}>{busy ? "Importando…" : `Importar ${jsonValues.length || "valores"}`}</button>
      </form>
      {jsonFileName && <p className="muted" role="status">{jsonFileName}: {jsonValues.length} valores prontos para importar na entidade selecionada.</p>}
      <details><summary>Ver exemplo de JSON</summary><pre>{`[\n  "Valor 1",\n  "Valor 2"\n]`}</pre></details>
    </section>}
  </main>;
}
