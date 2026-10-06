import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "../dist/password.js";

const databaseUrl = process.env.GATEWAY_FLOW_DB_URL;
const webOrigin = process.env.GATEWAY_FLOW_WEB_ORIGIN;
if (!databaseUrl || !webOrigin) throw new Error("Set GATEWAY_FLOW_DB_URL and GATEWAY_FLOW_WEB_ORIGIN.");
const database = new URL(databaseUrl);
const web = new URL(webOrigin);
if (!new Set(["127.0.0.1", "localhost", "[::1]" ]).has(database.hostname)
  || !/(?:_ci|_test)$/u.test(decodeURIComponent(database.pathname.slice(1)))
  || !new Set(["127.0.0.1", "localhost", "[::1]"]).has(web.hostname)) {
  throw new Error("This test requires a disposable local *_ci or *_test database and local Next.js.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const suffix = randomUUID().slice(0, 8);
const reason = "Conferência integrada local";
const password = randomBytes(24).toString("base64url");
const email = `ci-${suffix}@example.invalid`;
let cookie = "";
let csrf = "";

async function call(method, path, body, version) {
  const response = await fetch(new URL(path, webOrigin), {
    method,
    headers: {
      origin: webOrigin,
      ...(cookie ? { cookie } : {}),
      ...(csrf && method !== "GET" ? { "x-csrf-token": csrf } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "POST" && path !== "/auth/local/login" ? { "idempotency-key": randomUUID() } : {}),
      ...(version ? { "x-record-version": version } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; }
  catch { throw new Error(`${method} ${path} returned non-JSON HTTP ${response.status}: ${raw.slice(0, 200)}`); }
  return { response, data };
}
function expectStatus(result, status) {
  assert.equal(result.response.status, status, JSON.stringify(result.data));
  return result.data;
}

try {
  const importerRow = await pool.query("SELECT importer FROM procurement.purchase_order ORDER BY id LIMIT 1");
  assert.ok(importerRow.rows[0], "Seed at least one importer in the disposable database.");
  const importer = importerRow.rows[0].importer;
  const userId = randomUUID();
  await pool.query("INSERT INTO identity.erp_user(id,issuer,subject,display_name) VALUES($1,'ci:gateway',$2,'CI Gateway')",
    [userId, suffix]);
  await pool.query("INSERT INTO identity.erp_user_role(user_id,role) VALUES($1,'Importação')", [userId]);
  await pool.query("INSERT INTO identity.erp_user_importer_scope(user_id,importer_code) VALUES($1,$2)", [userId, importer]);
  await pool.query(`INSERT INTO identity.local_credential(user_id,email,password_hash,must_change_password)
    VALUES($1,$2,$3,false)`, [userId, email, await hashPassword(password)]);

  const login = await call("POST", "/auth/local/login", { email, password });
  expectStatus(login, 200);
  cookie = login.response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  assert.ok(cookie.startsWith("erp_session="));
  const me = expectStatus(await call("GET", "/auth/me"), 200);
  assert.ok(me.roles.includes("Importação"));
  assert.ok(me.importerScopes.includes(importer));
  csrf = expectStatus(await call("GET", "/auth/csrf"), 200).token;

  const sc = expectStatus(await call("POST", "/api/v1/requests", {
    importer, requesterReference: `CI-GW-SC-${suffix}`, reason,
    notes: "Solicitação do teste integrado",
    items: [{ description: "Produto solicitado", purposeText: null, costCenterText: null }],
  }), 201);
  assert.equal(expectStatus(await call("GET", `/api/v1/requests/${sc.id}`), 200).requestNumber, sc.requestNumber);

  const completePo = expectStatus(await call("POST", "/api/v1/purchase-orders/complete", {
    header: { importer, number: `CI-GW-COMPLETE-${suffix}`, supplierText: "Fornecedor CI",
      orderDate: "2026-10-05", notes: "Cadastro completo", reason },
    items: ["C", "D"].map((letter, index) => ({
      base: { externalLineReference: letter, productCode: `CI-${letter}-${suffix}`,
        description: `Produto ${letter}`, orderedQuantity: index ? "25" : "100", unit: "PC",
        unitPrice: null, currency: null, reason },
      fields: { scNumber: sc.requestNumber, scApprovalDate: "2026-08-01", requester: "Analista CI" },
    })),
  }), 201);
  assert.equal(completePo.itemIds.length, 2);
  const completeReadback = expectStatus(await call("GET", `/api/v1/purchase-orders/${completePo.id}/followup`), 200);
  assert.equal(completeReadback.items.length, 2);
  assert.ok(completeReadback.items.every(item => item.scApprovalDate === "2026-08-01"
    && item.scNumber === sc.requestNumber && item.requester === "Analista CI"));
  const completePersisted = await pool.query(`SELECT count(*)::int AS count FROM procurement.purchase_order_item
    WHERE purchase_order_id=$1 AND sc_approval_date=$2`, [completePo.id, "2026-08-01"]);
  assert.equal(completePersisted.rows[0].count, 2);

  const po = expectStatus(await call("POST", "/api/v1/purchase-orders", {
    importer, number: `CI-GW-PO-${suffix}`, supplierText: "Fornecedor CI",
    orderDate: "2026-10-05", notes: "Teste de ponta a ponta", reason,
  }), 201);
  const createItem = async (quantity, code) => expectStatus(await call("POST",
    `/api/v1/purchase-orders/${po.id}/items`, {
      externalLineReference: null, productCode: code, description: `Produto ${code}`,
      orderedQuantity: quantity, unit: "PC", unitPrice: null, currency: null, reason,
    }), 201);
  const first = await createItem("100", `CI-A-${suffix}`);
  const second = await createItem("25", `CI-B-${suffix}`);
  let operational = expectStatus(await call("GET", `/api/v1/purchase-orders/${po.id}/operational`), 200);
  const sharedDateRejected = await call("PATCH", `/api/v1/purchase-orders/${po.id}/items/${first.id}/followup`,
    { fields: { actualFactoryShipDate: "2026-08-20" }, reason }, operational.version);
  assert.equal(sharedDateRejected.statusCode, 400);
  expectStatus(await call("PATCH", `/api/v1/purchase-orders/${po.id}/items/${first.id}/followup`,
    { fields: { scNumber: sc.requestNumber, scApprovalDate: "2026-08-01" }, reason }, operational.version), 200);
  operational = expectStatus(await call("GET", `/api/v1/purchase-orders/${po.id}/operational`), 200);
  const shared = expectStatus(await call("PATCH", `/api/v1/purchase-orders/${po.id}/items/followup`, {
    itemIds: [first.id, second.id], fields: { requester: "Analista do teste" }, reason,
  }, operational.version), 200);
  assert.equal(shared.updatedCount, 2);
  const ip = async number => expectStatus(await call("POST", "/api/v1/processes", {
    importer, ipNumber: `CI-GW-${number}-${suffix}`, logisticsStatus: null,
    priority: null, notes: "", reason,
  }), 201);
  const ip1 = await ip("IP1");
  const ip2 = await ip("IP2");
  const allocate = async (itemId, processId, quantity) => expectStatus(await call("POST",
    `/api/v1/purchase-orders/${po.id}/allocations`, {
      itemId, processId, quantity, notes: "", reason,
    }), 201);
  const firstAllocation = await allocate(first.id, ip1.id, "40");
  const secondAllocation = await allocate(first.id, ip2.id, "60");
  await allocate(second.id, ip2.id, "25");
  expectStatus(await call("PATCH", `/api/v1/purchase-orders/${po.id}/allocations/${firstAllocation.id}`,
    { factoryShipDate: "2026-08-20", reason }, firstAllocation.version), 200);
  expectStatus(await call("PATCH", `/api/v1/purchase-orders/${po.id}/allocations/${secondAllocation.id}`,
    { factoryShipDate: "2026-08-28", reason }, secondAllocation.version), 200);
  operational = expectStatus(await call("GET", `/api/v1/purchase-orders/${po.id}/operational`), 200);
  assert.equal(operational.allocations.length, 3);
  assert.ok(operational.items.every(item => Number(item.remainingQuantity) === 0));
  const poFollowup = expectStatus(await call("GET", `/api/v1/purchase-orders/${po.id}/followup`), 200);
  assert.equal(poFollowup.items.find(item => item.id === first.id).scNumber, sc.requestNumber);
  assert.equal(poFollowup.items.find(item => item.id === first.id).scApprovalDate, "2026-08-01");
  assert.ok(poFollowup.items.every(item => item.requester === "Analista do teste"));
  assert.equal(poFollowup.shipments.find(item => item.allocationId === firstAllocation.id).factoryShipDate, "2026-08-20");
  assert.equal(poFollowup.shipments.find(item => item.allocationId === secondAllocation.id).factoryShipDate, "2026-08-28");
  assert.equal(operational.items.find(item => item.id === first.id).remainingQuantity, "0.00000000");

  expectStatus(await call("PATCH", `/api/v1/processes/${ip1.id}/followup`, {
    fields: { etd: "2026-09-01", actualPortDepartureDate: "2026-09-03", arrivalDate: "2026-10-01" }, reason,
  }, "1"), 200);
  expectStatus(await call("PATCH", `/api/v1/processes/${ip2.id}/followup`, {
    fields: { etd: "2026-09-15", arrivalDate: "2026-11-10", deliveryDate: "2026-11-18" }, reason,
  }, "1"), 200);
  const ip1Followup = expectStatus(await call("GET", `/api/v1/processes/${ip1.id}/followup`), 200);
  const ip2Followup = expectStatus(await call("GET", `/api/v1/processes/${ip2.id}/followup`), 200);
  assert.equal(ip1Followup.process.actualPortDepartureDate, "2026-09-03");
  assert.equal(ip2Followup.process.actualPortDepartureDate, null);
  assert.equal(ip2Followup.allocations.length, 2);
  assert.equal(ip1Followup.allocations.find(item => item.id === firstAllocation.id).factoryShipDate, "2026-08-20");
  assert.equal(ip2Followup.allocations.find(item => item.id === secondAllocation.id).factoryShipDate, "2026-08-28");

  const closed = expectStatus(await call("POST", `/api/v1/processes/${ip1.id}/close`, { reason }, "2"), 200);
  assert.equal(closed.lifecycleStatus, "CLOSED");
  expectStatus(await call("PATCH", `/api/v1/processes/${ip1.id}/followup`,
    { fields: { etd: "2026-09-02" }, reason }, "3"), 409);
  const reopened = expectStatus(await call("POST", `/api/v1/processes/${ip1.id}/reopen`, { reason }, "3"), 200);
  assert.equal(reopened.lifecycleStatus, "OPEN");

  const stored = await pool.query(`SELECT i.sc_number, i.sc_approval_date, p1.actual_port_departure_date AS first_departure,
    p2.actual_port_departure_date AS second_departure, p2.delivery_date AS second_delivery,
    (SELECT factory_ship_date FROM procurement.po_item_allocation WHERE id=$5) AS first_factory_departure,
    (SELECT factory_ship_date FROM procurement.po_item_allocation WHERE id=$6) AS second_factory_departure,
    (SELECT count(*)::int FROM procurement.po_item_allocation a
      JOIN procurement.purchase_order_item item ON item.id=a.purchase_order_item_id
      WHERE item.purchase_order_id=$1 AND a.status='ACTIVE') AS allocation_count
    FROM procurement.purchase_order_item i
    CROSS JOIN imports.import_process p1 CROSS JOIN imports.import_process p2
    WHERE i.id=$2 AND p1.id=$3 AND p2.id=$4`,
    [po.id, first.id, ip1.id, ip2.id, firstAllocation.id, secondAllocation.id]);
  assert.equal(stored.rows[0].sc_number, sc.requestNumber);
  assert.equal(stored.rows[0].sc_approval_date.toISOString().slice(0, 10), "2026-08-01");
  assert.equal(stored.rows[0].first_departure.toISOString().slice(0, 10), "2026-09-03");
  assert.equal(stored.rows[0].second_departure, null);
  assert.equal(stored.rows[0].second_delivery.toISOString().slice(0, 10), "2026-11-18");
  assert.equal(stored.rows[0].first_factory_departure.toISOString().slice(0, 10), "2026-08-20");
  assert.equal(stored.rows[0].second_factory_departure.toISOString().slice(0, 10), "2026-08-28");
  assert.equal(stored.rows[0].allocation_count, 3);
  console.log("Next.js → gateway → API → PostgreSQL flow passed (SC, complete PO, shared fields, split PO, IP dates, closure).");
} finally {
  await pool.end();
}
