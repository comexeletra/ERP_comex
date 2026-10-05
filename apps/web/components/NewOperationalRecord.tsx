"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";
import {
  blankPurchaseOrderItemFields, OperationalFieldDraft, OperationalFieldsEditor, purchaseOrderItemFields,
  purchaseOrderItemFieldsPayload,
} from "./PurchaseOrderItemFields";
import {
  CatalogChoice, loadCatalogChoices, loadOperationalOptions, OperationalOption,
  OperationalOptionSelect,
} from "./OperationalOptionSelect";

const poRoles = new Set(["Master", "Administrador", "Importação", "Compras"]);
const ipRoles = new Set(["Master", "Administrador", "Importação"]);

type PoItemDraft = {
  externalLineReference: string;
  productCode: string;
  description: string;
  orderedQuantity: string;
  unit: string;
  unitPrice: string;
  currency: string;
  operational: OperationalFieldDraft;
};

function blankPoItem(): PoItemDraft {
  return { externalLineReference: "", productCode: "", description: "", orderedQuantity: "",
    unit: "", unitPrice: "", currency: "", operational: blankPurchaseOrderItemFields() };
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { detail?: string };
  if (!response.ok) throw new Error(body.detail || "Não foi possível salvar os dados.");
  return body;
}

export default function NewOperationalRecord({ kind }: { kind: "po" | "ip" }) {
  const router = useRouter();
  const [roles, setRoles] = useState<string[]>([]);
  const [importers, setImporters] = useState<string[]>([]);
  const [importer, setImporter] = useState("");
  const [number, setNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<CatalogChoice[]>([]);
  const [products, setProducts] = useState<CatalogChoice[]>([]);
  const [options, setOptions] = useState<OperationalOption[]>([]);
  const [items, setItems] = useState<PoItemDraft[]>([blankPoItem()]);
  const [createdPoId, setCreatedPoId] = useState("");

  useEffect(() => {
    Promise.all([apiFetch("/auth/me"), apiFetch("/api/v1/importers"), loadOperationalOptions()])
      .then(async ([identity, list, optionValues]) => {
        if (!identity.ok || !list.ok) throw new Error("Não foi possível consultar suas permissões e importadoras.");
        const user = await identity.json() as { roles: string[] };
        const data = await list.json() as { items: Array<{ code: string }> };
        setRoles(user.roles);
        setOptions(optionValues);
        setImporters(data.items.map(item => item.code));
        if (data.items[0]) setImporter(data.items[0].code);
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : "Erro inesperado."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!importer || kind !== "po") { setSuppliers([]); setProducts([]); return; }
    let active = true;
    setCatalogLoading(true);
    Promise.all([loadCatalogChoices("suppliers", importer), loadCatalogChoices("products", importer)])
      .then(([supplierItems, productItems]) => {
        if (!active) return;
        setSuppliers(supplierItems);
        setProducts(productItems);
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : "Erro ao carregar produtos e fornecedores.");
      })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [importer, kind]);

  const allowed = roles.some(role => (kind === "po" ? poRoles : ipRoles).has(role));

  function updateItem(index: number, change: Partial<PoItemDraft>) {
    setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));
  }

  async function createPurchaseOrder() {
    if (items.length === 0) throw new Error("Adicione ao menos um item à PO.");
    for (const [index, item] of items.entries()) {
      if (Boolean(item.unitPrice.trim()) !== Boolean(item.currency)) {
        throw new Error(`No item ${index + 1}, preencha preço e moeda juntos ou deixe os dois vazios.`);
      }
    }

    const header = await readResponse<{ id: string }>(await apiFetch("/api/v1/purchase-orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ importer, number, supplierText: supplier || null,
        orderDate: orderDate || null, notes, reason }),
    }));
    setCreatedPoId(header.id);

    try {
      for (const item of items) {
        const createdItem = await readResponse<{ id: string }>(await apiFetch(`/api/v1/purchase-orders/${header.id}/items`, {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ externalLineReference: item.externalLineReference || null,
            productCode: item.productCode, description: item.description,
            orderedQuantity: item.orderedQuantity.replace(",", "."), unit: item.unit,
            unitPrice: item.unitPrice ? item.unitPrice.replace(",", ".") : null,
            currency: item.currency ? item.currency.toUpperCase() : null, reason }),
        }));

        const fields = purchaseOrderItemFieldsPayload(item.operational);
        if (Object.keys(fields).length > 0) {
          const operationalPo = await readResponse<{ version: string }>(
            await apiFetch(`/api/v1/purchase-orders/${header.id}/operational`));
          await readResponse(await apiFetch(`/api/v1/purchase-orders/${header.id}/items/${createdItem.id}/followup`, {
            method: "PATCH",
            headers: { "content-type": "application/json", "If-Match": `"${operationalPo.version}"` },
            body: JSON.stringify({ fields, reason }),
          }));
        }
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Erro inesperado.";
      setError(`A PO foi criada, mas o cadastro dos itens não terminou: ${detail}`);
      return;
    }
    router.push(`/purchase-orders/${header.id}`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (kind === "po") {
        await createPurchaseOrder();
        return;
      }
      const response = await apiFetch("/api/v1/processes", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ importer, ipNumber: number, logisticsStatus: status || null,
          priority: priority || null, notes, reason }),
      });
      const result = await readResponse<{ id: string }>(response);
      router.push(`/processes/${result.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro inesperado.");
    } finally {
      setSaving(false);
    }
  }

  return <main className="shell">
    <Link className="back" href={kind === "po" ? "/" : "/processes"}>← Voltar</Link>
    <header className="page-header">
      <p className="eyebrow">Registro operacional</p>
      <h1>{kind === "po" ? "Cadastrar PO do TOTVS" : "Criar IP"}</h1>
      <p>{kind === "po"
        ? "Preencha os dados do pedido e de cada produto nesta tela. Datas, prazos e indicadores são calculados automaticamente quando houver informações suficientes."
        : "Cadastre o processo de importação. Ele poderá receber itens de várias POs da mesma importadora."}</p>
    </header>
    {loading && <p role="status">Carregando seus dados…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {!loading && !allowed && <p className="notice">Seu perfil não permite criar {kind === "po" ? "POs" : "IPs"}.</p>}
    {!loading && allowed && <form className="stack-form" onSubmit={submit}>
      {kind === "po" ? <>
        <section className="card po-entry-section">
          <h2>Dados do pedido</h2>
          <p className="muted">Informe a importadora e os dados que identificam a PO no TOTVS.</p>
          <div className="operational-fields">
            <label>Importadora<select required value={importer} onChange={event => setImporter(event.target.value)}>
              <option value="">Selecione</option>{importers.map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <label>Número da PO no TOTVS<input required maxLength={80} value={number} onChange={event => setNumber(event.target.value)} /></label>
            <label>Fornecedor<select value={supplier} onChange={event => setSupplier(event.target.value)}>
              <option value="">Selecione</option>{suppliers.map(item => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
            </select></label>
            <label>Data da PO<input type="date" value={orderDate} onChange={event => setOrderDate(event.target.value)} /></label>
          </div>
          <label>Observações do pedido<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        </section>

        <section className="card po-entry-section">
          <div className="po-entry-heading">
            <div><h2>Produtos e quantidades</h2><p className="muted">Adicione uma linha para cada produto da PO.</p></div>
            <button className="button secondary" type="button" onClick={() => setItems(current => [...current, blankPoItem()])}>Adicionar produto</button>
          </div>
          {catalogLoading && <p role="status">Carregando produtos e fornecedores…</p>}
          {items.map((item, index) => <article className="po-entry-item" key={index}>
            <div className="po-entry-heading">
              <h3>Produto {index + 1}</h3>
              {items.length > 1 && <button className="button secondary" type="button"
                onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>}
            </div>
            <div className="operational-fields">
              <label>Linha no TOTVS<input maxLength={80} value={item.externalLineReference}
                onChange={event => updateItem(index, { externalLineReference: event.target.value })} /></label>
              <label>Produto<select required value={item.productCode} onChange={event => {
                const product = products.find(option => option.code === event.target.value);
                updateItem(index, { productCode: product?.code ?? "", description: product?.name ?? "" });
              }}><option value="">Selecione um produto</option>
                {!products.some(product => product.code === item.productCode) && item.productCode &&
                  <option value={item.productCode}>{item.description || item.productCode} (valor atual)</option>}
                {products.map(product => <option key={product.code} value={product.code}>{product.name}</option>)}
              </select></label>
              <label>Código do produto<input readOnly value={item.productCode} placeholder="Preenchido pelo produto selecionado" /></label>
              <label>Descrição<input readOnly value={item.description} placeholder="Preenchida pelo produto selecionado" /></label>
              <label>Quantidade pedida<input required inputMode="decimal" value={item.orderedQuantity}
                onChange={event => updateItem(index, { orderedQuantity: event.target.value })} placeholder="Ex.: 100 ou 100,5" /></label>
              <label>Unidade<input required maxLength={32} value={item.unit}
                onChange={event => updateItem(index, { unit: event.target.value })} placeholder="Ex.: PC" /></label>
              <label>Preço unitário<input inputMode="decimal" value={item.unitPrice}
                onChange={event => updateItem(index, { unitPrice: event.target.value })} /></label>
              <label>Moeda do preço<OperationalOptionSelect entity="currency" value={item.currency} values={options}
                onChange={currency => updateItem(index, { currency })} /></label>
            </div>
            <h4>Planejamento e acompanhamento deste produto</h4>
            <OperationalFieldsEditor fields={purchaseOrderItemFields} values={item.operational} options={options}
              setValues={operational => updateItem(index, { operational })} />
          </article>)}
        </section>

        <section className="card po-entry-section">
          <h2>Confirmação</h2>
          <p className="muted">Total do produto, prazos, diferenças e alertas serão calculados a partir dos dados preenchidos.</p>
          <label>Motivo do cadastro<textarea required minLength={3} maxLength={1000} value={reason}
            onChange={event => setReason(event.target.value)} placeholder="Ex.: transcrito do pedido aprovado no TOTVS" /></label>
          {createdPoId && <p className="notice error">A PO já foi criada. <Link className="text-link" href={`/purchase-orders/${createdPoId}`}>Abrir a PO e continuar o preenchimento</Link>.</p>}
          <button className="button" disabled={saving || !importer || Boolean(createdPoId)}>
            {saving ? "Salvando pedido e produtos…" : "Salvar PO e produtos"}
          </button>
        </section>
      </> : <section className="card">
        <label>Importadora<select required value={importer} onChange={event => setImporter(event.target.value)}>
          <option value="">Selecione</option>{importers.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>Número do IP<input required maxLength={80} value={number} onChange={event => setNumber(event.target.value)} /></label>
        <label>Status logístico<OperationalOptionSelect entity="logistics_status" value={status} values={options} onChange={setStatus} /></label>
        <label>Prioridade<input maxLength={20} value={priority} onChange={event => setPriority(event.target.value)} /></label>
        <label>Observações<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <label>Motivo do cadastro<textarea required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button className="button" disabled={saving || !importer}>{saving ? "Salvando…" : "Salvar IP"}</button>
      </section>}
    </form>}
  </main>;
}
