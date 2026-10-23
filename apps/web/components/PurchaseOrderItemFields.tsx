"use client";

import { booleanOptions, fieldLabel, type FieldLabelKey } from "../lib/i18n/labels";
import { useI18n } from "./I18nProvider";
import { OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";
import { SearchableSelect } from "./SearchableSelect";

export type OperationalField = {
  key: string;
  labelKey?: FieldLabelKey;
  type?: "date" | "number" | "money" | "boolean" | "select";
  max?: number;
  entity?: string;
};

export type OperationalFieldDraft = Record<string, string>;

export const purchaseOrderItemFields: OperationalField[] = [
  { key: "necessityDate", type: "date" },
  { key: "scNumber", max: 80 },
  { key: "scDate", type: "date" },
  { key: "scApprovalDate", type: "date" },
  { key: "commercialPlanReceivedDate", type: "date" },
  { key: "priority", type: "select", entity: "priority" },
  { key: "demand", type: "select", entity: "demand" },
  { key: "requester", type: "select", entity: "requester" },
  { key: "purpose", type: "select", entity: "purpose" },
  { key: "costCenter", type: "select", entity: "cost_center" },
  { key: "draftPo", max: 80 },
  { key: "poApprovalDate", type: "date" },
  { key: "poSentDate", type: "date" },
  { key: "category", type: "select", entity: "category" },
  { key: "productGroup", type: "select", entity: "product_group" },
  { key: "group", type: "select", entity: "group" },
  { key: "ncm", max: 16 },
  { key: "remarks", max: 4000 },
  { key: "mrpCompletedDate", type: "date" },
  { key: "targetMrpDays", type: "number" },
  { key: "targetOrderDays", type: "number" },
  { key: "targetShipmentDays", type: "number" },
  { key: "targetPortDays", type: "number" },
  { key: "targetTransitDays", type: "number" },
  { key: "targetCustomsDays", type: "number" },
];

const sharedItemFieldKeys = new Set([
  "necessityDate", "scNumber", "scDate", "scApprovalDate", "commercialPlanReceivedDate", "requester",
  "purpose", "mrpCompletedDate", "poApprovalDate", "poSentDate",
]);
export const purchaseOrderCommonItemFields = purchaseOrderItemFields.filter(field => sharedItemFieldKeys.has(field.key));
export const purchaseOrderSpecificItemFields = purchaseOrderItemFields.filter(field => !sharedItemFieldKeys.has(field.key));
export function purchaseOrderSpecificFields(supportsGroup: boolean) {
  return supportsGroup ? purchaseOrderSpecificItemFields
    : purchaseOrderSpecificItemFields.filter(field => field.key !== "group");
}

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

export function OperationalFieldsEditor({ fields, values, setValues, options, readOnlyKeys }:
  { fields: OperationalField[]; values: OperationalFieldDraft; setValues: (value: OperationalFieldDraft) => void;
    options: OperationalOption[]; readOnlyKeys?: ReadonlySet<string> }) {
  const { m } = useI18n();
  return <div className="operational-fields">{fields.map(field => <label key={field.key}>{fieldLabel(m, field)}
    {field.type === "boolean" ? <SearchableSelect ariaLabel={fieldLabel(m, field)} placeholder="" value={values[field.key] ?? ""}
      onChange={value => setValues({ ...values, [field.key]: value })}
      options={booleanOptions(m)} /> :
      field.type === "select" ? <OperationalOptionSelect entity={field.entity ?? ""} value={values[field.key] ?? ""} values={options}
        onChange={value => setValues({ ...values, [field.key]: value })} /> :
      <input type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
        min={field.type === "number" ? 0 : undefined} maxLength={field.max}
        inputMode={field.type === "money" ? "decimal" : undefined}
        readOnly={readOnlyKeys?.has(field.key)} aria-readonly={readOnlyKeys?.has(field.key) || undefined}
        value={values[field.key] ?? ""} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />}</label>)}</div>;
}
