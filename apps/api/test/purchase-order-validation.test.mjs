import assert from "node:assert/strict";
import test from "node:test";
import { BusinessError, validateNewPurchaseOrder, validatePurchaseOrderItems } from "../dist/operations.js";

function validationClient({ cnpj = "12.345.678/0001-90", duplicates = [], supplier = true, request = null,
  products = ["PRODUCT-1"], units = ["UN"], costCenters = ["1202027"] } = {}) {
  const client = { async query(sql, params = []) {
    if (sql.includes("catalog.operational_value")) assert.doesNotMatch(sql, /\bstatus\s*=/iu);
    if (sql.includes("entity_key='IMPORTER'")) return { rows: cnpj ? [{ cnpj }] : [] };
    if (sql.includes("FROM procurement.purchase_order") && sql.includes("normalized_number")) {
      return { rows: duplicates.filter(item => params[1].includes(item.importer)) };
    }
    if (sql.includes("FROM catalog.entry") && sql.includes("kind='SUPPLIER'")) {
      return { rows: supplier ? [{ id: "supplier-id", code: "SUP-1", name: "Fornecedor" }] : [] };
    }
    if (sql.includes("FROM procurement.purchase_request") && sql.includes("supplier_text")) {
      return { rows: request ? [request] : [] };
    }
    if (sql.includes("FROM catalog.entry") && sql.includes("kind='PRODUCT'")) {
      return { rows: params[0].filter(code => products.includes(code))
        .map(normalized_code => ({ normalized_code, product_ncm_code: "39269090" })) };
    }
    if (sql.includes("entity_key='UNIT_OF_MEASURE'")) {
      return { rows: params[0].filter(value => units.includes(value)).map(normalized_value => ({ normalized_value })) };
    }
    if (sql.includes("entity_key='COST_CENTER'")) {
      return { rows: params[0].filter(value => costCenters.includes(value)).map(normalized_value => ({ normalized_value })) };
    }
    return { rows: [] };
  } };
  return client;
}

const scopes = ["ELETRA MATRIZ", "ELETRA MANAUS"];
const header = { importer: "ELETRA MATRIZ", number: "030201", supplierText: "SUP-1" };

test("new PO validation rejects importers without a CNPJ", async () => {
  await assert.rejects(validateNewPurchaseOrder(validationClient({ cnpj: null }), header, scopes),
    error => error instanceof BusinessError && error.code === "IMPORTER_CNPJ_REQUIRED");
});

test("same-importer duplicate PO numbers are blocked and cross-importer duplicates need a reason", async () => {
  const same = validationClient({ duplicates: [{ importer: "ELETRA MATRIZ" }] });
  await assert.rejects(validateNewPurchaseOrder(same, header, scopes),
    error => error instanceof BusinessError && error.code === "PO_NUMBER_EXISTS_IN_IMPORTER");

  const other = validationClient({ duplicates: [{ importer: "ELETRA MANAUS" }] });
  await assert.rejects(validateNewPurchaseOrder(other, header, scopes),
    error => error instanceof BusinessError && error.code === "PO_NUMBER_OTHER_IMPORTER_CONFIRMATION_REQUIRED");
  const confirmed = await validateNewPurchaseOrder(validationClient({ duplicates: [{ importer: "ELETRA MANAUS" }] }),
    { ...header, confirmDuplicateNumber: true, duplicateNumberJustification: "POs de filiais diferentes" }, scopes);
  assert.deepEqual(confirmed.otherImporterDuplicates, ["ELETRA MANAUS"]);
});

test("linked SC must have the same importer and supplier", async () => {
  const client = validationClient({ request: { id: "sc-id", importer: "ELETRA MATRIZ", supplier_text: "SUP-2",
    supplier_code: "SUP-2", sc_number: "020028", sc_date: null, approval_date: null,
    requester: "Analista", commercial_plan_received_date: null } });
  await assert.rejects(validateNewPurchaseOrder(client, { ...header, purchaseRequestId: "sc-id" }, scopes),
    error => error instanceof BusinessError && error.code === "PURCHASE_REQUEST_SUPPLIER_MISMATCH");
});

test("PO items require active catalog products and registered unit and cost center values", async () => {
  const items = [{ productCode: "PRODUCT-1", unit: "UN", costCenter: "1202027" }];
  assert.equal((await validatePurchaseOrderItems(validationClient(), items)).get("PRODUCT-1"), "39269090");
  await assert.rejects(validatePurchaseOrderItems(validationClient({ products: [] }), items),
    error => error instanceof BusinessError && error.code === "UNKNOWN_PRODUCT");
  await assert.rejects(validatePurchaseOrderItems(validationClient({ units: [] }), items),
    error => error instanceof BusinessError && error.code === "UNKNOWN_UNIT_OF_MEASURE");
  await assert.rejects(validatePurchaseOrderItems(validationClient({ costCenters: [] }), items),
    error => error instanceof BusinessError && error.code === "UNKNOWN_COST_CENTER");
});
