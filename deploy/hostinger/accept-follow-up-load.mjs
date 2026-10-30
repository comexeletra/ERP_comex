// Acceptance of the Follow Up load through the real API routes of the HML release. Every list is
// read and the operations the analysts need run on the loaded data; each change is undone at the
// end. It refuses anything but erp_po_totvs_hml.
//
//   MIGRATION_ENV=isolated ERP_API_RELEASE_DIR=/opt/import-erp/apps/api/hml-release-<sha> \
//     /opt/node-v24/bin/node --env-file=/etc/import-erp/homologation-db.env accept-follow-up-load.mjs
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const reason = "Teste de aceite da carga histórica";
const permissions = ["purchase-orders.read", "purchase-orders.write", "purchase-orders.lifecycle.manage", "processes.read",
  "processes.write", "processes.lifecycle.manage", "quality.read", "quality.resolve", "catalog.read", "catalog.write",
  "purchase-requests.read", "purchase-requests.write"];

async function open() {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
    throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
  }
  const releaseDir = resolve(process.env.ERP_API_RELEASE_DIR ?? "");
  const releaseRequire = createRequire(join(releaseDir, "package.json"));
  const load = specifier => import(pathToFileURL(releaseRequire.resolve(specifier)).href);
  const dist = file => import(pathToFileURL(join(releaseDir, "dist", file)).href);
  const { default: Fastify } = await load("fastify");
  const { default: pg } = await load("pg");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4, application_name: "hml-follow-up-acceptance" });
  const target = (await pool.query("SELECT current_database() AS database")).rows[0];
  if (target.database !== "erp_po_totvs_hml") throw new Error("Wrong database.");
  const actor = (await pool.query("SELECT id FROM identity.erp_user ORDER BY id LIMIT 1")).rows[0];
  const importerScopes = (await pool.query("SELECT DISTINCT importer FROM procurement.purchase_order")).rows.map(row => row.importer);
  const app = Fastify();
  app.decorateRequest("authContext", null);
  app.decorateRequest("authorizationContext", null);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "hml-acceptance", subject: "follow-up-load", userId: actor.id,
      displayName: "HML acceptance", sessionToken: "hml-acceptance" };
    request.authorizationContext = { roles: ["Master"], permissions: new Set(permissions), importerScopes };
  });
  for (const [file, name] of [["followup.js", "registerFollowupRoutes"], ["operations.js", "registerOperationalRoutes"],
    ["processes.js", "registerProcessReadRoutes"], ["purchase-orders.js", "registerPurchaseOrderReadRoutes"],
    ["shipment-lines.js", "registerShipmentLineRoutes"], ["source-audit.js", "registerSourceAuditRoutes"],
    ["data-issues.js", "registerDataIssueRoutes"], ["purchase-requests.js", "registerPurchaseRequestRoutes"]]) {
    await (await dist(file))[name](app, pool);
  }
  return { app, pool };
}

async function run() {
  const { app, pool } = await open();
  let failures = 0;
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
    if (!ok) failures += 1;
  };
  const call = async (method, url, payload, headers = {}) => {
    const started = performance.now();
    const response = await app.inject({ method, url, payload, headers: { "content-type": "application/json", ...headers } });
    return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null,
      ms: Math.round(performance.now() - started) };
  };
  const row = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
  const version = async (table, id) => ({ "X-Record-Version": (await row(`SELECT version::text AS v FROM ${table} WHERE id = $1`, [id])).v });
  const poRoute = id => `/api/v1/purchase-orders/${id}`;
  const header = po => ({ number: po.number, supplierText: po.supplierText, orderDate: null, notes: po.notes ?? "", reason });

  const undo = [];
  try {
    for (const [name, url, total] of [
      ["PO portfolio", "/api/v1/purchase-orders?page=1&pageSize=50&lifecycle=all", body => body.totalCount ?? body.total],
      ["open PO portfolio", "/api/v1/purchase-orders?page=1&pageSize=50&lifecycle=active", body => body.totalCount ?? body.total],
      ["PO summary", "/api/v1/purchase-orders/summary", null],
      ["product lines", "/api/v1/purchase-order-lines?page=1&pageSize=50&situation=all", body => body.totalCount],
      ["End to End stages", "/api/v1/purchase-order-lines/e2e-stages?situation=all", body => body.totalCount],
      ["IP list", "/api/v1/processes?page=1&pageSize=50", body => body.totalCount ?? body.total],
      ["pre-shipment report", "/api/v1/reports/summary?scope=pre", null],
      ["post-shipment report", "/api/v1/reports/summary?scope=post", null],
      ["source audit", "/api/v1/source-rows?sheet=all&page=1&pageSize=50", body => body.totalCount],
      ["source audit Pre", "/api/v1/source-rows?sheet=Pr%C3%A9%20Embarque&page=1&pageSize=50", body => body.totalCount],
      ["source audit Post", "/api/v1/source-rows?sheet=P%C3%B3s%20Embarque&page=1&pageSize=50", body => body.totalCount],
      ["source audit values", "/api/v1/source-rows/column-values?column=AB&sheet=Pr%C3%A9%20Embarque", null],
      ["quality issues", "/api/v1/data-issues?page=1&pageSize=50", body => body.totalCount ?? body.total],
      ["SC list", "/api/v1/purchase-requests", body => body.items?.length],
    ]) {
      const response = await call("GET", url);
      check(name, response.status === 200 && response.ms < 4000, `HTTP ${response.status} in ${response.ms} ms${total ? `, total ${total(response.body)}` : ""}`);
    }

    const audit = await call("GET", "/api/v1/source-rows?sheet=Pr%C3%A9%20Embarque&page=1&pageSize=50");
    check("source audit shows the new columns", ["BC", "BD", "BE"].every(column => audit.body.columns.includes(column)),
      ["BC", "BD", "BE"].map(column => audit.body.columnHeaders[column]));

    const sample = await row(`SELECT po.id FROM procurement.purchase_order po WHERE po.external_number = '030201'`);
    const loaded = (await call("GET", `${poRoute(sample.id)}/operational`)).body;
    check("PO 030201 keeps its number, analyst and items", loaded.number === "030201" && loaded.items.length > 200,
      { analyst: loaded.analyst, si: loaded.siNumber, demandType: loaded.demandType, items: loaded.items.length });
    const overview = await call("GET", `${poRoute(sample.id)}/overview`);
    check("PO overview", overview.status === 200, `HTTP ${overview.status} in ${overview.ms} ms`);
    const history = await call("GET", `${poRoute(sample.id)}/history-items?page=1&pageSize=25`);
    check("PO history lines", history.status === 200 && history.body.items.length > 0, `HTTP ${history.status}, ${history.body.items?.length} lines`);
    const followup = await call("GET", `${poRoute(sample.id)}/followup`);
    check("PO follow-up", followup.status === 200 && followup.ms < 2000, `HTTP ${followup.status} in ${followup.ms} ms`);

    const ip = await row(`SELECT p.id, p.ip_number, p.documents_ok_date::text AS documents, p.container_quantity::text AS containers, p.supplier_entry_id, p.importer
      FROM imports.import_process p WHERE p.delivery_date IS NULL AND p.bl_date IS NOT NULL ORDER BY p.ip_number LIMIT 1`);
    const process = await call("GET", `/api/v1/processes/${ip.id}`);
    check("IP detail", process.status === 200 && process.body.purchaseOrders?.length > 0, `${ip.ip_number}, HTTP ${process.status}`);
    const processItems = await call("GET", `/api/v1/processes/${ip.id}/items?page=1&pageSize=25`);
    check("IP source lines", processItems.status === 200 && processItems.body.items?.length > 0, `HTTP ${processItems.status}, ${processItems.body.items?.length} lines`);

    // Open PO: the optional fields are saved and the other header values stay.
    const openPo = await row(`SELECT id FROM procurement.purchase_order WHERE lifecycle_status = 'ACTIVE' AND supplier_entry_id IS NOT NULL
      AND external_number <> '030201' ORDER BY external_number LIMIT 1`);
    const before = (await call("GET", `${poRoute(openPo.id)}/operational`)).body;
    undo.push(async () => {
      const saved = await call("PATCH", poRoute(openPo.id), { ...header(before), analyst: before.analyst, siNumber: before.siNumber },
        await version("procurement.purchase_order", openPo.id));
      check("undo PO header", saved.status === 200, `HTTP ${saved.status}`);
    });
    const edited = await call("PATCH", poRoute(openPo.id), { ...header(before), analyst: "EVELINE", siNumber: "999, 1000" },
      await version("procurement.purchase_order", openPo.id));
    const reread = (await call("GET", `${poRoute(openPo.id)}/operational`)).body;
    check("historical PO saves analyst and SI", edited.status === 200 && reread.analyst === "EVELINE" && reread.siNumber === "999, 1000"
      && reread.demandType === before.demandType, `HTTP ${edited.status}`);
    const renumber = await call("PATCH", poRoute(openPo.id), { ...header(before), number: "999999" },
      await version("procurement.purchase_order", openPo.id));
    check("historical PO keeps its identity", renumber.status === 409, `HTTP ${renumber.status} ${renumber.body?.code ?? ""}`);

    // Open IP: Doc ok date and half a container.
    undo.push(async () => {
      const saved = await call("PATCH", `/api/v1/processes/${ip.id}/followup`, { fields: { documentsOkDate: ip.documents, containerQuantity: ip.containers }, reason },
        await version("imports.import_process", ip.id));
      check("undo IP fields", saved.status === 200, `HTTP ${saved.status}`);
    });
    const ipEdit = await call("PATCH", `/api/v1/processes/${ip.id}/followup`, { fields: { documentsOkDate: "2026-10-30", containerQuantity: "0.5" }, reason },
      await version("imports.import_process", ip.id));
    const ipRead = await row("SELECT documents_ok_date::text AS d, container_quantity::text AS c FROM imports.import_process WHERE id = $1", [ip.id]);
    check("historical IP saves Doc ok date and 0.5 container", ipEdit.status === 200 && ipRead.d === "2026-10-30" && Number(ipRead.c) === 0.5,
      `HTTP ${ipEdit.status} ${JSON.stringify(ipRead)}`);

    // The quality queue can be worked: a PO without supplier receives one.
    const pending = await row("SELECT id, version::text FROM procurement.purchase_order WHERE external_number = '031335'");
    const pendingPo = (await call("GET", `${poRoute(pending.id)}/operational`)).body;
    undo.push(async () => {
      const saved = await call("PATCH", poRoute(pending.id), { ...header(pendingPo), supplierText: null },
        await version("procurement.purchase_order", pending.id));
      const entry = await row("SELECT supplier_entry_id FROM procurement.purchase_order WHERE id = $1", [pending.id]);
      check("undo PO supplier", saved.status === 200 && entry.supplier_entry_id === null, `HTTP ${saved.status}`);
    });
    const supplied = await call("PATCH", poRoute(pending.id), { ...header(pendingPo), supplierText: "HEXING" },
      await version("procurement.purchase_order", pending.id));
    const supplierRow = await row("SELECT supplier_entry_id FROM procurement.purchase_order WHERE id = $1", [pending.id]);
    check("PO without supplier can be corrected", supplied.status === 200 && supplierRow.supplier_entry_id !== null, `HTTP ${supplied.status}`);

    // Balance: an open line without IP is distributed to an IP of the same supplier, and released again.
    const open = await row(`SELECT item.id, item.purchase_order_id, item.ordered_quantity::text AS quantity, process.id AS process_id, process.ip_number
      FROM procurement.purchase_order_item AS item
      JOIN procurement.purchase_order AS po ON po.id = item.purchase_order_id AND po.lifecycle_status = 'ACTIVE'
      JOIN imports.import_process AS process ON process.importer = po.importer AND process.supplier_entry_id = po.supplier_entry_id
        AND process.record_status = 'ACTIVE' AND process.lifecycle_status = 'OPEN' AND process.bl_date IS NULL
      WHERE upper(coalesce(item.source_status, '')) <> 'CANCELLED'
        AND NOT EXISTS (SELECT 1 FROM procurement.po_item_allocation a WHERE a.purchase_order_item_id = item.id AND a.status = 'ACTIVE')
      ORDER BY po.external_number, item.line_number LIMIT 1`);
    check("there is an open line and a compatible IP", Boolean(open), open?.ip_number ?? "");
    if (open) {
      const allocated = await call("POST", `${poRoute(open.purchase_order_id)}/allocations`, { itemId: open.id, processId: open.process_id,
        quantity: open.quantity, factoryShipDate: null, notes: "", reason }, { "Idempotency-Key": `acceptance-${randomUUID()}` });
      check("open historical line is distributed to an IP", allocated.status === 201, `HTTP ${allocated.status} ${allocated.body?.code ?? ""}`);
      if (allocated.status === 201) {
        const allocationId = allocated.body.id;
        const released = await call("DELETE", `${poRoute(open.purchase_order_id)}/allocations/${allocationId}`, { reason },
          await version("procurement.po_item_allocation", allocationId));
        check("the distribution is released", released.status === 200, `HTTP ${released.status} ${released.body?.code ?? ""}`);
        console.log(`CLEANUP allocation ${allocationId}`);
      }
    }
    const blocked = await row(`SELECT item.id, item.purchase_order_id, item.ordered_quantity::text AS quantity, process.id AS process_id
      FROM procurement.purchase_order_item AS item
      JOIN procurement.purchase_order AS po ON po.id = item.purchase_order_id AND po.lifecycle_status = 'ACTIVE'
      JOIN imports.import_process AS process ON process.importer = po.importer AND process.supplier_entry_id <> po.supplier_entry_id
        AND process.record_status = 'ACTIVE' AND process.lifecycle_status = 'OPEN' AND process.bl_date IS NULL
      WHERE NOT EXISTS (SELECT 1 FROM procurement.po_item_allocation a WHERE a.purchase_order_item_id = item.id AND a.status = 'ACTIVE')
        AND upper(coalesce(item.source_status, '')) <> 'CANCELLED' LIMIT 1`);
    check("there is an IP of another supplier that has not shipped", Boolean(blocked));
    if (blocked) {
      const refused = await call("POST", `${poRoute(blocked.purchase_order_id)}/allocations`, { itemId: blocked.id, processId: blocked.process_id,
        quantity: blocked.quantity, factoryShipDate: null, notes: "", reason }, { "Idempotency-Key": `acceptance-${randomUUID()}` });
      // Same importer, open IP and free quantity: the supplier is the only rule this request breaks.
      check("an IP of another supplier is refused", refused.status === 409 && /viola uma regra do pedido/u.test(JSON.stringify(refused.body)),
        `HTTP ${refused.status} ${JSON.stringify(refused.body).slice(0, 160)}`);
    }

    // Closed PO: reopened and closed again.
    const closed = await row("SELECT id FROM procurement.purchase_order WHERE lifecycle_status = 'CLOSED' ORDER BY external_number LIMIT 1");
    const reopened = await call("POST", `${poRoute(closed.id)}/reopen`, { reason }, await version("procurement.purchase_order", closed.id));
    check("closed PO can be reopened", reopened.status === 200, `HTTP ${reopened.status}`);
    const closedAgain = await call("POST", `${poRoute(closed.id)}/close`, { reason }, await version("procurement.purchase_order", closed.id));
    check("and closed again", closedAgain.status === 200, `HTTP ${closedAgain.status} ${closedAgain.body?.code ?? ""}`);

    // Price without currency: the analyst completes it.
    const priced = await row(`SELECT item.id, item.purchase_order_id, item.product_code, item.description, item.ordered_quantity::text AS quantity,
        item.unit_price::text AS price
      FROM procurement.purchase_order_item item
      JOIN procurement.purchase_order po ON po.id = item.purchase_order_id AND po.lifecycle_status = 'ACTIVE'
      JOIN catalog.entry product ON product.kind = 'PRODUCT' AND product.normalized_code = upper(btrim(item.product_code))
      WHERE item.unit_price IS NOT NULL AND item.currency_code IS NULL ORDER BY po.external_number LIMIT 1`);
    check("there is a catalogued item with price and no currency", Boolean(priced));
    if (priced) {
      const completed = await call("PATCH", `${poRoute(priced.purchase_order_id)}/items/${priced.id}`, { externalLineReference: null,
        productCode: priced.product_code, description: priced.description, orderedQuantity: priced.quantity, unit: "UN", unitPrice: priced.price,
        currency: "USD", reason }, await version("procurement.purchase_order", priced.purchase_order_id));
      check("the missing currency can be filled in", completed.status === 200, `HTTP ${completed.status} ${completed.body?.code ?? ""} ${completed.body?.detail ?? ""}`);
      if (completed.status === 200) {
        await pool.query("UPDATE procurement.purchase_order_item SET currency_code = NULL, unit = NULL WHERE id = $1", [priced.id]);
        console.log("Undone: item currency and unit.");
      }
    }
  } finally {
    for (const step of undo.reverse()) await step();
    await app.close();
    await pool.end();
  }
  console.log(failures ? `ACCEPTANCE FAILED: ${failures}` : "ACCEPTANCE OK");
  if (failures) process.exitCode = 1;
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
