const storageKey = "new-operational-record:invoice-command:v1";

type CommandStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function invoiceCommandKey(storage: CommandStorage, payload: unknown,
  generate: () => string = () => crypto.randomUUID()): string {
  const serialized = JSON.stringify(payload);
  try {
    const previous = JSON.parse(storage.getItem(storageKey) ?? "null") as { payload?: unknown; key?: unknown } | null;
    if (previous && previous.payload === serialized && typeof previous.key === "string") return previous.key;
  } catch { /* A chave será recriada. */ }
  const key = generate();
  storage.setItem(storageKey, JSON.stringify({ payload: serialized, key }));
  return key;
}

export function clearInvoiceCommandKey(storage: CommandStorage): void {
  storage.removeItem(storageKey);
}
