import type { ManufacturerList, ProductDatabase } from "./audit-reference-xlsx";

/**
 * Loads of the product DATABASE and of the manufacturer list (stage 1f of docs/PLANO_AUDITORIA_INVOICE_AVULSA.md).
 * The browser reads the spreadsheet with the audit readers and sends only the rows; the API keeps them, as they
 * are, as the reference of the invoice audit and enriches the catalog with them.
 */
export type ReferenceLoadKind = "PRODUCT_DATABASE" | "MANUFACTURER_LIST";

export type ReferenceLoadPayload =
  | { kind: "PRODUCT_DATABASE"; fileName: string; fileSha256: string; duplicated: number;
    rows: { sourceRow: number; productCode: string; description: string; ncm: string }[] }
  | { kind: "MANUFACTURER_LIST"; fileName: string; fileSha256: string;
    rows: { sourceRow: number; name: string; address: string; country: string; code: string }[] };

export function productDatabasePayload(database: ProductDatabase): ReferenceLoadPayload {
  return { kind: "PRODUCT_DATABASE", fileName: database.fileName, fileSha256: database.fileSha256,
    duplicated: database.duplicated, rows: database.products.map(({ sourceRow, productCode, description, ncm }) =>
      ({ sourceRow, productCode, description, ncm })) };
}

export function manufacturerListPayload(list: ManufacturerList): ReferenceLoadPayload {
  return { kind: "MANUFACTURER_LIST", fileName: list.fileName, fileSha256: list.fileSha256,
    rows: list.manufacturers.map(({ sourceRow, name, address, country, code }) => ({ sourceRow, name, address, country, code })) };
}

export type ReferenceLoadMeta = { id: string; kind: ReferenceLoadKind; fileName: string; fileSha256: string;
  rowCount: number; loadedAt: string; loadedBy: string };

export type RefusedReferenceRow = { sourceRow: number; reason: "CODE_MISSING" | "DESCRIPTION_MISSING" | "NCM_INVALID"
  | "CODE_REPEATED" | "ROW_REPEATED" | "CONTENT_MISSING" };

export type ProductLoadSummary = { rows: number; duplicated: number; created: number; createdCodes: string[];
  updated: number; unchanged: number; descriptionChanged: number; ncmFilled: number;
  ncmChanged: { productCode: string; from: string; to: string }[] };
export type ManufacturerLoadSummary = { rows: number; created: number; createdCodes: string[]; updated: number;
  unchanged: number; withoutTotvsCode: { sourceRow: number; code: string; name: string }[];
  repeatedCodes: { sourceRow: number; code: string }[]; ambiguousCodes: string[];
  nameDifferences: { code: string; listName: string; catalogName: string }[] };

export type PendingNcm = { code: string; status: "OFFICIAL_VALID" | "OFFICIAL_NOT_VALID" | "NOT_IN_OFFICIAL";
  officialName: string | null; products: number };

export type ReferenceLoadPreview = { kind: ReferenceLoadKind; refused: RefusedReferenceRow[];
  summary: ProductLoadSummary | ManufacturerLoadSummary; ncms: PendingNcm[]; sameAsLatest: boolean };
export type ReferenceLoadResult = { alreadyLoaded: boolean; load: ReferenceLoadMeta;
  summary: ProductLoadSummary | ManufacturerLoadSummary };

/** The reference of the invoice audit: the rows of the latest load of each kind, in the shape of the readers. */
export type AuditReferenceLoad = { loadId: string; loadedAt: string; loadedBy: string };
export type AuditReference = {
  productDatabase: (ProductDatabase & AuditReferenceLoad) | null;
  manufacturerList: (ManufacturerList & AuditReferenceLoad) | null;
};

/** The NCMs that the official catalog route can register without downloading the catalog. */
export function registrableNcms(ncms: readonly PendingNcm[]): string[] {
  return ncms.filter(ncm => ncm.status === "OFFICIAL_VALID").map(ncm => ncm.code);
}
