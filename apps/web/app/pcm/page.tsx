"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../../lib/api";
import { automaticAuditReason } from "../../lib/audit";
import { PurchaseRequestChoice } from "../../components/PurchaseRequestSelect";

type Importer = { code: string };

export default function PcmPage() {
  const [roles, setRoles] = useState<string[]>([]);
  const [importers, setImporters] = useState<Importer[]>([]);
  const [importer, setImporter] = useState("");
  const [items, setItems] = useState<PurchaseRequestChoice[]>([]);
  const [scNumber, setScNumber] = useState("");
  const [scDate, setScDate] = useState("");
  const [requester, setRequester] = useState("");
  const [commercialPlanReceivedDate, setCommercialPlanReceivedDate] = useState("");
  const [approvalDate, setApprovalDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage = roles.some(role => ["Master", "Administrador", "PCM"].includes(role));

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch("/auth/me", { signal: controller.signal }),
      apiFetch("/api/v1/importers", { signal: controller.signal }),
    ]).then(async ([identityResponse, importersResponse]) => {
      const identity = await readApiJson<{ roles: string[] }>(identityResponse);
      const result = await readApiJson<{ items: Importer[] }>(importersResponse);
      if (controller.signal.aborted) return;
      setRoles(identity.roles);
      setImporters(result.items);
      if (result.items[0]) setImporter(current => current || result.items[0].code);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os dados do PCM.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!importer) { setItems([]); return; }
    const controller = new AbortController();
    apiFetch(`/api/v1/purchase-requests?importer=${encodeURIComponent(importer)}`, { signal: controller.signal, cache: "no-store" })
      .then(response => readApiJson<{ items: PurchaseRequestChoice[] }>(response))
      .then(result => { if (!controller.signal.aborted) setItems(result.items); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível consultar as SCs."); });
    return () => controller.abort();
  }, [importer]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/purchase-requests", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ importer, scNumber, scDate: scDate || null, requester,
          commercialPlanReceivedDate: commercialPlanReceivedDate || null,
          approvalDate: approvalDate || null, reason: automaticAuditReason }),
      });
      const created = await readApiJson<PurchaseRequestChoice>(response);
      setScNumber(""); setScDate(""); setRequester(""); setCommercialPlanReceivedDate(""); setApprovalDate("");
      const query = new URLSearchParams({ importer });
      const list = await readApiJson<{ items: PurchaseRequestChoice[] }>(
        await apiFetch(`/api/v1/purchase-requests?${query}`, { cache: "no-store" }));
      setItems(list.items);
      setNotice(`SC ${created.scNumber} cadastrada. Ela já pode ser vinculada às POs desta importadora.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível cadastrar a SC.");
    } finally { setSaving(false); }
  }

  return <main className="shell">
    <header className="page-header">
      <p className="eyebrow">PCM · Planejamento e Controle de Materiais</p>
      <h1>Solicitações de Compra</h1>
      <p>Cadastre a SC e os dados do plano comercial. Ao selecionar essa SC em uma PO, os dados serão exibidos em todas as POs vinculadas.</p>
    </header>
    {loading && <p role="status">Carregando o PCM…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!loading && !canManage && <p className="notice">Seu perfil pode consultar SCs, mas não pode cadastrá-las. Solicite o perfil PCM a um Master.</p>}
    {!loading && canManage && <section className="card">
      <h2>Cadastrar SC</h2>
      <form className="stack-form" onSubmit={create}>
        <div className="operational-fields">
          <label>Importadora<select required value={importer} onChange={event => setImporter(event.target.value)}>
            <option value="">Selecione</option>{importers.map(item => <option key={item.code} value={item.code}>{item.code}</option>)}
          </select></label>
          <label>Número da SC<input required maxLength={80} value={scNumber} onChange={event => setScNumber(event.target.value)} /></label>
          <label>Data da SC<input required type="date" value={scDate} onChange={event => setScDate(event.target.value)} /></label>
          <label>Data de recebimento do plano comercial<input type="date" value={commercialPlanReceivedDate}
            onChange={event => setCommercialPlanReceivedDate(event.target.value)} /></label>
          <label>Solicitante<input required maxLength={160} value={requester} onChange={event => setRequester(event.target.value)} /></label>
          <label>Data de aprovação<input type="date" value={approvalDate} onChange={event => setApprovalDate(event.target.value)} /></label>
        </div>
        <button className="button" disabled={saving || !importer}>{saving ? "Salvando SC…" : "Cadastrar SC"}</button>
      </form>
    </section>}
    {!loading && <section className="card">
      <h2>SCs cadastradas</h2>
      <label>Importadora da lista<select value={importer} onChange={event => setImporter(event.target.value)}>
        <option value="">Selecione</option>{importers.map(item => <option key={item.code} value={item.code}>{item.code}</option>)}
      </select></label>
      {items.length === 0 ? <p>Nenhuma SC cadastrada para esta importadora.</p> :
        <div className="table-scroll"><table><thead><tr>
          <th>Número da SC</th><th>Data da SC</th><th>Solicitante</th><th>Plano comercial recebido</th><th>Aprovação</th><th>POs vinculadas</th>
        </tr></thead><tbody>{items.map(item => <tr key={item.id}>
          <td>{item.scNumber}</td><td>{item.scDate ?? "—"}</td><td>{item.requester}</td><td>{item.commercialPlanReceivedDate ?? "—"}</td>
          <td>{item.approvalDate ?? "Pendente"}</td><td>{item.purchaseOrderCount ?? 0}</td>
        </tr>)}</tbody></table></div>}
    </section>}
  </main>;
}
