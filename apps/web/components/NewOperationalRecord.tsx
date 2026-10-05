"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";

const poRoles = new Set(["Master", "Administrador", "Importação", "Compras"]);
const ipRoles = new Set(["Master", "Administrador", "Importação"]);

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

  useEffect(() => {
    Promise.all([apiFetch("/auth/me"), apiFetch("/api/v1/importers")])
      .then(async ([identity, list]) => {
        if (!identity.ok || !list.ok) throw new Error("Não foi possível consultar suas permissões e importadoras.");
        const user = await identity.json() as { roles: string[] };
        const data = await list.json() as { items: Array<{ code: string }> };
        setRoles(user.roles);
        setImporters(data.items.map(item => item.code));
        if (data.items[0]) setImporter(data.items[0].code);
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : "Erro inesperado."))
      .finally(() => setLoading(false));
  }, []);

  const allowed = roles.some(role => (kind === "po" ? poRoles : ipRoles).has(role));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const path = kind === "po" ? "/api/v1/purchase-orders" : "/api/v1/processes";
      const body = kind === "po"
        ? { importer, number, supplierText: supplier || null, orderDate: orderDate || null, notes, reason }
        : { importer, ipNumber: number, logisticsStatus: status || null, priority: priority || null, notes, reason };
      const response = await apiFetch(path, { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body) });
      const result = await response.json() as { id?: string; detail?: string };
      if (!response.ok || !result.id) throw new Error(result.detail || "Não foi possível salvar.");
      router.push(kind === "po" ? `/purchase-orders/${result.id}` : `/processes/${result.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setSaving(false); }
  }

  return <main className="shell">
    <Link className="back" href={kind === "po" ? "/" : "/processes"}>← Voltar</Link>
    <header className="page-header"><p className="eyebrow">Registro operacional</p>
      <h1>{kind === "po" ? "Cadastrar PO do TOTVS" : "Criar IP"}</h1>
      <p>{kind === "po" ? "Transcreva a referência do pedido. Após salvar, cadastre seus itens e distribua as quantidades entre os IPs." : "Cadastre o processo de importação. Ele poderá receber itens de várias POs da mesma importadora."}</p>
    </header>
    {loading && <p role="status">Carregando…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {!loading && !allowed && <p className="notice">Seu perfil não permite criar {kind === "po" ? "POs" : "IPs"}.</p>}
    {!loading && allowed && <section className="card">
      <form className="stack-form" onSubmit={submit}>
        <label>Importadora<select required value={importer} onChange={event => setImporter(event.target.value)}>
          <option value="">Selecione</option>{importers.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>{kind === "po" ? "Número da PO no TOTVS" : "Número do IP"}
          <input required maxLength={80} value={number} onChange={event => setNumber(event.target.value)} /></label>
        {kind === "po" ? <>
          <label>Fornecedor informado<input maxLength={240} value={supplier} onChange={event => setSupplier(event.target.value)} /></label>
          <label>Data da PO<input type="date" value={orderDate} onChange={event => setOrderDate(event.target.value)} /></label>
        </> : <>
          <label>Status logístico<input maxLength={40} value={status} onChange={event => setStatus(event.target.value)} /></label>
          <label>Prioridade<input maxLength={20} value={priority} onChange={event => setPriority(event.target.value)} /></label>
        </>}
        <label>Observações<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <label>Motivo do registro<textarea required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button className="button" disabled={saving || !importer}>{saving ? "Salvando…" : "Salvar"}</button>
      </form>
    </section>}
  </main>;
}
