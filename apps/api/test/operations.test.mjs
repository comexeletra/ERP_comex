import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerOperationalRoutes } from "../dist/operations.js";

const poId = "00000000-0000-4000-8000-000000000001";
const body = { importer: "ELETRA MATRIZ", number: "PO-TESTE", supplierText: "SUP-TESTE",
  orderDate: null, notes: "", reason: "Pedido conferido" };

async function invoiceImportApp(t, client) {
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }] };
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

function invoicePayload({ confirmSupplierMismatch = false } = {}) {
  return {
    process: { importer: "ELETRA MATRIZ", ipNumber: "IPH/TEST", supplierText: "Exporter Ltd",
      logisticsStatus: "WAITING SHIPMENT", priority: null, notes: "", reason: "Invoice review" },
    invoice: { fileName: "invoice.xlsx", number: "INV-1", issueDate: null, amount: "10", currency: "CNY",
      metadata: { importerCnpj: "12345678000190", ipNumberFromInvoice: "IPH/TEST", exporterText: "Exporter Ltd",
        lines: [{ sourceRow: 16, productCode: "PO-CODE", quantity: "5", poCell: "PO030201" }],
        assignments: [{ itemId: poId, sourceRow: 16, sourcePoNumber: "PO030201", poNumber: "PO030201",
          poProductCode: "PO-CODE", productCode: "PO-CODE", quantity: "5", confirmCodeMismatch: false,
          confirmSupplierMismatch }], catalogUpdates: { products: [], poItems: [] } } },
    allocations: [{ itemId: poId, quantity: "5", notes: "Invoice row 16" }],
  };
}

function invoiceImportClient({ revision = false, supplierMatchesExporter = true } = {}) {
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
      if (sql.includes("FROM procurement.purchase_order_item item JOIN procurement.purchase_order po")) {
        return { rows: [{ id: poId, purchase_order_id: "00000000-0000-4000-8000-000000000002",
          number: "PO030201", importer: "ELETRA MATRIZ", quantity: "10", product_code: "PO-CODE",
          supplier_entry_id: "00000000-0000-4000-8000-000000000003",
          supplier_text: supplierMatchesExporter ? "Exporter Ltd" : "PO Supplier",
          supplier_name: supplierMatchesExporter ? "Exporter Ltd" : "PO Supplier Ltd",
          supplier_code: supplierMatchesExporter ? "EXPORTER" : "PO-SUP" }], rowCount: 1 };
      }
      if (sql.includes("normalized_ip_number = upper(btrim($1))")) {
        return revision ? { rows: [{ id: processId, importer: "ELETRA MATRIZ", ip_number: "IPH/TEST",
          normalized_ip_number: "IPH/TEST", record_status: "ACTIVE", lifecycle_status: "OPEN", version: "2" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT 1 FROM imports.process_document")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT * FROM imports.process_document") && sql.includes("kind = 'INVOICE'")) {
        return revision ? { rows: [{ id: oldDocumentId, process_id: processId, kind: "INVOICE", status: "ACTIVE" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT * FROM procurement.po_item_allocation WHERE process_id")) {
        return revision ? { rows: [{ id: oldAllocationId, process_id: processId,
          purchase_order_item_id: poId, quantity: "5", status: "ACTIVE" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT item.id, item.ordered_quantity::text")) {
        return { rows: [{ id: poId, ordered_quantity: "10", allocated_quantity: "0" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { client, queries, processId, oldDocumentId, oldAllocationId };
}

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
          number: "PO030201", importer: "ELETRA MATRIZ", quantity: "10", product_code: "PO-CODE",
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
          lines: [{ sourceRow: 16, productCode: "INV-CODE", quantity: "5", poCell: "PO030201" }],
          assignments: [{ itemId: poId, sourceRow: 16, sourcePoNumber: "PO030201", poNumber: "PO030201",
            poProductCode: "PO-CODE", productCode: "INV-CODE", quantity: "5", confirmCodeMismatch: true,
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
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO imports.import_process")
    && query.sql.includes("'WAITING SHIPMENT'") && query.sql.includes("'ACTIVE'")));
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO procurement.po_item_allocation")
    && query.params[3] === 5));
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO imports.process_document")
    && query.sql.includes("'INVOICE'")));
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO audit.audit_log")));
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO audit.outbox_message")));
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
  assert.ok(processLookup.sql.includes("AND importer = $2"));
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
});
