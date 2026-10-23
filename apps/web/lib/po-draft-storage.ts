import type { Messages } from "./i18n/pt-BR";

const poDraftStorageLimitBytes = 4 * 1024 * 1024;

type SessionStorageWriter = Pick<Storage, "setItem" | "removeItem">;

function removeDraft(storage: SessionStorageWriter, key: string): void {
  try { storage.removeItem(key); } catch { /* Keep the storage warning if removal is unavailable. */ }
}

function saveCompactDraft(storage: SessionStorageWriter, key: string, compact: string, warning: string,
  m: Messages): string {
  try {
    storage.setItem(key, compact);
    return warning;
  } catch {
    removeDraft(storage, key);
    return m.poDraft.failed;
  }
}

export function persistSessionDraft(
  storage: SessionStorageWriter,
  key: string,
  draft: unknown,
  compactDraft: unknown,
  m: Messages,
): string {
  const serialized = JSON.stringify(draft);
  const compact = JSON.stringify(compactDraft);
  const serializedBytes = new TextEncoder().encode(serialized).byteLength;

  if (serializedBytes > poDraftStorageLimitBytes) {
    return saveCompactDraft(storage, key, compact, m.poDraft.tooLarge, m);
  }

  try {
    storage.setItem(key, serialized);
    return "";
  } catch {
    return saveCompactDraft(storage, key, compact, m.poDraft.storageExceeded, m);
  }
}
