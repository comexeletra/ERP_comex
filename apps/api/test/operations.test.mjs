import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerOperationalRoutes } from "../dist/operations.js";

const poId = "00000000-0000-4000-8000-000000000001";
const secondItemId = "00000000-0000-4000-8000-000000000005";
const body = { importer: "ELETRA MATRIZ", number: "PO-TESTE", supplierText: "SUP-TESTE",
  orderDate: null, notes: "", reason: "Pedido conferido" };

async function invoiceImportApp(t, client, { preflightDuplicate = false, preflightOtherImporterIp = false } = {}) {
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }] };
      }
      if (sql.includes("FROM imports.process_document document") && sql.includes("document.notes LIKE")) {
        return { rows: preflightDuplicate ? [{ number: "INV-1", notes: JSON.stringify({ fileSha256: "a".repeat(64) }),
          ip_number: "IPH/OTHER", importer: "OTHER IMPORTER", supplier_text: "Exporter Ltd" }] : [] };
      }
      if (sql.includes("SELECT importer FROM imports.import_process") && sql.includes("normalized_ip_number")) {
        return { rows: preflightOtherImporterIp ? [{ importer: "OTHER IMPORTER" }] : [] };
      }
      return { rows: [{ role: params[1] === "reader" ? "Consulta" : "Importa\u00e7\u00e3o",
        importer_code: "ELETRA MATRIZ" }] };
    },
    async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    if (request.headers["x-test-subject"] === "writer") request.authContext = {
      issuer: "ci", subject: "writer", userId: poId, displayName: null, sessionToken: "ci",
    };
  });
  await registerOperationalRoutes(app, pool);
  return app;
}

function invoicePayload({ confirmSupplierMismatch = false, fileSha256 = "a".repeat(64),
  confirmDuplicateInvoice = false } = {}) {
  return {
    confirmDuplicateInvoice,
    process: { importer: "ELETRA MATRIZ", ipNumber: "IPH/TEST", supplierText: "Exporter Ltd",
      logisticsStatus: "WAITING SHIPMENT", priority: null, notes: "", reason: "Invoice review" },
    invoice: { fileName: "invoice.xlsx", number: "INV-1", issueDate: null, amount: "10", currency: "CNY",
      metadata: { importerCnpj: "12345678000190", ipNumberFromInvoice: "IPH/TEST", exporterText: "Exporter Ltd", fileSha256,
        lines: [{ sourceRow: 16, productCode: "PO-CODE", quantity: "5", poCell: "PO030201" }],
        assignments: [{ itemId: poId, sourceRow: 16, sourcePoNumber: "PO030201", poNumber: "PO030201",
          poProductCode: "PO-CODE", productCode: "PO-CODE", quantity: "5",
          confirmSupplierMismatch }], catalogUpdates: { products: [], poItems: [] } } },
    allocations: [{ itemId: poId, quantity: "5", notes: "Invoice row 16" }],
  };
}

test("invoice import recalculates line amounts and header totals", async t => {
  const { client } = invoiceImportClient();
  const app = await invoiceImportApp(t, client);
  const fullPayload = invoicePayload();
  fullPayload.invoice.metadata.lines[0] = { ...fullPayload.invoice.metadata.lines[0],
    amount: "10", unitPrice: "2", ncm: "39269090", unit: "PCS", description: "Part A" };
  fullPayload.invoice.metadata.totalQuantity = "5";
  for (const [name, change, expectedCode] of [
    ["header amount", payload => { payload.invoice.amount = "11"; }, "INVOICE_TOTAL_MISMATCH"],
    ["line price", payload => { payload.invoice.metadata.lines[0].unitPrice = "3"; }, "INVOICE_LINE_AMOUNT_MISMATCH"],
    ["header quantity", payload => { payload.invoice.metadata.totalQuantity = "6"; }, "INVOICE_TOTAL_MISMATCH"],
    ["invalid NCM", payload => { payload.invoice.metadata.lines[0].ncm = "123"; }, "INVALID_INVOICE_LINES"],
    ["non-CNY", payload => { payload.invoice.currency = "USD"; }, "INVALID_INVOICE_CURRENCY"],
  ]) {
    const payload = structuredClone(fullPayload);
    change(payload);
    const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
      headers: { "x-test-subject": "writer", "idempotency-key": `invoice-total-${name.replaceAll(" ", "-")}` }, payload });
    assert.equal(response.statusCode, 400, `${name}: ${response.body}`);
    assert.equal(response.json().code, expectedCode, name);
  }
  const valid = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-total-valid" }, payload: fullPayload });
  assert.equal(valid.statusCode, 201, valid.body);
});

test("invoice import validates SHA-256 and stores it in document metadata", async t => {
  const { client, queries } = invoiceImportClient();
  const app = await invoiceImportApp(t, client);
  const invalid = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-invalid-hash" },
    payload: invoicePayload({ fileSha256: "not-a-sha256" }),
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.equal(invalid.json().code, "INVALID_INVOICE_FILE_HASH");
  const valid = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-valid-hash" },
    payload: invoicePayload(),
  });
  assert.equal(valid.statusCode, 201, valid.body);
  const document = queries.find(query => query.sql.includes("INSERT INTO imports.process_document"));
  assert.equal(JSON.parse(document.params[6]).fileSha256, "a".repeat(64));
});

function invoiceImportClient({ revision = false, supplierMatchesExporter = true, otherImporterIp = false,
  canceledItem = false, duplicateKind = null, poUnit = null, poUnitPrice = null, poCurrency = null,
  linkedOrphanPo = false, draft = false, insufficientBalance = false, purchaseOrderStatus = "ACTIVE",
  previousAllocationPoStatus = "ACTIVE", recordStatus = "ACTIVE", shipped = false, exporterAliases = [],
  catalogProduct = null, secondItem = false, codesInPo = [] } = {}) {
  const processId = "00000000-0000-4000-8000-000000000021";
  const oldDocumentId = "00000000-0000-4000-8000-000000000022";
  const oldAllocationId = "00000000-0000-4000-8000-000000000023";
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("SELECT payload_sha256")) return { rows: [], rowCount: 0 };
      if (sql.includes("UNION SELECT importer FROM imports.import_process")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }], rowCount: 1 };
      }
      if (sql.includes("FROM catalog.operational_value")) return { rows: [{ ok: true }], rowCount: 1 };
      if (sql.includes("FROM imports.process_document document") && sql.includes("document.notes LIKE")) {
        return duplicateKind ? { rows: [{ number: duplicateKind === "number" ? "INV-1" : "OTHER-INV",
          notes: JSON.stringify({ fileSha256: duplicateKind === "hash" ? "a".repeat(64) : "b".repeat(64) }),
          ip_number: "IPH/OTHER", importer: "ELETRA MATRIZ", supplier_text: "Exporter Ltd" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM procurement.purchase_order_item item JOIN procurement.purchase_order po")) {
        const row = { id: poId, purchase_order_id: "00000000-0000-4000-8000-000000000002",
          number: "PO030201", importer: "ELETRA MATRIZ", quantity: "10", product_code: "PO-CODE",
          lifecycle_status: purchaseOrderStatus,
          source_status: canceledItem ? "CANCELLED" : null,
          unit: poUnit, unit_price: poUnitPrice, currency_code: poCurrency,
          supplier_entry_id: "00000000-0000-4000-8000-000000000003",
          supplier_text: supplierMatchesExporter ? "Exporter Ltd" : "PO Supplier",
          supplier_name: supplierMatchesExporter ? "Exporter Ltd" : "PO Supplier Ltd",
          supplier_code: supplierMatchesExporter ? "EXPORTER" : "PO-SUP", exporter_aliases: exporterAliases };
        const rows = secondItem ? [row, { ...row, id: secondItemId }] : [row];
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("AS invoice_po_code")) {
        return { rows: codesInPo.map(([po, code]) => ({ po, code })), rowCount: codesInPo.length };
      }
      if (sql.includes("normalized_ip_number = upper(btrim($1))")) {
        if (otherImporterIp && !sql.includes("AND importer = $2")) {
          return { rows: [{ id: processId, importer: "OTHER IMPORTER", ip_number: "IPH/TEST" }], rowCount: 1 };
        }
        return revision || draft ? { rows: [{ id: processId, importer: "ELETRA MATRIZ", ip_number: "IPH/TEST",
          normalized_ip_number: "IPH/TEST", record_status: draft ? "DRAFT" : recordStatus, lifecycle_status: "OPEN", version: "2",
          bl_date: shipped ? "2026-10-01" : null, actual_port_departure_date: null }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM procurement.process_purchase_order link") && sql.includes("link.process_id")) {
        return linkedOrphanPo ? { rows: [{ purchase_order_id: "00000000-0000-4000-8000-000000000004",
          external_number: "PO-ORPHAN", source_kind: draft ? "CANCELLATION_TRANSFER" : "CHINA_INVOICE" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT 1 FROM imports.process_document")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT * FROM imports.process_document") && sql.includes("kind = 'INVOICE'")) {
        return revision ? { rows: [{ id: oldDocumentId, process_id: processId, kind: "INVOICE", status: "ACTIVE" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM procurement.po_item_allocation allocation") && sql.includes("allocation.process_id")) {
        return revision ? { rows: [{ id: oldAllocationId, process_id: processId,
          purchase_order_item_id: poId, quantity: "5", status: "ACTIVE",
          lifecycle_status: previousAllocationPoStatus }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT * FROM catalog.entry WHERE kind = 'PRODUCT'")) {
        return catalogProduct ? { rows: [catalogProduct], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT item.id, item.ordered_quantity::text")) {
        const rows = [{ id: poId, ordered_quantity: insufficientBalance ? "3" : "10", allocated_quantity: "0" }];
        if (secondItem) rows.push({ id: secondItemId, ordered_quantity: "10", allocated_quantity: "0" });
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { client, queries, processId, oldDocumentId, oldAllocationId };
}

for (const draft of [false, true]) {
  test(`invoice ${draft ? "DRAFT fill" : "revision"} requires explicit orphan PO decisions`, async t => {
    const { client, queries } = invoiceImportClient({ revision: !draft, draft, linkedOrphanPo: true });
    const app = await invoiceImportApp(t, client);
    const request = (key, payload) => app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
      headers: { "x-test-subject": "writer", "idempotency-key": key, "x-record-version": '"2"' }, payload });
    const missing = await request(`invoice-orphan-${draft}-missing`, invoicePayload());
    assert.equal(missing.statusCode, 409, missing.body);
    assert.equal(missing.json().code, "INVOICE_ORPHAN_PO_DECISION_REQUIRED");
    assert.equal(queries.some(query => query.sql.includes("DELETE FROM procurement.process_purchase_order")), false);
    const removePayload = { ...invoicePayload(), orphanPoDecisions: [
      { purchaseOrderId: "00000000-0000-4000-8000-000000000004", action: "REMOVE" }] };
    const removed = await request(`invoice-orphan-${draft}-remove`, removePayload);
    assert.equal(removed.statusCode, 201, removed.body);
    assert.equal(queries.some(query => query.sql.includes("DELETE FROM procurement.process_purchase_order")), true);
    assert.equal(queries.some(query => query.sql.includes("INSERT INTO audit.audit_log")
      && query.params.some(value => typeof value === "string" && value.includes('"action":"REMOVE"'))), true);
    const deletesBeforeKeep = queries.filter(query => query.sql.includes("DELETE FROM procurement.process_purchase_order")).length;
    const kept = await request(`invoice-orphan-${draft}-keep`, { ...invoicePayload(), orphanPoDecisions: [
      { purchaseOrderId: "00000000-0000-4000-8000-000000000004", action: "KEEP" }] });
    assert.equal(kept.statusCode, 201, kept.body);
    assert.equal(queries.filter(query => query.sql.includes("DELETE FROM procurement.process_purchase_order")).length,
      deletesBeforeKeep);
    assert.equal(queries.some(query => query.sql.includes("INSERT INTO audit.audit_log")
      && query.params.some(value => typeof value === "string" && value.includes('"action":"KEEP"'))), true);
  });
}

test("invoice import requires unit and CNY price confirmations per destination", async t => {
  const { client, queries } = invoiceImportClient({ poUnit: "KG", poUnitPrice: "3", poCurrency: "CNY" });
  const app = await invoiceImportApp(t, client);
  const payload = invoicePayload();
  Object.assign(payload.invoice.metadata.lines[0], { amount: "10", unitPrice: "2", unit: "PCS" });
  const request = (key, nextPayload) => app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": key }, payload: nextPayload });
  const unit = await request("invoice-unit-mismatch", payload);
  assert.equal(unit.statusCode, 400, unit.body);
  assert.equal(unit.json().code, "INVOICE_UNIT_MISMATCH_UNCONFIRMED");
  payload.invoice.metadata.assignments[0].confirmUnitMismatch = true;
  const price = await request("invoice-price-mismatch", payload);
  assert.equal(price.statusCode, 400, price.body);
  assert.equal(price.json().code, "INVOICE_PRICE_MISMATCH_UNCONFIRMED");
  payload.invoice.metadata.assignments[0].confirmPriceMismatch = true;
  const confirmed = await request("invoice-mismatch-confirmed", payload);
  assert.equal(confirmed.statusCode, 201, confirmed.body);
  assert.equal(queries.some(query => query.sql.includes("INSERT INTO audit.audit_log")
    && query.params.some(value => typeof value === "string" && value.includes('"confirmedUnitMismatch":true')
      && value.includes('"confirmedPriceMismatch":true'))), true);
});

test("invoice import accepts equivalent units without a unit confirmation", async t => {
  const { client, queries } = invoiceImportClient({ poUnit: "UN" });
  const app = await invoiceImportApp(t, client);
  const payload = invoicePayload();
  Object.assign(payload.invoice.metadata.lines[0], { unit: "PCS" });
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-equivalent-unit" }, payload });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(queries.some(query => query.sql.includes("INSERT INTO audit.audit_log")
    && query.params.some(value => typeof value === "string" && value.includes('"confirmedUnitMismatch":true'))), false);
});

test("invoice import does not require a price confirmation for a non-CNY PO", async t => {
  const { client } = invoiceImportClient({ poUnit: "PCS", poUnitPrice: "3", poCurrency: "USD" });
  const app = await invoiceImportApp(t, client);
  const payload = invoicePayload();
  Object.assign(payload.invoice.metadata.lines[0], { amount: "10", unitPrice: "2", unit: "PCS" });
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-usd-price" }, payload });
  assert.equal(response.statusCode, 201, response.body);
});

for (const duplicateKind of ["hash", "number"]) {
  test(`invoice import requires audited confirmation for duplicate ${duplicateKind}`, async t => {
    const { client, queries } = invoiceImportClient({ duplicateKind });
    const app = await invoiceImportApp(t, client);
    const unconfirmed = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
      headers: { "x-test-subject": "writer", "idempotency-key": `duplicate-${duplicateKind}` },
      payload: invoicePayload(),
    });
    assert.equal(unconfirmed.statusCode, 409, unconfirmed.body);
    assert.equal(unconfirmed.json().code, "INVOICE_DUPLICATE_UNCONFIRMED");
    assert.deepEqual(unconfirmed.json().ipNumbers, ["IPH/OTHER"]);
    assert.equal(queries.some(query => query.sql.includes("INSERT INTO imports.import_process")), false);
    const confirmed = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
      headers: { "x-test-subject": "writer", "idempotency-key": `duplicate-${duplicateKind}-confirmed` },
      payload: invoicePayload({ confirmDuplicateInvoice: true }),
    });
    assert.equal(confirmed.statusCode, 201, confirmed.body);
    assert.equal(queries.some(query => query.sql.includes("INSERT INTO audit.audit_log")
      && query.params.some(value => typeof value === "string" && value.includes('"confirmedDuplicateInvoice":true'))), true);
  });
}

test("invoice duplicate preflight includes IPs outside the selected importer", async t => {
  const { client } = invoiceImportClient();
  const app = await invoiceImportApp(t, client, { preflightDuplicate: true, preflightOtherImporterIp: true });
  const response = await app.inject({ method: "GET",
    url: `/api/v1/processes/invoice-duplicates?importer=ELETRA%20MATRIZ&ipNumber=IPH%2FTEST&invoiceNumber=INV-1&exporterText=Exporter%20Ltd&fileSha256=${"a".repeat(64)}`,
    headers: { "x-test-subject": "writer" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().ipNumbers, ["IPH/OTHER"]);
  assert.equal(response.json().ipReferenceOtherImporter, true);
});

test("invoice import rejects an item canceled at its source", async t => {
  const { client, queries } = invoiceImportClient({ canceledItem: true });
  const app = await invoiceImportApp(t, client);
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-canceled-item" },
    payload: invoicePayload(),
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, "PO_ITEM_MISMATCH");
  assert.equal(queries.some(query => query.sql.includes("INSERT INTO procurement.po_item_allocation")), false);
});

test("invoice import reports an IP reference already owned by another importer", async t => {
  const { client, queries } = invoiceImportClient({ otherImporterIp: true });
  const app = await invoiceImportApp(t, client);
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-other-importer" },
    payload: invoicePayload(),
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, "IP_REFERENCE_OTHER_IMPORTER");
  assert.equal(queries.some(query => query.sql.includes("INSERT INTO imports.import_process")), false);
});

test("operational commands reject reader, invalid quantity, foreign importer and missing version before database writes", async t => {
  let connections = 0;
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }] };
      }
      return { rows: [{ role: params[1] === "reader" ? "Consulta" : "Importação",
        importer_code: "ELETRA MATRIZ" }] };
    },
    async connect() { connections += 1; throw new Error("Unexpected database write"); },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = {
      issuer: "ci", subject, userId: poId, displayName: null, sessionToken: "ci",
    };
  });
  await registerOperationalRoutes(app, pool);
  const call = (subject, method, url, payload, headers = {}) => app.inject({
    method, url, payload, headers: { "x-test-subject": subject, ...headers },
  });

  assert.equal((await call("reader", "POST", "/api/v1/purchase-orders", body,
    { "idempotency-key": "reader-key" })).statusCode, 403);
  assert.equal((await call("writer", "POST", "/api/v1/purchase-orders",
    { ...body, importer: "ELETRA FOR" }, { "idempotency-key": "foreign-key" })).statusCode, 404);
  assert.equal((await call("writer", "PATCH", `/api/v1/purchase-orders/${poId}`,
    { number: "PO-TESTE", supplierText: null, orderDate: null, notes: "", reason: "Correção" })).statusCode, 428);
  assert.equal((await call("writer", "PATCH", `/api/v1/processes/${poId}`,
    { importer: "ELETRA FOR", supplierText: null, ipNumber: "IP-1", logisticsStatus: null, priority: null,
      notes: "", reason: "Correção" }, { "x-record-version": '"1"' })).statusCode, 404);
  assert.equal((await call("writer", "PATCH", `/api/v1/purchase-orders/${poId}/allocations/${poId}`,
    { factoryShipDate: "2026-10-06", reason: "Data do embarque" })).statusCode, 428);
  assert.equal((await call("writer", "POST", `/api/v1/purchase-orders/${poId}/allocations`,
    { itemId: poId, processId: poId, quantity: "101.123456789", notes: "", reason: "Teste" },
    { "idempotency-key": "invalid-quantity" })).statusCode, 400);
  assert.equal((await call("writer", "GET", "/api/v1/purchase-orders/invoice-candidates")).statusCode, 400);
  assert.equal((await call("writer", "POST", "/api/v1/processes/import-invoice", {},
    { "idempotency-key": "invalid-invoice" })).statusCode, 400);
  assert.equal((await call("writer", "POST", `/api/v1/processes/${poId}/cancel`, {},
    { "x-record-version": '"1"' })).statusCode, 400);
  assert.equal(connections, 0);
});

test("guided cancellation releases allocations and routes POs to idle, existing and draft IPs", async t => {
  const processId = "00000000-0000-4000-8000-000000000011";
  const idlePoId = "00000000-0000-4000-8000-000000000012";
  const existingPoId = "00000000-0000-4000-8000-000000000013";
  const newDraftPoId = "00000000-0000-4000-8000-000000000014";
  const targetProcessId = "00000000-0000-4000-8000-000000000015";
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("SELECT * FROM imports.import_process WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE")) {
        return { rows: [{ id: processId, importer: "ELETRA MATRIZ", ip_number: "IPH-OLD",
          normalized_ip_number: "IPH-OLD", record_status: "ACTIVE", lifecycle_status: "OPEN",
          logistics_status: "WAITING SHIPMENT", version: "1", supplier_text: "Exporter Ltd",
          supplier_entry_id: null }], rowCount: 1 };
      }
      if (sql.includes("SELECT po.id AS purchase_order_id")) {
        return { rows: [
          { purchase_order_id: idlePoId, number: "PO-IDLE" },
          { purchase_order_id: existingPoId, number: "PO-EXISTING" },
          { purchase_order_id: newDraftPoId, number: "PO-NEW" },
        ], rowCount: 3 };
      }
      if (sql.includes("SELECT id, importer, record_status, lifecycle_status FROM imports.import_process")) {
        return { rows: [{ id: targetProcessId, importer: "ELETRA MATRIZ", record_status: "ACTIVE", lifecycle_status: "OPEN" }], rowCount: 1 };
      }
      if (sql.includes("SELECT normalized_ip_number FROM imports.import_process")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT * FROM imports.process_document")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT * FROM procurement.po_item_allocation WHERE process_id")) {
        return { rows: [{ id: "00000000-0000-4000-8000-000000000016", process_id: processId,
          purchase_order_item_id: "00000000-0000-4000-8000-000000000017", quantity: "5", status: "ACTIVE" }], rowCount: 1 };
      }
      if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) return { rows: [{ importer: "ELETRA MATRIZ" }] };
      return { rows: [{ role: params[1] === "reader" ? "Consulta" : "Importação", importer_code: "ELETRA MATRIZ" }] };
    },
    async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = {
      issuer: "ci", subject, userId: processId, displayName: null, sessionToken: "ci",
    };
  });
  await registerOperationalRoutes(app, pool);

  const response = await app.inject({ method: "POST", url: `/api/v1/processes/${processId}/cancel`,
    headers: { "x-test-subject": "writer", "x-record-version": '"1"' },
    payload: { reason: "Cancel after review", purchaseOrders: [
      { purchaseOrderId: idlePoId, destinationType: "IDLE" },
      { purchaseOrderId: existingPoId, destinationType: "EXISTING", processId: targetProcessId },
      { purchaseOrderId: newDraftPoId, destinationType: "NEW", ipNumber: "IPH-NEW" },
    ] },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { id: processId, status: "CANCELLED", releasedAllocations: 1,
    linkedPurchaseOrders: 2, createdDraftIps: 1 });
  assert.equal(queries.filter(query => query.sql.includes("INSERT INTO procurement.process_purchase_order")).length, 2);
  assert.equal(queries.some(query => query.sql.includes("DELETE FROM procurement.process_purchase_order")), true);
  assert.equal(queries.some(query => query.sql.includes("SET record_status = 'CANCELLED'")), true);
  assert.equal(queries.some(query => query.sql.includes("'DRAFT')")), true);
  assert.equal(queries.some(query => query.sql.includes("UPDATE procurement.po_item_allocation SET status = 'CANCELLED'")), true);
  const draftInsert = queries.find(query => query.sql.includes("'CANCELLATION_TRANSFER'") && query.sql.includes("INSERT INTO imports.import_process"));
  assert.equal(draftInsert.params[5], null);
  assert.equal(draftInsert.params[6], null);
});

test("invoice import rejects a header CNPJ that does not map to the selected importer", async t => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("payload_sha256")) return { rows: [], rowCount: 0 };
      if (sql.includes("UNION SELECT importer FROM imports.import_process")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }], rowCount: 1 };
      }
      if (sql.includes("FROM catalog.operational_value")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }] };
      }
      return { rows: [{ role: params[1] === "reader" ? "Consulta" : "Importação",
        importer_code: "ELETRA MATRIZ" }] };
    },
    async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = {
      issuer: "ci", subject, userId: poId, displayName: null, sessionToken: "ci",
    };
  });
  await registerOperationalRoutes(app, pool);

  const invoicePayload = {
      process: { importer: "ELETRA MATRIZ", ipNumber: "IPH/TEST", supplierText: "SUP-TEST",
        logisticsStatus: "WAITING SHIPMENT", priority: null, notes: "", reason: "Invoice review" },
      invoice: { fileName: "invoice.xlsx", number: "INV-1", issueDate: null, amount: "10", currency: "CNY",
        metadata: { importerCnpj: "12345678000190", ipNumberFromInvoice: "IPH/TEST" } },
      allocations: [{ itemId: poId, quantity: "1", notes: "" }],
    };
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-cnpj-check" },
    payload: invoicePayload,
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "INVOICE_IMPORTER_CNPJ_MISMATCH");
  assert.ok(queries.some(sql => sql.includes("UPDATE") || sql.includes("INSERT INTO")) === false);
  const manualOverride = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-cnpj-manual-override" },
    payload: { ...invoicePayload, invoice: { ...invoicePayload.invoice,
      metadata: { ...invoicePayload.invoice.metadata, confirmImporterCnpjMismatch: true } } },
  });
  assert.equal(manualOverride.statusCode, 400);
  assert.equal(manualOverride.json().code, "INVALID_INVOICE_ASSIGNMENTS");
});

test("invoice import requires explicit confirmation for a PO supplier mismatch", async t => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("payload_sha256")) return { rows: [], rowCount: 0 };
      if (sql.includes("UNION SELECT importer FROM imports.import_process")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }], rowCount: 1 };
      }
      if (sql.includes("FROM catalog.operational_value")) return { rows: [{ ok: true }], rowCount: 1 };
      if (sql.includes("FROM procurement.purchase_order_item item JOIN procurement.purchase_order po")) {
        return { rows: [{ id: poId, purchase_order_id: "00000000-0000-4000-8000-000000000002",
          number: "PO030201", importer: "ELETRA MATRIZ", lifecycle_status: "ACTIVE",
          quantity: "10", product_code: "PO-CODE",
          supplier_entry_id: "00000000-0000-4000-8000-000000000003", supplier_text: "PO Supplier",
          supplier_name: "PO Supplier Ltd", supplier_code: "PO-SUP" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }] };
      }
      return { rows: [{ role: params[1] === "reader" ? "Consulta" : "Importação",
        importer_code: "ELETRA MATRIZ" }] };
    },
    async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = {
      issuer: "ci", subject, userId: poId, displayName: null, sessionToken: "ci",
    };
  });
  await registerOperationalRoutes(app, pool);

  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-supplier-check" },
    payload: {
      process: { importer: "ELETRA MATRIZ", ipNumber: "IPH/TEST", supplierText: "Exporter Ltd",
        logisticsStatus: "WAITING SHIPMENT", priority: null, notes: "", reason: "Invoice review" },
      invoice: { fileName: "invoice.xlsx", number: "INV-1", issueDate: null, amount: "10", currency: "CNY",
        metadata: { importerCnpj: "12345678000190", ipNumberFromInvoice: "IPH/TEST", exporterText: "Exporter Ltd",
          lines: [{ sourceRow: 16, productCode: "PO-CODE", quantity: "5", poCell: "PO030201" }],
          assignments: [{ itemId: poId, sourceRow: 16, sourcePoNumber: "PO030201", poNumber: "PO030201",
            poProductCode: "PO-CODE", productCode: "PO-CODE", quantity: "5",
            confirmSupplierMismatch: false }] } },
      allocations: [{ itemId: poId, quantity: "5", notes: "Invoice row 16" }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "INVOICE_SUPPLIER_MISMATCH_UNCONFIRMED");
  assert.equal(queries.some(sql => /^\s*(?:UPDATE|INSERT)\b/u.test(sql)), false);
});

test("invoice approval creates an active IP and allocates the invoice quantity from its PO", async t => {
  const { client, queries } = invoiceImportClient();
  const app = await invoiceImportApp(t, client);
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-create-success" },
    payload: invoicePayload(),
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(typeof response.json().id, "string");
  assert.equal(typeof response.json().documentId, "string");
  assert.equal(response.json().allocations, 1);
  assert.equal(response.json().ipNumber, "IPH/TEST");
  assert.equal(response.json().revision, false);
  const processInsert = queries.find(query => query.sql.includes("INSERT INTO imports.import_process"));
  assert.ok(processInsert.sql.includes("'ACTIVE'"));
  // The status is calculated from the IP dates; the invoice no longer forces WAITING SHIPMENT.
  assert.equal(processInsert.sql.includes("WAITING SHIPMENT"), false);
  assert.equal(processInsert.sql.includes("logistics_status"), false);
  const creation = queries.find(query => query.sql.includes("INSERT INTO audit.audit_log") && query.params[5] === "CREATE"
    && query.params[1] === "IMPORT_PROCESS" && query.params[3] === "IMPORT_PROCESS");
  assert.equal(JSON.parse(creation.params[7]).logisticsStatus, null);
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO procurement.po_item_allocation")
    && query.params[3] === 5));
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO imports.process_document")
    && query.sql.includes("'INVOICE'")));
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO audit.audit_log")));
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO audit.outbox_message")));
});

test("invoice import revalidates PO lifecycle status before writing", async t => {
  const { client, queries } = invoiceImportClient({ purchaseOrderStatus: "CLOSED" });
  const app = await invoiceImportApp(t, client);
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-closed-po" }, payload: invoicePayload(),
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "PO_NOT_ACTIVE");
  assert.equal(queries.some(query => query.sql.includes("INSERT INTO imports.import_process")), false);
});

test("confirmed invoice supplier divergence is persisted for the database constraint", async t => {
  const { client, queries } = invoiceImportClient({ supplierMatchesExporter: false });
  const app = await invoiceImportApp(t, client);
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-supplier-divergence" },
    payload: invoicePayload({ confirmSupplierMismatch: true }),
  });

  assert.equal(response.statusCode, 201, response.body);
  const processInsert = queries.find(query => query.sql.includes("INSERT INTO imports.import_process"));
  assert.equal(processInsert.params[6], null);
  assert.equal(processInsert.params[10], true);
  assert.ok(processInsert.sql.includes("invoice_supplier_divergence"));
});

test("an Exporter alias of the PO supplier matches the invoice without a supplier confirmation", async t => {
  const { client, queries } = invoiceImportClient({ supplierMatchesExporter: false, exporterAliases: ["EXPORTER LTD"] });
  const app = await invoiceImportApp(t, client);
  const payload = invoicePayload();
  payload.process.supplierText = payload.invoice.metadata.exporterText = "Exporter Ltd\nShangcheng Industrial Zone, 1418";
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-exporter-alias" }, payload });

  assert.equal(response.statusCode, 201, response.body);
  const items = queries.find(query => query.sql.includes("FROM procurement.purchase_order_item item JOIN procurement.purchase_order po"));
  assert.match(items.sql, /FROM catalog\.supplier_exporter_alias alias\s+WHERE alias\.supplier_entry_id = po\.supplier_entry_id AND alias\.status = 'ACTIVE'/u);
  const processInsert = queries.find(query => query.sql.includes("INSERT INTO imports.import_process"));
  assert.equal(processInsert.params[6], "00000000-0000-4000-8000-000000000003");
  assert.equal(processInsert.params[10], false);
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO audit.audit_log")
    && query.params.some(value => typeof value === "string" && value.includes('"supplierMatchedByAlias":true'))));
});

test("a short or unrelated Exporter alias still requires the supplier confirmation", async t => {
  for (const exporterAliases of [["EXPORTE"], ["OTHER COMPANY LTD"]]) {
    const { client } = invoiceImportClient({ supplierMatchesExporter: false, exporterAliases });
    const app = await invoiceImportApp(t, client);
    const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
      headers: { "x-test-subject": "writer", "idempotency-key": `invoice-alias-${exporterAliases[0].length}` },
      payload: invoicePayload() });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, "INVOICE_SUPPLIER_MISMATCH_UNCONFIRMED");
  }
});

test("invoice revision cancels the previous allocation and invoice before replacing them", async t => {
  const { client, queries, processId } = invoiceImportClient({ revision: true });
  const app = await invoiceImportApp(t, client);
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-revision-success", "x-record-version": '"2"' },
    payload: invoicePayload(),
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().id, processId);
  assert.equal(response.json().revision, true);
  assert.equal(queries.some(query => query.sql.includes("UPDATE imports.process_document SET status = 'CANCELLED'")), true);
  assert.equal(queries.some(query => query.sql.includes("UPDATE procurement.po_item_allocation SET status = 'CANCELLED'")), true);
  assert.equal(queries.some(query => query.sql.includes("INSERT INTO imports.import_process")), false);
  assert.equal(queries.filter(query => query.sql.includes("INSERT INTO procurement.po_item_allocation")).length, 1);
  // A revision keeps whatever status was informed on the IP.
  const processUpdate = queries.find(query => query.sql.includes("UPDATE imports.import_process SET record_status = 'ACTIVE'"));
  assert.equal(processUpdate.sql.includes("logistics_status"), false);
});

test("invoice revision of a shipped IP requires confirmation and a typed reason", async t => {
  const { client, queries } = invoiceImportClient({ revision: true, shipped: true });
  const app = await invoiceImportApp(t, client);
  const headers = key => ({ "x-test-subject": "writer", "idempotency-key": key, "x-record-version": '"2"' });
  const blocked = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: headers("invoice-shipped-blocked"), payload: invoicePayload() });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json().code, "IP_ALREADY_SHIPPED_UNCONFIRMED");
  const confirmed = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: headers("invoice-shipped-confirmed"),
    payload: { ...invoicePayload(), confirmShippedChange: true, shippedChangeReason: "Invoice corrigida pelo fornecedor" } });
  assert.equal(confirmed.statusCode, 201, confirmed.body);
  const revision = queries.find(query => query.sql.includes("INSERT INTO audit.audit_log") && query.params[5] === "REVISION");
  assert.equal(JSON.parse(revision.params[7]).confirmedShippedChange, true);
  assert.equal(JSON.parse(revision.params[7]).shippedChangeReason, "Invoice corrigida pelo fornecedor");
});

test("invoice revision asks to restore a deleted IP before reusing its number", async t => {
  const { client, queries } = invoiceImportClient({ revision: true, recordStatus: "DELETED" });
  const app = await invoiceImportApp(t, client);
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-revision-deleted-ip", "x-record-version": '"2"' },
    payload: invoicePayload(),
  });

  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, "DELETED_IP_REFERENCE");
  assert.equal(queries.some(query => query.sql.includes("UPDATE imports.import_process")), false);
  assert.equal(queries.some(query => query.sql.includes("INSERT INTO imports.process_document")), false);
});

test("invoice revision requires reopening a PO before changing its allocations", async t => {
  const { client, queries } = invoiceImportClient({ revision: true, previousAllocationPoStatus: "CLOSED" });
  const app = await invoiceImportApp(t, client);
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-revision-closed-po", "x-record-version": '"2"' },
    payload: invoicePayload(),
  });

  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, "PO_NOT_ACTIVE");
  assert.equal(queries.some(query => query.sql.includes("UPDATE procurement.po_item_allocation")), false);
});

test("invoice revision requires the version read by the client", async t => {
  const { client, queries } = invoiceImportClient({ revision: true });
  const app = await invoiceImportApp(t, client);
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-revision-without-version" },
    payload: invoicePayload(),
  });

  assert.equal(response.statusCode, 428, response.body);
  assert.equal(response.json().code, "PRECONDITION_REQUIRED");
  assert.equal(queries.some(query => query.sql.includes("UPDATE imports.process_document")), false);
  const processLookup = queries.find(query => query.sql.includes("normalized_ip_number = upper(btrim($1))"));
  assert.equal(processLookup.sql.includes("AND importer = $2"), false);
  assert.deepEqual(processLookup.params, ["IPH/TEST"]);
});

test("invoice candidates include PO supplier details even when they differ from the Exporter", async t => {
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }] };
      }
      if (sql.includes("FROM procurement.purchase_order_item item")) {
        return { rows: [{ id: poId, lineNumber: 1, productCode: "PO-CODE", description: "PO item",
          orderedQuantity: "10", unit: "PCS", remainingQuantity: "10", purchaseOrderId: "po-1",
          poStatus: "ACTIVE",
          poNumber: "PO030201", supplierEntryId: "supplier-1", supplierText: "PO Supplier",
          supplierName: "PO Supplier Ltd", supplierCode: "PO-SUP" }], rowCount: 1 };
      }
      return { rows: [{ role: params[1] === "reader" ? "Consulta" : "Importação",
        importer_code: "ELETRA MATRIZ" }] };
    },
    async connect() { throw new Error("Candidate lookup must not open a write transaction"); },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = {
      issuer: "ci", subject, userId: poId, displayName: null, sessionToken: "ci",
    };
  });
  await registerOperationalRoutes(app, pool);

  const response = await app.inject({ method: "GET",
    url: "/api/v1/purchase-orders/invoice-candidates?importer=ELETRA%20MATRIZ&productCode=INV-CODE&sourcePoNumber=PO030201",
    headers: { "x-test-subject": "writer" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items[0].supplierText, "PO Supplier");
  assert.equal(response.json().items[0].supplierName, "PO Supplier Ltd");
  assert.equal(response.json().items[0].supplierCode, "PO-SUP");
  assert.equal(response.json().poExists, true);
  assert.equal(response.json().purchaseOrderId, "po-1");
});

test("invoice candidate lookup distinguishes an unregistered PO from an empty registered PO", async t => {
  let exists = false;
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) return { rows: [{ importer: "ELETRA MATRIZ" }] };
      if (sql.includes("FROM procurement.purchase_order_item item")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT id, lifecycle_status FROM procurement.purchase_order")) return { rows: exists ? [{ id: poId,
        lifecycle_status: "CLOSED" }] : [], rowCount: exists ? 1 : 0 };
      return { rows: [{ role: "Importação", importer_code: "ELETRA MATRIZ" }] };
    }, async connect() { throw new Error("read only"); },
  };
  const app = Fastify(); t.after(() => app.close()); app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => { request.authContext = {
    issuer: "ci", subject: "writer", userId: poId, displayName: null, sessionToken: "ci" }; });
  await registerOperationalRoutes(app, pool);
  const url = "/api/v1/purchase-orders/invoice-candidates?importer=ELETRA%20MATRIZ&productCode=A&sourcePoNumber=PO030201";
  const missing = await app.inject({ method: "GET", url });
  assert.equal(missing.json().poExists, false);
  exists = true;
  const empty = await app.inject({ method: "GET", url });
  assert.equal(empty.json().poExists, true);
  assert.equal(empty.json().purchaseOrderId, poId);
  assert.equal(empty.json().poStatus, "CLOSED");
});

async function invoiceCandidateBatchApp(t, { dataQuery, scopes = ["ELETRA MATRIZ"] } = {}) {
  const dataQueries = [];
  let connections = 0;
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: scopes.map(importer => ({ importer })) };
      }
      if (sql.includes("FROM identity.erp_user")) {
        return { rows: scopes.map(importer_code => ({ role: "Importa\u00e7\u00e3o", importer_code })) };
      }
      dataQueries.push({ sql, params });
      return dataQuery?.(sql, params) ?? { rows: [], rowCount: 0 };
    },
    async connect() { connections += 1; throw new Error("Batch candidate lookup must not open a transaction"); },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => { request.authContext = {
    issuer: "ci", subject: "writer", userId: poId, displayName: null, sessionToken: "ci",
  }; });
  await registerOperationalRoutes(app, pool);
  return { app, dataQueries, connections: () => connections };
}

test("invoice candidate batch returns requested POs in order with two read queries", async t => {
  const { app, dataQueries, connections } = await invoiceCandidateBatchApp(t, {
    dataQuery(sql) {
      if (sql.includes("procurement.purchase_order_item item")) return { rows: [{
        sourcePoNumber: "PO 030201", id: poId, lineNumber: 2, productCode: "PO-CODE",
        description: "PO item", orderedQuantity: "10", unit: "PCS", unitPrice: "2",
        currency: "CNY", poNcmCode: "85044090", purchaseOrderId: "po-active",
        poNumber: "030201", poStatus: "ACTIVE", supplierEntryId: null, supplierText: "Supplier",
        supplierName: null, supplierCode: null, productId: null, productName: null,
        productNcmCode: null, manufacturer: null, manufacturerAddress: null,
        manufacturerCountry: null, remainingQuantity: "8",
      }], rowCount: 1 };
      return { rows: [
        { sourcePoNumber: "PO 030201", purchaseOrderId: "po-active", poStatus: "ACTIVE", otherImporters: [] },
        { sourcePoNumber: "030202", purchaseOrderId: "po-closed", poStatus: "CLOSED", otherImporters: [] },
        { sourcePoNumber: "MISSING", purchaseOrderId: null, poStatus: null, otherImporters: ["ELETRA FILIAL"] },
      ], rowCount: 3 };
    },
  });
  const response = await app.inject({ method: "POST",
    url: "/api/v1/purchase-orders/invoice-candidates/batch", headers: { "x-test-subject": "writer" },
    payload: { importer: "ELETRA MATRIZ", revisingIpNumber: "IPH/TEST",
      poNumbers: ["PO 030201", "030202", "MISSING", "PO 030201"] },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { purchaseOrders: [
    { sourcePoNumber: "PO 030201", poExists: true, purchaseOrderId: "po-active", poStatus: "ACTIVE", otherImporters: [],
      items: [{ id: poId, lineNumber: 2, productCode: "PO-CODE", description: "PO item",
        orderedQuantity: "10", unit: "PCS", unitPrice: "2", currency: "CNY", poNcmCode: "85044090",
        purchaseOrderId: "po-active", poNumber: "030201", poStatus: "ACTIVE", supplierEntryId: null,
        supplierText: "Supplier", supplierName: null, supplierCode: null, productId: null,
        productName: null, productNcmCode: null, manufacturer: null, manufacturerAddress: null,
        manufacturerCountry: null, remainingQuantity: "8" }] },
    { sourcePoNumber: "030202", poExists: true, purchaseOrderId: "po-closed", poStatus: "CLOSED", otherImporters: [], items: [] },
    { sourcePoNumber: "MISSING", poExists: false, purchaseOrderId: null, poStatus: null, otherImporters: ["ELETRA FILIAL"],
      items: [] },
  ] });
  assert.equal(dataQueries.length, 2);
  for (const query of dataQueries) {
    assert.deepEqual(query.params, ["ELETRA MATRIZ", ["PO 030201", "030202", "MISSING"], "IPH/TEST", ["ELETRA MATRIZ"]]);
    assert.match(query.sql, /unnest\(\$2::text\[\]\)/u);
    assert.match(query.sql, /requested/u);
  }
  assert.match(dataQueries[0].sql, /lifecycle_status = 'ACTIVE'/u);
  assert.match(dataQueries[0].sql, /source_status/u);
  assert.match(dataQueries[1].sql, /lifecycle_status = 'ACTIVE'.*DESC/su);
  // Other importers come only from the user's scope and only for a PO missing from the chosen importer.
  assert.match(dataQueries[1].sql, /CASE WHEN matching\.id IS NULL THEN ARRAY\(/u);
  assert.match(dataQueries[1].sql, /other\.importer <> \$1 AND other\.importer = ANY\(\$4::text\[\]\)/u);
  assert.match(dataQueries[1].sql, /AS "otherImporters"/u);
  assert.equal(connections(), 0);
});

test("invoice candidate batch returns the active Exporter aliases of each PO supplier", async t => {
  const { app, dataQueries } = await invoiceCandidateBatchApp(t, {
    dataQuery(sql) {
      if (sql.includes("procurement.purchase_order_item item")) return { rows: [{ sourcePoNumber: "030201", id: poId,
        lineNumber: 1, productCode: "PO-CODE", supplierEntryId: "supplier-1",
        supplierExporterAliases: ["HEXING ELECTRICAL CO.,LTD"], remainingQuantity: "8" }], rowCount: 1 };
      return { rows: [{ sourcePoNumber: "030201", purchaseOrderId: "po-active", poStatus: "ACTIVE" }], rowCount: 1 };
    },
  });
  const response = await app.inject({ method: "POST", url: "/api/v1/purchase-orders/invoice-candidates/batch",
    headers: { "x-test-subject": "writer" }, payload: { importer: "ELETRA MATRIZ", poNumbers: ["030201"] } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().purchaseOrders[0].items[0].supplierExporterAliases, ["HEXING ELECTRICAL CO.,LTD"]);
  assert.match(dataQueries[0].sql, /FROM catalog\.supplier_exporter_alias alias\s+WHERE alias\.supplier_entry_id = po\.supplier_entry_id AND alias\.status = 'ACTIVE'/u);
  assert.match(dataQueries[0].sql, /AS "supplierExporterAliases"/u);
});

test("invoice candidate batch validates input and importer scope before data queries", async t => {
  const { app, dataQueries, connections } = await invoiceCandidateBatchApp(t);
  const call = payload => app.inject({ method: "POST", url: "/api/v1/purchase-orders/invoice-candidates/batch",
    headers: { "x-test-subject": "writer" }, payload });
  for (const payload of [
    { importer: "ELETRA MATRIZ", poNumbers: [] },
    { importer: "ELETRA MATRIZ", poNumbers: Array.from({ length: 201 }, (_, index) => `PO-${index}`) },
    { importer: "ELETRA MATRIZ", poNumbers: ["PO-1"], extra: true },
  ]) assert.equal((await call(payload)).statusCode, 400);
  const outsideScope = await call({ importer: "OTHER IMPORTER", poNumbers: ["PO-1"] });
  assert.equal(outsideScope.statusCode, 404, outsideScope.body);
  assert.equal(dataQueries.length, 0);
  assert.equal(connections(), 0);
});

test("invoice balance errors identify the affected invoice row", async t => {
  const { client } = invoiceImportClient({ insufficientBalance: true });
  const app = await invoiceImportApp(t, client);
  const response = await app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-insufficient-line" }, payload: invoicePayload() });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "PO_BALANCE_CHANGED");
  assert.match(response.json().detail, /linha 16/i);
});

test("the invoice never overwrites the PO item and only fills empty product fields", async t => {
  const product = { id: "00000000-0000-4000-8000-000000000031", name: "BOTAO SILICONE", product_ncm_code: "39269090",
    manufacturer: null, manufacturer_address: " ", manufacturer_country: "CN" };
  const { client, queries } = invoiceImportClient({ catalogProduct: product });
  const app = await invoiceImportApp(t, client);
  const send = (key, catalogUpdates) => {
    const payload = invoicePayload();
    payload.invoice.metadata.catalogUpdates = catalogUpdates;
    return app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
      headers: { "x-test-subject": "writer", "idempotency-key": key }, payload });
  };
  const fill = { productCode: "PO-CODE", ncmCode: "40169990", manufacturer: "Hangzhou Shunhesheng",
    manufacturerAddress: "Hangzhou", manufacturerCountry: "BR" };

  const poItem = await send("invoice-po-item-update", { products: [], poItems: [{ itemId: poId,
    description: "Invoice text", unitPrice: "1", currency: "CNY", ncmCode: null }] });
  assert.equal(poItem.statusCode, 400, poItem.body);
  assert.equal(poItem.json().code, "INVOICE_PO_ITEM_UPDATE_NOT_ALLOWED");
  const renamed = await send("invoice-product-rename", { products: [{ ...fill, name: "Invoice text" }] });
  assert.equal(renamed.statusCode, 400, renamed.body);
  assert.equal(renamed.json().code, "INVALID_INVOICE_CATALOG_UPDATES");
  assert.equal(queries.some(query => query.sql.includes("UPDATE procurement.purchase_order_item")), false);

  const filled = await send("invoice-product-fill", { products: [fill] });
  assert.equal(filled.statusCode, 201, filled.body);
  const update = queries.find(query => query.sql.includes("UPDATE catalog.entry"));
  assert.doesNotMatch(update.sql, /\bname\s*=/u);
  assert.match(update.sql, /product_ncm_code = coalesce\(nullif\(btrim\(product_ncm_code\), ''\), \$2\)/u);
  assert.deepEqual(update.params.slice(0, 5), [product.id, "40169990", "Hangzhou Shunhesheng", "Hangzhou", "BR"]);

  const before = queries.filter(query => query.sql.includes("UPDATE catalog.entry")).length;
  const { client: fullClient, queries: fullQueries } = invoiceImportClient({ catalogProduct: { ...product,
    manufacturer: "Other", manufacturer_address: "Somewhere" } });
  const fullApp = await invoiceImportApp(t, fullClient);
  const payload = invoicePayload();
  payload.invoice.metadata.catalogUpdates = { products: [fill] };
  const unchanged = await fullApp.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": "invoice-product-complete" }, payload });
  assert.equal(unchanged.statusCode, 201, unchanged.body);
  assert.equal(fullQueries.some(query => query.sql.includes("UPDATE catalog.entry")), false);
  assert.equal(before, 1);
});

async function sendInvoice(app, key, payload) {
  return app.inject({ method: "POST", url: "/api/v1/processes/import-invoice",
    headers: { "x-test-subject": "writer", "idempotency-key": key }, payload });
}

function lessThanInvoicePayload(decision) {
  const payload = invoicePayload();
  payload.invoice.metadata.lines[0].quantity = "8";
  payload.invoice.metadata.lineDecisions = [{ sourceRow: 16, invoiceQuantity: "8", destinedQuantity: "5", ...decision }];
  return payload;
}

test("the analyst destines less than the invoice line with a confirmed reason", async t => {
  const { client, queries } = invoiceImportClient();
  const app = await invoiceImportApp(t, client);
  const response = await sendInvoice(app, "invoice-destined-less", lessThanInvoicePayload({
    confirmQuantityMismatch: true, quantityMismatchReason: "Saldo vem no próximo embarque" }));
  assert.equal(response.statusCode, 201, response.body);
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO procurement.po_item_allocation") && query.params[3] === 5));
  const document = queries.find(query => query.sql.includes("INSERT INTO imports.process_document"));
  assert.deepEqual(JSON.parse(document.params[6]).lineDecisions, [{ sourceRow: 16, invoiceQuantity: "8", destinedQuantity: "5",
    confirmQuantityMismatch: true, quantityMismatchReason: "Saldo vem no próximo embarque" }]);
  const audit = queries.find(query => query.sql.includes("INSERT INTO audit.audit_log")
    && query.params.some(value => typeof value === "string" && value.includes('"kind":"INVOICE"')));
  assert.deepEqual(JSON.parse(audit.params[7]).lineDecisions, [{ sourceRow: 16, productCode: "PO-CODE",
    invoiceQuantity: "8", destinedQuantity: "5", quantityMismatchReason: "Saldo vem no próximo embarque" }]);
});

test("a destined quantity different from the line needs the confirmation and a reason of 3 characters", async t => {
  const { client, queries } = invoiceImportClient();
  const app = await invoiceImportApp(t, client);
  for (const [name, payload] of [
    ["no-decision", (() => { const payload = lessThanInvoicePayload({}); delete payload.invoice.metadata.lineDecisions; return payload; })()],
    ["unconfirmed", lessThanInvoicePayload({ confirmQuantityMismatch: false, quantityMismatchReason: "Saldo no próximo" })],
    ["short-reason", lessThanInvoicePayload({ confirmQuantityMismatch: true, quantityMismatchReason: " ok " })],
  ]) {
    const response = await sendInvoice(app, `invoice-destined-${name}`, payload);
    assert.equal(response.statusCode, 400, `${name}: ${response.body}`);
    assert.equal(response.json().code, name === "no-decision" ? "INVOICE_LINE_QUANTITY_MISMATCH" : "INVOICE_QUANTITY_MISMATCH_UNCONFIRMED", name);
  }
  // The decision must describe the line and its assignments; the API does not trust the screen totals.
  for (const [name, change] of [
    ["invoice-quantity", payload => { payload.invoice.metadata.lineDecisions[0].invoiceQuantity = "9"; }],
    ["destined-total", payload => { payload.invoice.metadata.lineDecisions[0].destinedQuantity = "4"; }],
    ["unknown-row", payload => { payload.invoice.metadata.lineDecisions[0].sourceRow = 99; }],
  ]) {
    const payload = lessThanInvoicePayload({ confirmQuantityMismatch: true, quantityMismatchReason: "Saldo no próximo" });
    change(payload);
    const response = await sendInvoice(app, `invoice-decision-${name}`, payload);
    assert.equal(response.statusCode, 400, `${name}: ${response.body}`);
    assert.equal(response.json().code, name === "destined-total" ? "INVOICE_LINE_QUANTITY_MISMATCH" : "INVALID_INVOICE_LINE_DECISIONS", name);
  }
  assert.equal(queries.some(query => /^\s*INSERT INTO procurement\.po_item_allocation/u.test(query.sql)), false);
});

test("a line destined with 0 and a reason is saved without allocation and records whether its code is in the PO", async t => {
  const { client, queries } = invoiceImportClient({ codesInPo: [["030201", "PO-CODE"]] });
  const app = await invoiceImportApp(t, client);
  const payload = invoicePayload();
  payload.invoice.metadata.lines.push({ sourceRow: 17, productCode: "NEW-CODE", quantity: "3", poCell: "PO030201" });
  payload.invoice.metadata.lineDecisions = [
    { sourceRow: 16, invoiceQuantity: "5", destinedQuantity: "5", confirmQuantityMismatch: false, quantityMismatchReason: "" },
    { sourceRow: 17, invoiceQuantity: "3", destinedQuantity: "0", confirmQuantityMismatch: true,
      quantityMismatchReason: "Código não existe na PO" },
  ];
  const response = await sendInvoice(app, "invoice-destined-zero", payload);
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().allocations, 1);
  const lookup = queries.find(query => query.sql.includes("AS invoice_po_code"));
  assert.deepEqual(lookup.params, ["ELETRA MATRIZ", ["030201"], ["NEW-CODE"]]);
  const document = queries.find(query => query.sql.includes("INSERT INTO imports.process_document"));
  assert.equal(JSON.parse(document.params[6]).lineDecisions[1].codeFoundInPo, false);
  assert.equal(JSON.parse(document.params[6]).lineDecisions[0].codeFoundInPo, undefined);

  // The screen cannot claim the code exists: the API looks it up in the cited PO.
  const forged = structuredClone(payload);
  forged.invoice.metadata.lineDecisions[1].codeFoundInPo = true;
  const rejected = await sendInvoice(app, "invoice-destined-zero-forged", forged);
  assert.equal(rejected.statusCode, 400, rejected.body);
  assert.equal(rejected.json().code, "INVALID_INVOICE_LINE_DECISIONS");
});

test("an assignment to a PO item with another code is refused even with the old confirmation", async t => {
  const { client } = invoiceImportClient();
  const app = await invoiceImportApp(t, client);
  const payload = invoicePayload();
  payload.invoice.metadata.lines[0].productCode = "INV-CODE";
  payload.invoice.metadata.assignments[0].productCode = "INV-CODE";
  const response = await sendInvoice(app, "invoice-other-code", payload);
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().code, "INVOICE_PRODUCT_CODE_MISMATCH");
  payload.invoice.metadata.assignments[0].confirmCodeMismatch = true;
  const confirmed = await sendInvoice(app, "invoice-other-code-confirmed", payload);
  assert.equal(confirmed.statusCode, 400, confirmed.body);
  assert.equal(confirmed.json().code, "INVALID_INVOICE_ASSIGNMENTS");
});

test("a line can fill two PO items with its code, each within its own balance", async t => {
  const { client, queries } = invoiceImportClient({ secondItem: true });
  const app = await invoiceImportApp(t, client);
  const payload = invoicePayload();
  payload.invoice.amount = "28";
  payload.invoice.metadata.lines[0].quantity = "14";
  const second = { ...payload.invoice.metadata.assignments[0], itemId: secondItemId, quantity: "4" };
  payload.invoice.metadata.assignments[0].quantity = "10";
  payload.invoice.metadata.assignments.push(second);
  payload.allocations = [{ itemId: poId, quantity: "10", notes: "" }, { itemId: secondItemId, quantity: "4", notes: "" }];
  const response = await sendInvoice(app, "invoice-two-items", payload);
  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual(queries.filter(query => query.sql.includes("INSERT INTO procurement.po_item_allocation"))
    .map(query => [query.params[1], query.params[3]]), [[poId, 10], [secondItemId, 4]]);

  const over = structuredClone(payload);
  over.invoice.metadata.lines[0].quantity = "15";
  over.invoice.metadata.assignments[0].quantity = "11";
  over.allocations[0].quantity = "11";
  const refused = await sendInvoice(app, "invoice-two-items-over", over);
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().code, "PO_BALANCE_CHANGED");
});

test("the assignments, allocations and line decisions built by the web screen are accepted by the invoice route", async t => {
  const { invoiceLineDecisions, invoiceSavePayload } = await import("../../web/lib/china-invoice-mapping.ts");
  const { client } = invoiceImportClient();
  const app = await invoiceImportApp(t, client);
  const payload = invoicePayload();
  payload.invoice.metadata.lines[0].quantity = "8";
  const { assignments, allocations } = invoiceSavePayload("INV-1", [{ sourceRow: 16, sourcePoNumber: "PO030201",
    productCode: "PO-CODE", itemId: poId, poNumber: "PO030201", poProductCode: "PO-CODE", quantity: "5",
    confirmSupplierMismatch: false, confirmUnitMismatch: false, confirmPriceMismatch: false }]);
  payload.invoice.metadata.assignments = assignments;
  payload.allocations = allocations;
  payload.invoice.metadata.lineDecisions = invoiceLineDecisions(payload.invoice.metadata.lines,
    [{ sourceRow: 16, invoiceQuantity: "8", quantity: "5" }], { 16: { confirmed: true, reason: "Saldo no próximo embarque" } });
  const response = await sendInvoice(app, "invoice-web-decisions", payload);
  assert.equal(response.statusCode, 201, response.body);
});
