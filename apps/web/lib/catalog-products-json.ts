import type { Messages } from "./i18n/pt-BR";

export type ProductCatalogImport = { code: string; description: string };

const MAX_PRODUCTS_PER_IMPORT = 500;

export function parseProductCatalogJson(text: string, m: Messages): ProductCatalogImport[] {
  const parsed: unknown = JSON.parse(text);
  const records = Array.isArray(parsed) ? parsed
    : typeof parsed === "object" && parsed !== null && "products" in parsed
      ? (parsed as { products: unknown }).products : null;

  if (!Array.isArray(records) || records.length === 0 || records.length > MAX_PRODUCTS_PER_IMPORT) {
    throw new Error(m.productJson.listRequired);
  }

  return records.map((record, index) => {
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      throw new Error(m.productJson.needsFields(index + 1));
    }
    const item = record as Record<string, unknown>;
    const code = typeof item.code === "string" ? item.code.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    if (!code || !description) throw new Error(m.productJson.fieldsEmpty(index + 1));
    if (code.length > 120 || description.length > 2000) {
      throw new Error(m.productJson.tooLong(index + 1));
    }
    return { code, description };
  });
}
