import assert from "node:assert/strict";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { persistSessionDraft } from "../lib/po-draft-storage.ts";

function memoryStorage(shouldFail = () => false) {
  const values = new Map();
  return {
    values,
    setItem(key, value) {
      if (shouldFail(String(value))) throw new Error("QuotaExceededError");
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
  };
}

test("stores the complete purchase order draft when it fits", () => {
  const storage = memoryStorage();
  const full = { number: "030201", items: [{ productCode: "2010100130", operational: { requester: "A" } }] };
  const compact = { ...full, items: [{ productCode: "2010100130", operational: {} }] };

  assert.equal(persistSessionDraft(storage, "po", full, compact, ptBR), "");
  assert.deepEqual(JSON.parse(storage.values.get("po")), full);
});

test("stores a compact draft and warns when the full draft exceeds 4 MB", () => {
  const storage = memoryStorage();
  const full = { number: "030201", notes: "x".repeat(4 * 1024 * 1024 + 1) };
  const compact = { number: "030201", items: [{ operational: {} }] };

  const warning = persistSessionDraft(storage, "po", full, compact, ptBR);

  assert.deepEqual(JSON.parse(storage.values.get("po")), compact);
  assert.match(warning, /excedeu 4 MB/);
  assert.match(warning, /campos de acompanhamento/);
  assert.match(persistSessionDraft(memoryStorage(), "po", full, compact, en), /exceeded 4 MB/);
});

test("falls back to a compact draft when session storage rejects the full draft", () => {
  const compact = { number: "030201", items: [{ operational: {} }] };
  const storage = memoryStorage(value => value.includes('"notes"'));

  const warning = persistSessionDraft(storage, "po", { notes: "large" }, compact, ptBR);

  assert.deepEqual(JSON.parse(storage.values.get("po")), compact);
  assert.match(warning, /espaço do navegador foi excedido/);
});

test("removes a stale draft when even the compact form cannot be stored", () => {
  const storage = memoryStorage(() => true);
  storage.values.set("po", '{"stale":true}');

  const warning = persistSessionDraft(storage, "po", { notes: "draft" }, { items: [] }, ptBR);

  assert.equal(storage.values.has("po"), false);
  assert.match(warning, /Não foi possível guardar o rascunho/);
});
