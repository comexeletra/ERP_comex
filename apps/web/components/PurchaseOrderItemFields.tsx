"use client";

import { OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";

export type OperationalField = {
  key: string;
  label: string;
  type?: "date" | "number" | "money" | "boolean" | "select";
  max?: number;
  entity?: string;
};

export type OperationalFieldDraft = Record<string, string>;

export const purchaseOrderItemFields: OperationalField[] = [
  { key: "necessityDate", label: "Data de necessidade", type: "date" },
  { key: "priority", label: "Prioridade", max: 20 },
  { key: "demand", label: "Demanda", type: "select", entity: "demand" },
  { key: "requester", label: "Solicitante", max: 160 },
  { key: "scNumber", label: "Número da SC no TOTVS", max: 80 },
  { key: "scApprovalDate", label: "Data de aprovação da SC", type: "date" },
  { key: "purpose", label: "Finalidade", type: "select", entity: "purpose" },
  { key: "costCenter", label: "Centro de custo", max: 80 },
  { key: "draftPo", label: "Número da Draft PO", max: 80 },
  { key: "poApprovalDate", label: "Data de aprovação da PO", type: "date" },
  { key: "poSentDate", label: "Data de envio da PO", type: "date" },
  { key: "category", label: "Categoria", type: "select", entity: "category" },
  { key: "productGroup", label: "Grupo do produto", type: "select", entity: "product_group" },
  { key: "ncm", label: "NCM", max: 16 },
  { key: "remarks", label: "Observações do item", max: 4000 },
  { key: "commercialPlanReceivedDate", label: "Data de recebimento do plano comercial", type: "date" },
  { key: "mrpCompletedDate", label: "Data de conclusão do MRP", type: "date" },
  { key: "targetMrpDays", label: "Meta MRP (dias)", type: "number" },
  { key: "targetOrderDays", label: "Meta do pedido (dias)", type: "number" },
  { key: "targetShipmentDays", label: "Meta de embarque (dias)", type: "number" },
  { key: "targetPortDays", label: "Meta até o porto (dias)", type: "number" },
  { key: "targetTransitDays", label: "Meta de trânsito (dias)", type: "number" },
  { key: "targetCustomsDays", label: "Meta de desembaraço (dias)", type: "number" },
  { key: "actualFactoryShipDate", label: "Data de saída da fábrica", type: "date" },
  { key: "actualPortDepartureDate", label: "Data de saída do porto de origem", type: "date" },
];

const sharedItemFieldKeys = new Set([
  "necessityDate", "requester", "scNumber", "scApprovalDate", "purpose",
  "commercialPlanReceivedDate", "mrpCompletedDate", "poApprovalDate", "poSentDate",
]);
export const purchaseOrderCommonItemFields = purchaseOrderItemFields.filter(field => sharedItemFieldKeys.has(field.key));
export const purchaseOrderSpecificItemFields = purchaseOrderItemFields.filter(field => !sharedItemFieldKeys.has(field.key));

export function blankPurchaseOrderItemFields(): OperationalFieldDraft {
  return Object.fromEntries(purchaseOrderItemFields.map(field => [field.key, ""]));
}

export function purchaseOrderItemFieldsPayload(values: OperationalFieldDraft, includeEmpty = false,
  fields: OperationalField[] = purchaseOrderItemFields) {
  return fields.reduce<Record<string, string | number | null>>((payload, field) => {
    const value = values[field.key]?.trim() ?? "";
    if (!value && !includeEmpty) return payload;
    payload[field.key] = !value ? null : field.type === "number" ? Number(value) : value;
    return payload;
  }, {});
}

export function OperationalFieldsEditor({ fields, values, setValues, options }:
  { fields: OperationalField[]; values: OperationalFieldDraft; setValues: (value: OperationalFieldDraft) => void;
    options: OperationalOption[] }) {
  return <div className="operational-fields">{fields.map(field => <label key={field.key}>{field.label}
    {field.type === "boolean" ? <select value={values[field.key] ?? ""} onChange={event => setValues({ ...values, [field.key]: event.target.value })}>
      <option value="">Não informado</option><option value="true">Sim</option><option value="false">Não</option></select> :
      field.type === "select" ? <OperationalOptionSelect entity={field.entity ?? ""} value={values[field.key] ?? ""} values={options}
        onChange={value => setValues({ ...values, [field.key]: value })} /> :
      <input type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
        min={field.type === "number" ? 0 : undefined} maxLength={field.max}
        inputMode={field.type === "money" ? "decimal" : undefined}
        value={values[field.key] ?? ""} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />}</label>)}</div>;
}
