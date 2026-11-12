import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { invoiceSaveIpNumber, invoiceSystemIp } from "../lib/china-invoice-mapping.ts";
import { invoicePortSuggestion } from "../lib/invoice-ports.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

// Phase B1 of docs/PLANO_INVOICE_IP_AUDITORIA_DISTRIBUICAO.md (user decisions, 2026-11-12): the IP created or revised from an
// invoice gets the transport mode and the port codes of the operational lists, and an IPH invoice revises the IP that the
// Follow Up load keeps without the prefix.

const source = path => readFile(new URL(path, import.meta.url), "utf8");
// The lists of erp_po_totvs_hml on 2026-11-12 (catalog.operational_value).
const loadingList = ["China", "HGH", "HKG", "NGB", "SGH", "SH", "SHA", "SHEKOU (CHINA)", "SHG", "SUECIA"];
const dischargeList = ["Curitiba", "FOR", "Fortaleza", "Fortaleza - CE", "Paranaguá", "PEC", "Pecém", "Pecem - CE", "PNG", "SSZ", "VCP"];

test("the invoice port text suggests the listed port code the Follow Up uses", () => {
  // IPH037D: the invoice says NINGBO,CHINA and PECEM,BRASIL; the Follow Up kept NGB and PEC.
  assert.equal(invoicePortSuggestion("NINGBO,CHINA", "loading", loadingList), "NGB");
  assert.equal(invoicePortSuggestion("PECEM,BRASIL", "discharge", dischargeList), "PEC");
  assert.equal(invoicePortSuggestion(" Ningbo, China ", "loading", loadingList), "NGB");
  assert.equal(invoicePortSuggestion("SHANGHAI, CHINA", "loading", loadingList), "SGH");
  assert.equal(invoicePortSuggestion("SHANG HAI", "loading", loadingList), "SGH");
  assert.equal(invoicePortSuggestion("SHEKOU, SHENZHEN", "loading", loadingList), "SHEKOU (CHINA)");
  assert.equal(invoicePortSuggestion("HONGKONG", "loading", loadingList), "HKG");
  assert.equal(invoicePortSuggestion("HANGZHOU", "loading", loadingList), "HGH");
  assert.equal(invoicePortSuggestion("Pecém - CE, Brazil", "discharge", dischargeList), "PEC");
  assert.equal(invoicePortSuggestion("FORTALEZA,BRAZIL", "discharge", dischargeList), "FOR");
  assert.equal(invoicePortSuggestion("PARANAGUÁ", "discharge", dischargeList), "PNG");
  assert.equal(invoicePortSuggestion("SANTOS", "discharge", dischargeList), "SSZ");
  assert.equal(invoicePortSuggestion("VIRACOPOS AIRPORT", "discharge", dischargeList), "VCP");
  // A text that is already a listed value.
  assert.equal(invoicePortSuggestion("ngb", "loading", loadingList), "NGB");
  assert.equal(invoicePortSuggestion("Curitiba", "discharge", dischargeList), "Curitiba");
  // Nothing is suggested for an unknown city, two cities, the wrong side, a code missing from the list or no text.
  assert.equal(invoicePortSuggestion("ROTTERDAM", "loading", loadingList), "");
  assert.equal(invoicePortSuggestion("NINGBO OR SHANGHAI", "loading", loadingList), "");
  assert.equal(invoicePortSuggestion("NINGBO,CHINA", "discharge", dischargeList), "");
  assert.equal(invoicePortSuggestion("NINGBO,CHINA", "loading", ["SGH"]), "");
  assert.equal(invoicePortSuggestion("", "loading", loadingList), "");
  assert.equal(invoicePortSuggestion("CHINA", "loading", loadingList), "China");
});

test("the invoice saves into the IP the Follow Up keeps without IPH, which the audit also reads", () => {
  const followUp = [{ ipNumber: "034C/2026", recordStatus: "ACTIVE" }];
  assert.equal(invoiceSaveIpNumber("IPH034C/2026", followUp), "034C/2026");
  assert.equal(invoiceSystemIp("IPH034C/2026", followUp), "034C/2026");
  // The test of 2026-11-12: 037D/2026 was cancelled and IPH037D/2026 created from the audited invoice.
  const afterTest = [{ ipNumber: "037D/2026", recordStatus: "CANCELLED" }, { ipNumber: "IPH037D/2026", recordStatus: "ACTIVE" }];
  assert.equal(invoiceSaveIpNumber("IPH037D/2026", afterTest), "IPH037D/2026");
  // A cancelled IP without the prefix does not take the invoice: a new IPH IP is created.
  assert.equal(invoiceSaveIpNumber("IPH037D/2026", [afterTest[0]]), "IPH037D/2026");
  assert.equal(invoiceSaveIpNumber("IPH099A/2026", followUp), "IPH099A/2026");
});

test("the IP screen sends the mode and ports chosen and saves into the IP of the system", async () => {
  const screen = await source("../components/NewOperationalRecord.tsx");
  assert.match(screen, /import \{ invoicePortSuggestion \} from "\.\.\/lib\/invoice-ports";/u);
  // One lookup for the invoice IP: the processes of the importer with or without IPH, then the saving rule.
  assert.match(screen, /ipNumber: invoiceIpSearchText\(invoiceIp\)/u);
  assert.match(screen, /const ipNumber = invoiceSaveIpNumber\(invoiceIp, existing\.items\);/u);
  assert.equal((screen.match(/await loadInvoiceProcess\(/gu) ?? []).length, 2);
  // The balances, the duplicate check and the saved IP use the IP of the system, never the invoice spelling.
  assert.doesNotMatch(screen, /loadInvoiceCandidates\([^)]*\.ipNumber/u);
  assert.match(screen, /loadInvoicePreflight\(invoiceImporter, draft, systemIp\)/u);
  assert.match(screen, /loadInvoicePreflight\(importer, invoiceDraft, invoiceIpNumber\)/u);
  assert.match(screen, /ipNumber: invoiceIpNumber \|\| invoiceDraft\.ipNumber\.trim\(\), logisticsStatus: null,\s+transportMode,/u);
  assert.match(screen, /portLoading: portLoading \|\| null, portDischarge: portDischarge \|\| null,/u);
  assert.match(screen, /ipNumberFromInvoice: invoiceDraft\.ipNumber,/u);
  // A review opened from an IP accepts the invoice whose IPH number is that IP.
  assert.match(screen, /invoiceSaveIpNumber\(draft\.ipNumber, \[reviewTarget\]\)/u);
  // The fields: mode required, ports from the lists, suggested from the invoice text, the IP values first on a revision.
  assert.match(screen, /<OperationalOptionSelect required entity="transport_mode" value=\{transportMode\}/u);
  assert.match(screen, /<OperationalOptionSelect entity="port_loading" value=\{portLoading\}/u);
  assert.match(screen, /<OperationalOptionSelect entity="port_discharge" value=\{portDischarge\}/u);
  assert.match(screen, /existing\?\.portLoading \|\| invoicePortSuggestion\(draft\.originText, "loading"/u);
  assert.match(screen, /existing\?\.portDischarge \|\| invoicePortSuggestion\(draft\.destinationText, "discharge"/u);
  assert.match(screen, /\|\| !transportMode/u);
  // The status shown stays the one calculated from the IP dates (af2f77b).
  assert.match(screen, /<label>\{t\.logisticsStatus\}<input readOnly value="WAITING SHIPMENT" \/><\/label>/u);
});

test("the IP fields have their texts in the three languages", () => {
  for (const messages of [ptBR, en, zhCN]) {
    const t = messages.newRecord;
    for (const key of ["transportMode", "portLoading", "portDischarge"]) assert.ok(t[key]?.trim(), key);
    assert.match(t.portFromInvoice("NINGBO,CHINA"), /NINGBO,CHINA/u);
    assert.match(t.revisesSystemIp("037D/2026", "IPH037D/2026"), /037D\/2026.*IPH037D\/2026|IPH037D\/2026.*037D\/2026/u);
  }
});
