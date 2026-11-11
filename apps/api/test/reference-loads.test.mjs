import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { planManufacturerLoad, planProductLoad, referenceLoadBody, refusedRows, registerReferenceLoadRoutes }
  from "../dist/reference-loads.js";

// Stage 1f of docs/PLANO_AUDITORIA_INVOICE_AVULSA.md (user decisions, 2026-11-11): the DATABASE and the manufacturer
// list are loaded by Master and Administrador; one load keeps the rows as the invoice audit reference, separate
// from the catalog, and enriches products (description, NCM) and suppliers (address, country).

const actorId = "00000000-0000-4000-8000-000000000070";
const sha = "a".repeat(64);
const productRows = [
  { sourceRow: 3, productCode: "2010100040", description: "RESISTOR SMD 390K", ncm: "85332120" },
  { sourceRow: 4, productCode: "2010100100", description: "RESISTOR SMD 200K", ncm: "85332120" },
  { sourceRow: 5, productCode: "9999999999", description: "PRODUTO NOVO", ncm: "39206100" },
];
const productBody = { kind: "PRODUCT_DATABASE", fileName: "DATABASE - Renew.xlsx", fileSha256: sha, duplicated: 0,
  rows: productRows };
const catalogProducts = [
  { id: "00000000-0000-4000-8000-000000000071", code: "2010100040", name: "RESISTOR SMD 390K", ncm: "85332120" },
  { id: "00000000-0000-4000-8000-000000000072", code: "2010100100", name: "RESISTOR (RESISTeNCIA) 200K", ncm: null },
];
const manufacturerRows = [
  { sourceRow: 2, name: "Yuhuan Lianyu Metal Products Co., Ltd.", address: "Yuhuan City, Zhejiang", country: "China", code: "EX000802" },
  { sourceRow: 3, name: "HEXING ELECTRICAL CO., LTD", address: "Hangzhou, Zhejiang", country: "China", code: "EX000135" },
  { sourceRow: 4, name: "New Maker Co., Ltd.", address: "Shenzhen", country: "China", code: "EX000900" },
  { sourceRow: 5, name: "Pending Maker Co., Ltd.", address: "Shanghai", country: "China", code: "2026110731" },
  { sourceRow: 6, name: "CHRONIX FUSION LIMITED", address: "Hong Kong", country: "China", code: "CADASTRAR" },
];
const catalogSuppliers = [
  { id: "00000000-0000-4000-8000-000000000081", code: "EX000802", name: "YUHUAN LIANYU METAL PRODUCTS CO., LTD",
    address: "Yuhuan City, Zhejiang", country: "China" },
  { id: "00000000-0000-4000-8000-000000000082", code: "EX000135", name: "HEXING ELECTRICAL CO.,LTD HANGZHOU",
    address: null, country: null },
];

test("the DATABASE plan replaces description and NCM by code, creates a missing product and counts the rest", () => {
  const plan = planProductLoad(productRows, catalogProducts);
  assert.deepEqual(plan.created.map(row => row.productCode), ["9999999999"]);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.updated, [{ id: catalogProducts[1].id, code: "2010100100", name: "RESISTOR SMD 200K",
    ncm: "85332120", changes: [{ field: "name", from: "RESISTOR (RESISTeNCIA) 200K", to: "RESISTOR SMD 200K" },
      { field: "product_ncm_code", from: null, to: "85332120" }] }]);
  assert.deepEqual([plan.descriptionChanged, plan.ncmFilled, plan.ncmChanged], [1, 1, []]);
  // Code is compared regardless of case and spaces; a different NCM is listed with both values.
  const changed = planProductLoad([{ ...productRows[0], productCode: " 2010100040 ", ncm: "85332190" }], catalogProducts);
  assert.deepEqual(changed.ncmChanged, [{ productCode: "2010100040", from: "85332120", to: "85332190" }]);
});

test("the manufacturer plan fills supplier address and country by EX code, keeps the name and leaves other codes out", () => {
  const plan = planManufacturerLoad(manufacturerRows, catalogSuppliers);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.updated, [{ id: catalogSuppliers[1].id, code: "EX000135", address: "Hangzhou, Zhejiang",
    country: "China", changes: [{ field: "supplier_address", from: null, to: "Hangzhou, Zhejiang" },
      { field: "supplier_country", from: null, to: "China" }] }]);
  assert.deepEqual(plan.created.map(row => row.code), ["EX000900"]);
  assert.deepEqual(plan.withoutTotvsCode.map(row => row.code), ["2026110731", "CADASTRAR"]);
  // A name that differs only in punctuation and case is not a difference; a real difference is listed, not applied.
  assert.deepEqual(plan.nameDifferences, [{ code: "EX000135", listName: "HEXING ELECTRICAL CO., LTD",
    catalogName: "HEXING ELECTRICAL CO.,LTD HANGZHOU" }]);
  const repeated = planManufacturerLoad([...manufacturerRows, { ...manufacturerRows[1], sourceRow: 9, address: "Other" }],
    [...catalogSuppliers, { ...catalogSuppliers[0], id: "00000000-0000-4000-8000-000000000083", name: "Other name" }]);
  assert.deepEqual(repeated.repeatedCodes, [{ sourceRow: 9, code: "EX000135" }]);
  assert.deepEqual(repeated.ambiguousCodes, ["EX000802"]);
});

test("rows without code, description or valid NCM, and repeated codes or rows, are refused", () => {
  const refused = refusedRows(referenceLoadBody.parse({ ...productBody, rows: [productRows[0],
    { ...productRows[1], sourceRow: 3 }, { ...productRows[1], productCode: " " }, { ...productRows[1], sourceRow: 7,
      productCode: "2010100040" }, { ...productRows[1], sourceRow: 8, description: " " },
    { ...productRows[1], sourceRow: 9, productCode: "2010100999", ncm: "8533212" }] }));
  assert.deepEqual(refused.map(row => row.reason),
    ["ROW_REPEATED", "CODE_MISSING", "CODE_REPEATED", "DESCRIPTION_MISSING", "NCM_INVALID"]);
  assert.deepEqual(refusedRows(referenceLoadBody.parse({ kind: "MANUFACTURER_LIST", fileName: "LIST.xlsx", fileSha256: sha,
    rows: [{ sourceRow: 2, name: " ", address: "", country: "China", code: "EX1" }] })).map(row => row.reason), ["CONTENT_MISSING"]);
});

async function fixture(t, { role = "Administrador", latest = null, products = catalogProducts, suppliers = catalogSuppliers,
  registeredNcms = ["85332120"], official = [] } = {}) {
  const writes = [];
  let inserted = null;
  const load = () => inserted ?? latest;
  function answer(sql, values) {
    if (sql.includes("identity.erp_user AS u")) return { rows: [{ role, importer_code: null }] };
    if (sql.includes("SELECT DISTINCT importer")) return { rows: [] };
    if (sql.includes("FROM catalog.reference_load AS load")) return { rows: load() ? [load()] : [] };
    if (sql.includes("FROM catalog.reference_product_row")) {
      return { rows: sql.includes("SELECT ncm") ? productRows.map(row => ({ ncm: row.ncm })) : productRows };
    }
    if (sql.includes("FROM catalog.reference_manufacturer_row")) return { rows: manufacturerRows };
    if (sql.includes("kind = 'PRODUCT'") && sql.includes("SELECT id, code")) return { rows: products };
    if (sql.includes("kind = 'SUPPLIER'") && sql.includes("SELECT id, code")) return { rows: suppliers };
    if (sql.includes("kind = 'NCM'")) return { rows: values[0].filter(code => registeredNcms.includes(code)).map(code => ({ code })) };
    if (sql.includes("FROM catalog.ncm_official_item")) {
      return { rows: official.filter(item => values[0].includes(item.code)) };
    }
    return undefined;
  }
  const pool = {
    async query(sql, values = []) {
      writes.push({ sql, values, pool: true });
      const result = answer(sql, values);
      if (result) return result;
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          writes.push({ sql, values });
          if (sql.includes("INSERT INTO catalog.reference_load")) {
            inserted = { id: values[0], kind: values[1], fileName: values[2], fileSha256: values[3], rowCount: values[4],
              summary: JSON.parse(values[5]), loadedAt: "2026-11-11T15:00:00.000Z", loadedBy: "Admin" };
          }
          return answer(sql, values) ?? { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "admin", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerReferenceLoadRoutes(app, pool);
  return { app, writes };
}

test("only Master and Administrador preview and load; the others get 403 and nothing is read or written", async t => {
  for (const role of ["Importação", "Compras", "Fiscal", "Consulta"]) {
    const { app, writes } = await fixture(t, { role });
    for (const url of ["/api/v1/reference-loads/preview", "/api/v1/reference-loads"]) {
      const response = await app.inject({ method: "POST", url, payload: productBody });
      assert.equal(response.statusCode, 403, `${role} ${url}`);
    }
    assert.equal(writes.filter(write => !write.sql.includes("identity.erp_user") && !write.sql.includes("SELECT DISTINCT importer")).length, 0);
  }
  for (const role of ["Master", "Administrador"]) {
    const { app } = await fixture(t, { role });
    const response = await app.inject({ method: "POST", url: "/api/v1/reference-loads/preview", payload: productBody });
    assert.equal(response.statusCode, 200, response.body);
  }
});

test("the preview counts the changes, classifies the unregistered NCMs and writes nothing", async t => {
  const { app, writes } = await fixture(t, { official: [{ code: "39206100", name: "-- De policarbonatos", validFrom: "2022-04-01",
    validTo: null }] });
  const response = await app.inject({ method: "POST", url: "/api/v1/reference-loads/preview", payload: productBody });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual([body.summary.created, body.summary.updated, body.summary.unchanged, body.sameAsLatest], [1, 1, 1, false]);
  assert.deepEqual(body.ncms, [{ code: "39206100", status: "OFFICIAL_VALID", officialName: "-- De policarbonatos", products: 1 }]);
  assert.equal(writes.some(write => /INSERT|UPDATE/u.test(write.sql)), false);
  // The official catalog is read only for the missing codes, never as a whole.
  const officialRead = writes.find(write => write.sql.includes("catalog.ncm_official_item"));
  assert.match(officialRead.sql, /WHERE code = ANY\(\$1::text\[\]\)/u);
  assert.deepEqual(officialRead.values[0], ["39206100"]);
});

test("an extra field or a row over the limits is a 400; a refused row is a 422 and nothing is written", async t => {
  const { app, writes } = await fixture(t);
  const extra = await app.inject({ method: "POST", url: "/api/v1/reference-loads",
    payload: { ...productBody, sheet: "DATABASE" } });
  assert.equal(extra.statusCode, 400);
  const refused = await app.inject({ method: "POST", url: "/api/v1/reference-loads",
    payload: { ...productBody, rows: [{ ...productRows[0], ncm: "" }] } });
  assert.equal(refused.statusCode, 422);
  assert.equal(refused.json().code, "REFERENCE_ROWS_REFUSED");
  assert.equal(writes.some(write => /INSERT|UPDATE|BEGIN/u.test(write.sql)), false);
});

test("the DATABASE load keeps the rows for the audit and enriches the catalog with one audit event per field", async t => {
  const { app, writes } = await fixture(t);
  const response = await app.inject({ method: "POST", url: "/api/v1/reference-loads", payload: productBody });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().alreadyLoaded, false);
  assert.equal(response.json().load.fileSha256, sha);
  const sql = writes.map(write => write.sql);
  assert.ok(sql.some(text => text.includes("pg_advisory_xact_lock")));
  const rows = writes.find(write => write.sql.includes("INSERT INTO catalog.reference_product_row"));
  // The audit reference keeps every row exactly as the reader returned it.
  assert.deepEqual(JSON.parse(rows.values[1]), productRows);
  const created = writes.find(write => write.sql.includes("INSERT INTO catalog.entry ("));
  assert.deepEqual(JSON.parse(created.values[0]).map(entry => [entry.code, entry.name, entry.ncm]),
    [["9999999999", "PRODUTO NOVO", "39206100"]]);
  assert.match(created.sql, /'REFERENCE_LOAD'/u);
  const updated = writes.find(write => write.sql.includes("UPDATE catalog.entry AS e SET name"));
  assert.deepEqual(JSON.parse(updated.values[0]), [{ id: catalogProducts[1].id, name: "RESISTOR SMD 200K", ncm: "85332120" }]);
  const audit = JSON.parse(writes.find(write => write.sql.includes("INSERT INTO audit.audit_log (id, aggregate_type")).values[0]);
  assert.deepEqual(audit.map(event => [event.operation, event.field]),
    [["CREATE", null], ["UPDATE", "name"], ["UPDATE", "product_ncm_code"]]);
  assert.ok(sql.some(text => text.includes("INSERT INTO audit.outbox_message (event_id")));
  assert.ok(sql.includes("COMMIT"));
});

test("the manufacturer load keeps all list rows for the audit and changes only EX suppliers", async t => {
  const { app, writes } = await fixture(t);
  const payload = { kind: "MANUFACTURER_LIST", fileName: "LIST.xlsx", fileSha256: sha, rows: manufacturerRows };
  const response = await app.inject({ method: "POST", url: "/api/v1/reference-loads", payload });
  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual(JSON.parse(writes.find(write => write.sql.includes("INSERT INTO catalog.reference_manufacturer_row"))
    .values[1]), manufacturerRows);
  const created = JSON.parse(writes.find(write => write.sql.includes("INSERT INTO catalog.entry (")).values[0]);
  assert.deepEqual(created.map(entry => [entry.code, entry.name, entry.address, entry.country]),
    [["EX000900", "New Maker Co., Ltd.", "Shenzhen", "China"]]);
  const updated = writes.find(write => write.sql.includes("UPDATE catalog.entry AS e SET supplier_address"));
  assert.deepEqual(JSON.parse(updated.values[0]), [{ id: catalogSuppliers[1].id, address: "Hangzhou, Zhejiang", country: "China" }]);
  // The supplier name is never written by the load.
  assert.equal(writes.some(write => /UPDATE catalog\.entry[\s\S]*SET[\s\S]*\bname\s*=/u.test(write.sql)
    && write.sql.includes("supplier")), false);
  assert.deepEqual(response.json().summary.withoutTotvsCode.map(row => row.code), ["2026110731", "CADASTRAR"]);
});

test("the same file again, with nothing to change in the catalog, keeps the latest load", async t => {
  const latest = { id: "00000000-0000-4000-8000-000000000090", kind: "PRODUCT_DATABASE", fileName: "DATABASE - Renew.xlsx",
    fileSha256: sha, rowCount: 3, summary: {}, loadedAt: "2026-11-11T14:00:00.000Z", loadedBy: "Admin" };
  const { app, writes } = await fixture(t, { latest, products: [...catalogProducts.slice(0, 1),
    { ...catalogProducts[1], name: "RESISTOR SMD 200K", ncm: "85332120" },
    { id: "00000000-0000-4000-8000-000000000073", code: "9999999999", name: "PRODUTO NOVO", ncm: "39206100" }] });
  const response = await app.inject({ method: "POST", url: "/api/v1/reference-loads", payload: productBody });
  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual([response.json().alreadyLoaded, response.json().load.id], [true, latest.id]);
  assert.equal(writes.some(write => /INSERT|UPDATE catalog/u.test(write.sql)), false);
});

test("the audit reference returns the rows of the latest loads in the shape of the spreadsheet readers", async t => {
  const latest = { id: "00000000-0000-4000-8000-000000000091", kind: "PRODUCT_DATABASE", fileName: "DATABASE - Renew.xlsx",
    fileSha256: sha, rowCount: 3, summary: { duplicated: 2 }, loadedAt: "2026-11-11T14:00:00.000Z", loadedBy: "Admin" };
  const { app, writes } = await fixture(t, { role: "Importação", latest });
  const response = await app.inject({ url: "/api/v1/reference-loads/audit-reference" });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual(body.productDatabase, { loadId: latest.id, fileName: latest.fileName, fileSha256: sha,
    loadedAt: latest.loadedAt, loadedBy: "Admin", duplicated: 2, products: productRows });
  assert.deepEqual(body.manufacturerList.manufacturers, manufacturerRows);
  // The audit reference never reads the catalog.
  assert.equal(writes.some(write => write.sql.includes("catalog.entry")), false);
});

test("the pending NCMs of the latest DATABASE load are listed for Master and Administrador", async t => {
  const latest = { id: "00000000-0000-4000-8000-000000000092", kind: "PRODUCT_DATABASE", fileName: "DATABASE.xlsx",
    fileSha256: sha, rowCount: 3, summary: {}, loadedAt: "2026-11-11T14:00:00.000Z", loadedBy: "Admin" };
  const { app } = await fixture(t, { latest });
  const response = await app.inject({ url: "/api/v1/reference-loads/pending-ncms" });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().ncms, [{ code: "39206100", status: "NOT_IN_OFFICIAL", officialName: null, products: 1 }]);
  const denied = await fixture(t, { role: "Compras", latest });
  assert.equal((await denied.app.inject({ url: "/api/v1/reference-loads/pending-ncms" })).statusCode, 403);
});

test("M082 keeps loads and rows apart from the catalog, immutable, and adds supplier address and country", async () => {
  const migration = (await readFile(new URL("../migrations/M082_reference_loads.sql", import.meta.url), "utf8"))
    .replace(/^--.*$/gmu, "");
  assert.match(migration, /CREATE TABLE catalog\.reference_load \(/u);
  assert.match(migration, /CREATE TABLE catalog\.reference_product_row \(/u);
  assert.match(migration, /CREATE TABLE catalog\.reference_manufacturer_row \(/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON catalog\.reference_product_row/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON catalog\.reference_manufacturer_row/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON catalog\.reference_load\s/u);
  assert.match(migration, /ADD COLUMN supplier_address varchar\(500\)/u);
  assert.match(migration, /'REFERENCE_LOAD'\)\)/u);
  assert.match(migration, /GRANT SELECT, INSERT ON catalog\.reference_load/u);
  assert.doesNotMatch(migration, /GRANT[^;]*(UPDATE|DELETE)[^;]*reference_/u);
  assert.doesNotMatch(migration, /\bUPDATE catalog\.entry\b|\bDELETE FROM\b/u);
});

test("the load payloads built by the web screen are accepted by the reference load route", async () => {
  const { manufacturerListPayload, productDatabasePayload } = await import("../../web/lib/reference-loads.ts");
  const database = { fileName: "DATABASE - Renew.xlsx", fileSha256: sha, duplicated: 1,
    products: productRows.map(row => ({ ...row })) };
  const list = { fileName: "LIST.xlsx", fileSha256: sha, manufacturers: manufacturerRows.map(row => ({ ...row })) };
  for (const payload of [productDatabasePayload(database), manufacturerListPayload(list)]) {
    const parsed = referenceLoadBody.safeParse(payload);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  }
  assert.deepEqual(productDatabasePayload(database).rows, productRows);
  assert.deepEqual(manufacturerListPayload(list).rows, manufacturerRows);
});
