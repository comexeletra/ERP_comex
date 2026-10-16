export type ProductCatalogImport = { code: string; description: string };

const MAX_PRODUCTS_PER_IMPORT = 500;

export function parseProductCatalogJson(text: string): ProductCatalogImport[] {
  const parsed: unknown = JSON.parse(text);
  const records = Array.isArray(parsed) ? parsed
    : typeof parsed === "object" && parsed !== null && "products" in parsed
      ? (parsed as { products: unknown }).products : null;

  if (!Array.isArray(records) || records.length === 0 || records.length > MAX_PRODUCTS_PER_IMPORT) {
    throw new Error("Use uma lista JSON ou um objeto { \"products\": [...] }, com 1 a 500 produtos.");
  }

  return records.map((record, index) => {
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      throw new Error(`O produto ${index + 1} deve ter código e descrição.`);
    }
    const item = record as Record<string, unknown>;
    const code = typeof item.code === "string" ? item.code.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    if (!code || !description) throw new Error(`O produto ${index + 1} deve ter código e descrição preenchidos.`);
    if (code.length > 120 || description.length > 2000) {
      throw new Error(`O código do produto ${index + 1} deve ter até 120 caracteres e a descrição, até 2000.`);
    }
    return { code, description };
  });
}
