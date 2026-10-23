import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

// Screens still being translated. Remove each file from this list when it moves to the dictionaries.
const pending = new Set([
  "app/admin/outbox/page.tsx",
  "app/admin/users/page.tsx",
  "app/catalog/page.tsx",
  "app/catalog/values/NcmTaxTreatments.tsx",
  "app/catalog/values/page.tsx",
  "app/page.tsx",
  "app/pcm/page.tsx",
  "app/quality/page.tsx",
  "app/requests/page.tsx",
  "app/requests/[id]/page.tsx",
  "app/source-audit/page.tsx",
  "components/DeletedPurchaseOrderActions.tsx",
  "components/E2eFlowDemo.tsx",
  "components/FollowupPanel.tsx",
  "components/IpCalculatedSummary.tsx",
  "components/LegacyQueue.tsx",
  "components/NewOperationalRecord.tsx",
  "components/OperationalOptionSelect.tsx",
  "components/OperationalPoPanel.tsx",
  "components/ProcessDirectory.tsx",
  "components/ProcessPostShipmentPanel.tsx",
  "components/ProcessWorkspace.tsx",
  "components/ProductLinesView.tsx",
  "components/PurchaseOrderCalculatedFields.tsx",
  "components/PurchaseOrderItemFields.tsx",
  "components/PurchaseOrderScLink.tsx",
  "components/PurchaseOrderWorkspace.tsx",
  "components/PurchaseRequestSelect.tsx",
  "components/ReportsView.tsx",
  "components/SearchableSelect.tsx",
  "components/ShippedChangeConfirmation.tsx",
]);

async function tsxFiles(directory) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? tsxFiles(`${directory}${entry.name}/`)
    : entry.name.endsWith(".tsx") ? [`${directory}${entry.name}`] : []));
  return nested.flat();
}

// Brand names stay the same in every language.
const brandNames = new Set(["ERP Comex", "Supply Chain", "TMS", "Eletra Energy Solutions"]);

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'`])\/\/.*$/gmu, "$1");
}

/** Finds user-facing text written directly in a component instead of coming from the dictionaries. */
export function findHardcodedTexts(code) {
  const lines = code.split(/\r?\n/u).filter(line => !line.includes("i18n-ignore"));
  const body = stripComments(lines.join("\n"));
  const found = [];
  for (const match of body.matchAll(/>([^<>{}=;&|()]*[A-Za-zÀ-ÿ]{3,}[^<>{}=;&|()]*)<(\/?)/gu)) {
    const text = match[1].trim();
    // `,\n  key:` comes from JSX values in object literals; a single word before `<x` is a TS generic.
    if (text.startsWith(",") || brandNames.has(text) || (/^\w+$/u.test(text) && !match[2])) continue;
    if (/[a-zà-ÿ]{2}/u.test(text)) found.push(text);
  }
  for (const match of body.matchAll(/\b(?:aria-label|placeholder|title|alt|label)="([^"]*)"/gu)) {
    if (/[a-zà-ÿ]{3}/u.test(match[1]) && !brandNames.has(match[1])) found.push(match[1]);
  }
  for (const match of body.matchAll(/(["'`])((?:(?!\1)[^\n\\]|\\.)*)\1/gu)) {
    if (/[ãõçáéíóúâêôàü]/iu.test(match[2]) && /[a-zà-ÿ]{2}/u.test(match[2])) found.push(match[2]);
  }
  return found;
}

test("the scanner flags loose Portuguese text and accepts dictionary lookups", () => {
  assert.deepEqual(findHardcodedTexts("<p>Carregando dados</p>"), ["Carregando dados"]);
  assert.deepEqual(findHardcodedTexts('<input placeholder="Buscar produto" />'), ["Buscar produto"]);
  assert.deepEqual(findHardcodedTexts('setError("Não foi possível salvar.");'), ["Não foi possível salvar."]);
  assert.deepEqual(findHardcodedTexts("<p>{t.loading}</p><span>PO</span><b>ETA</b>"), []);
  assert.deepEqual(findHardcodedTexts("<dt>Status</dt>"), ["Status"]);
  assert.deepEqual(findHardcodedTexts("async function load(): Promise<void> {}"), []);
  assert.deepEqual(findHardcodedTexts('<p className="eyebrow">ERP Comex</p><img alt="Eletra Energy Solutions" />'), []);
  assert.deepEqual(findHardcodedTexts("const icons = { a: <><path /></>,\n  ship: <><path /></> };"), []);
  assert.deepEqual(findHardcodedTexts('status === "AGUARDANDO PRODUÇÃO"'), []);
  assert.deepEqual(findHardcodedTexts('const api = "Senha atual inválida."; // i18n-ignore: API contract'), []);
});

test("every screen takes its texts from the dictionaries", async () => {
  const files = [...await tsxFiles("app/"), ...await tsxFiles("components/")];
  const offenders = [];
  for (const file of files) {
    if (pending.has(file)) continue;
    const texts = findHardcodedTexts(await readFile(new URL(file, root), "utf8"));
    if (texts.length) offenders.push(`${file}: ${texts.slice(0, 5).join(" | ")}`);
  }
  assert.deepEqual(offenders, []);
});
