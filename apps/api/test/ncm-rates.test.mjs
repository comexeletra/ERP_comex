import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { composeIiRate, composeIpiRate, composePisCofinsRate, normalizePercent,
  parseGecexRatesWorkbook, parseTipiWorkbook } from "../dist/ncm-rates.js";

const filler = count => Array.from({ length: count }, (_, index) => {
  const code = String(10_000_000 + index * 7).padStart(8, "0");
  return `${code.slice(0, 4)}.${code.slice(4, 6)}.${code.slice(6)}`;
});

async function gecexWorkbook({ tecRows = [], annexTwo = [], letec = [], lebit = [], dcc = [],
  aeronautical = ["8504.40"], fillers = 9_000, skip = [] } = {}) {
  const workbook = new ExcelJS.Workbook();
  const add = (name, header, rows, preamble = 2) => {
    if (skip.includes(name)) return;
    const sheet = workbook.addWorksheet(name);
    for (let index = 0; index < preamble; index++) sheet.addRow([`${name} — Atualizado até a Resolução Gecex nº 926`]);
    sheet.addRow(header);
    for (const row of rows) sheet.addRow(row);
  };
  add("Anexo I - TEC", ["NCM", "DESCRIÇÃO", "TEC (%)"], [
    ["01.01", "Cavalos", ""], ...tecRows, ...filler(fillers).map(code => [code, "Filler", 2]),
  ], 8);
  add("Anexo II - Diferentes da TEC", ["NCM", "Descrição", "TEC (%)", "BIT/BK",
    "Anexo III da Decisão CMC Nº 08/22 (%)", "Alíquota aplicada (%)", "Fundamentação da alíquota aplicada",
    "Atos de inclusão"], annexTwo);
  add("Anexo III - Setor Aeronáutico", ["NCM", "NCM", "NCM"], [aeronautical, ["* Exceto os compreendidos no subitem 8504.40.10"]], 3);
  const exceptionHeader = ["NCM", "Nº Ex", "Alíquota (%)", "Descrição", "Quota", "Unidade quota",
    "Início de vigência", "Término de vigência", "Ato de inclusão", "Data do ato de inclusão"];
  add("Anexo IV - Desabastecimento", ["NCM", "Nº Ex", "Descrição", "Alíquota (%)", "Quota", "Unidade da quota",
    "Ato de inclusão", "Observações", "Enquadramento Anexo RES. GMC 49/19", "Início de vigência",
    "Término de vigência"], [], 4);
  add("Anexo V - LETEC", exceptionHeader, letec, 4);
  add("Anexo VI - LEBITBK", ["NCM", "Nº EX", "Descrição", "Alíquota (%)", "Quota", "Unidade da quota",
    "Ato de inclusão", "Início de vigência", "Término de vigência"], lebit, 3);
  add("Anexo VIII - Concessões OMC", ["NCM", "Nº EX", "Alíquota (%)", "Descrição", "Quota", "Unidade da Quota",
    "Observação", "Ato de Inclusão", "Início da Vigência"], [], 3);
  add("Anexo IX - DCC", exceptionHeader, dcc, 3);
  add("Anexo X - Automotivos ACE-14", exceptionHeader, [], 4);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function tipiWorkbook(rows, fillers = 9_000) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Tabela Completa");
  sheet.addRow([]);
  sheet.addRow(["TABELA DE INCIDÊNCIA DO IMPOSTO SOBRE PRODUTOS INDUSTRIALIZADOS (TIPI)"]);
  sheet.addRow(["Atualizações: Decreto nº 11.182, de 24 de agosto de 2022; ADE RFB nº 5, de 2026."]);
  sheet.addRow(["NCM", "EX", "DESCRIÇÃO", "ALÍQUOTA (%)"]);
  sheet.addRow(["01.01", "", "Cavalos", ""]);
  for (const row of rows) sheet.addRow(row);
  for (const code of filler(fillers)) sheet.addRow([code, "", "Filler", 0]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

test("percentages are kept as decimal text without binary float noise", () => {
  assert.equal(normalizePercent(7.800000000000001), "7.8");
  assert.equal(normalizePercent("12,6"), "12.6");
  assert.equal(normalizePercent(0), "0");
  assert.equal(normalizePercent(9.75), "9.75");
  assert.throws(() => normalizePercent(-1), /alíquota inválida/u);
  assert.throws(() => normalizePercent("abc"), /alíquota inválida/u);
});

test("Gecex workbook yields TEC, Brazilian rate and dated exceptions with Ex and quota", async () => {
  const parsed = await parseGecexRatesWorkbook(await gecexWorkbook({
    tecRows: [["8504.40.90", "-- Outros", 14], ["8471.30.12", "Portáteis", "12,6BK"], ["0703.20.90", "Alho", 9]],
    annexTwo: [["8504.40.90", "Outros", 14, "", null, 10.8, "Art. 6º", "272/2021"]],
    letec: [
      ["0703.20.90", "-", 35, "Outros", "-", "-", new Date("2022-04-01T00:00:00Z"), "-", "Resolução Gecex nº 318", new Date("2022-03-24T00:00:00Z")],
      ["0303.53.00", 1, 0, "Sardinhas", 60000, "Toneladas", "01/07/2026", new Date("2026-12-31T00:00:00Z"), "Resolução Gecex nº 917", null],
    ],
  }));
  assert.match(parsed.sourceReference, /Gecex nº 926/u);
  assert.ok(parsed.tec.length >= 9_000);
  assert.deepEqual(parsed.tec.find(row => row.code === "84713012"), { code: "84713012", name: "Portáteis", rate: "12.6", marker: "BK" });
  assert.deepEqual(parsed.brazil.find(row => row.code === "85044090"), { code: "85044090", rate: "10.8", basis: "Art. 6º" });
  const sardine = parsed.exceptions.find(row => row.ncm === "03035300");
  assert.deepEqual({ annex: sardine.annex, exNumber: sardine.exNumber, quota: sardine.quota, validFrom: sardine.validFrom,
    validTo: sardine.validTo }, { annex: "V", exNumber: "001", quota: "60000 Toneladas", validFrom: "2026-07-01", validTo: "2026-12-31" });
  assert.deepEqual(parsed.exceptions.find(row => row.annex === "III"), { annex: "III", ncm: "850440", exNumber: null,
    rate: null, quota: null, validFrom: null, validTo: null, act: null, description: null });
});

test("Gecex workbook without an expected annex or with too few NCMs is refused", async () => {
  await assert.rejects(parseGecexRatesWorkbook(await gecexWorkbook({ skip: ["Anexo V - LETEC"] })), /Anexo V/u);
  await assert.rejects(parseGecexRatesWorkbook(await gecexWorkbook({ fillers: 100 })), /incompleta/u);
});

test("TIPI keeps NT apart from zero and lists Ex rows separately", async () => {
  const parsed = await parseTipiWorkbook(await tipiWorkbook([
    ["0101.21.00", "", "-- Reprodutores", "NT"],
    ["8536.50.90", "", "Outros", 9.75],
    ["8536.50.90", 1, "Interruptor 24 V", 2.6],
    ["8536.50.90", "Ex 02", "Chaves de faca", 3.25],
    ["9403.20.00", "", "- Outros móveis de metal", ""],
    ["9403.20.10", "", "Para escritório", 3.25],
  ]));
  assert.equal(parsed.rows.some(row => row.code === "94032000"), false);
  assert.match(parsed.sourceReference, /ADE RFB nº 5/u);
  assert.deepEqual(parsed.rows.find(row => row.code === "01012100"), { code: "01012100", exNumber: null,
    description: "-- Reprodutores", rate: null, notTaxed: true });
  assert.deepEqual(parsed.rows.filter(row => row.code === "85365090").map(row => [row.exNumber, row.rate]),
    [[null, "9.75"], ["01", "2.6"], ["02", "3.25"]]);
  await assert.rejects(parseTipiWorkbook(await tipiWorkbook([], 50)), /incompleta/u);
});

const exception = values => ({ annex: "V", ncm: "07032090", exNumber: null, rate: "35", quota: null,
  validFrom: "2022-04-01", validTo: null, act: "Resolução Gecex nº 318", description: "Outros", ...values });

test("II uses TEC, then the Brazilian rate, then an unconditional exception in force", () => {
  const tec = { rate: "9", marker: null };
  assert.deepEqual(composeIiRate({ tec, brazil: null, exceptions: [] }, "2026-10-28"),
    { tec: "9", tecMarker: null, brazil: "9", brazilBasis: null, applied: "9", appliedSource: "TEC",
      appliedAct: null, status: "ok", exceptions: [] });
  const brazil = composeIiRate({ tec, brazil: { rate: "7.2", basis: "Art. 6º" }, exceptions: [] }, "2026-10-28");
  assert.equal(brazil.applied, "7.2");
  assert.equal(brazil.appliedSource, "ANEXO_II");
  const letec = composeIiRate({ tec, brazil: { rate: "7.2", basis: null }, exceptions: [exception()] }, "2026-10-28");
  assert.deepEqual([letec.applied, letec.appliedSource, letec.appliedAct, letec.exceptions[0].condition],
    ["35", "ANEXO_V", "Resolução Gecex nº 318", "applied"]);
});

test("II never applies Ex, quota, sector or expired exceptions and flags conflicts", () => {
  const tec = { rate: "9", marker: null };
  const conditional = composeIiRate({ tec, brazil: null, exceptions: [
    exception({ exNumber: "001", rate: "0" }), exception({ quota: "60000 Toneladas", rate: "0" }),
    exception({ annex: "III", ncm: "070320", rate: null, validFrom: null }),
    exception({ validTo: "2026-01-31", rate: "2" }), exception({ validFrom: "2027-01-01", rate: "4" }),
  ] }, "2026-10-28");
  assert.equal(conditional.applied, "9");
  assert.equal(conditional.status, "ok");
  assert.deepEqual(conditional.exceptions.map(item => item.condition), ["ex", "quota", "sector", "future"]);
  const conflict = composeIiRate({ tec, brazil: null, exceptions: [exception(), exception({ annex: "IX", rate: "20" })] },
    "2026-10-28");
  assert.deepEqual([conflict.applied, conflict.status], [null, "needs_review"]);
  assert.equal(composeIiRate({ tec: null, brazil: null, exceptions: [] }, "2026-10-28").status, "missing");
});

test("IPI and PIS/COFINS composition explain their source", () => {
  assert.deepEqual(composeIpiRate([{ code: "01012100", exNumber: null, description: "x", rate: null, notTaxed: true }]),
    { rate: null, notTaxed: true, status: "ok", exceptions: [] });
  const ipi = composeIpiRate([{ code: "85365090", exNumber: "01", description: "24 V", rate: "2.6", notTaxed: false },
    { code: "85365090", exNumber: null, description: "Outros", rate: "9.75", notTaxed: false }]);
  assert.deepEqual([ipi.rate, ipi.exceptions.map(row => row.exNumber)], ["9.75", ["01"]]);
  assert.equal(composeIpiRate([]).status, "missing");
  const general = [{ pisRate: "2.1", cofinsRate: "9.65", legalBasis: "Lei nº 10.865/2004, art. 8º",
    validFrom: "2015-05-01", validTo: null }];
  assert.deepEqual(composePisCofinsRate(general, [], "2026-10-28"), { pis: "2.1", cofins: "9.65",
    legalBasis: "Lei nº 10.865/2004, art. 8º", source: "GENERAL", reviewed: false, exceptionId: null });
  const reviewed = composePisCofinsRate(general, [{ id: "e1", pisRate: "3.52", cofinsRate: "16.48",
    legalBasis: "Art. 8º, § 9º", validFrom: "2026-01-01", validTo: null }], "2026-10-28");
  assert.deepEqual([reviewed.pis, reviewed.cofins, reviewed.source, reviewed.reviewed, reviewed.exceptionId],
    ["3.52", "16.48", "EXCEPTION", true, "e1"]);
  assert.equal(composePisCofinsRate(general, [], "2015-01-01").source, "MISSING");
});
