const poDraftStorageLimitBytes = 4 * 1024 * 1024;

type SessionStorageWriter = Pick<Storage, "setItem" | "removeItem">;

function removeDraft(storage: SessionStorageWriter, key: string): void {
  try { storage.removeItem(key); } catch { /* Keep the storage warning if removal is unavailable. */ }
}

function saveCompactDraft(storage: SessionStorageWriter, key: string, compact: string, warning: string): string {
  try {
    storage.setItem(key, compact);
    return warning;
  } catch {
    removeDraft(storage, key);
    return "Não foi possível guardar o rascunho neste navegador.";
  }
}

export function persistSessionDraft(
  storage: SessionStorageWriter,
  key: string,
  draft: unknown,
  compactDraft: unknown,
): string {
  const serialized = JSON.stringify(draft);
  const compact = JSON.stringify(compactDraft);
  const serializedBytes = new TextEncoder().encode(serialized).byteLength;

  if (serializedBytes > poDraftStorageLimitBytes) {
    return saveCompactDraft(storage, key, compact,
      "O rascunho excedeu 4 MB. Os campos de acompanhamento dos itens não foram guardados nesta sessão.");
  }

  try {
    storage.setItem(key, serialized);
    return "";
  } catch {
    return saveCompactDraft(storage, key, compact,
      "O espaço do navegador foi excedido. Os campos de acompanhamento dos itens não foram guardados nesta sessão.");
  }
}
