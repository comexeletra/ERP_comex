import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ExcelJS from "exceljs";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl
  || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
  throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000,
  application_name: "export-worker-hml-validation" });
const target = await pool.query("SELECT current_database() AS database, current_user AS role");
if (target.rows[0]?.database !== "erp_po_totvs_hml" || target.rows[0]?.role !== "import_erp_hml_app") {
  await pool.end();
  throw new Error("The HML integration requires erp_po_totvs_hml with role import_erp_hml_app.");
}

const context = await pool.query("SELECT id FROM identity.erp_user ORDER BY id LIMIT 1");
const importer = await pool.query(
  `SELECT importer FROM procurement.purchase_order ORDER BY lifecycle_status = 'ACTIVE' DESC, importer LIMIT 1`,
);
if (!context.rows[0] || !importer.rows[0]) {
  await pool.end();
  throw new Error("HML lacks an ERP user or purchase-order importer for export validation.");
}

const jobIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test("HML worker completes both Excel export job types, with and without chosen columns", async t => {
  t.after(async () => {
    await pool.query("DELETE FROM jobs.export_job WHERE id = ANY($1::uuid[])", [jobIds]);
    await pool.end();
  });

  await pool.query(
    `INSERT INTO jobs.export_job
       (id, job_type, requested_by, importer_scopes, requested_as_master, parameters)
     VALUES ($1, 'purchase-order-xlsx', $3, $4::text[], false, '{}'::jsonb),
            ($2, 'purchase-order-lines-xlsx', $3, $4::text[], false, '{"situation":"all"}'::jsonb),
            ($5, 'purchase-order-xlsx', $3, $4::text[], false, $6::jsonb),
            ($7, 'purchase-order-lines-xlsx', $3, $4::text[], false, $8::jsonb),
            ($9, 'purchase-order-lines-xlsx', $3, $4::text[], false, $10::jsonb)`,
    [jobIds[0], jobIds[1], context.rows[0].id, [importer.rows[0].importer],
      jobIds[2], JSON.stringify({ lifecycle: "all", context: "portfolio",
        columns: [{ key: "lifecycleStatus", header: "Status" }, { key: "itemCount", header: "Itens" }] }),
      jobIds[3], JSON.stringify({ situation: "all", stage: "T3", view: "reached", context: "end-to-end",
        columns: [{ key: "accumulatedDelay", header: "Atraso acumulado até T3" }, { key: "totalDelay", header: "Atraso" }] }),
      jobIds[4], JSON.stringify({ situation: "all", context: "product-lines", columns: [{ key: "t0Deadline", header: "T0" }] })],
  );

  const deadline = Date.now() + 60_000;
  let rows = [];
  while (Date.now() < deadline) {
    rows = (await pool.query(
      `SELECT id, job_type, status, error_code, result_binary
       FROM jobs.export_job WHERE id = ANY($1::uuid[]) ORDER BY array_position($1::uuid[], id)`,
      [jobIds],
    )).rows;
    if (rows.length === jobIds.length && rows.every(row => row.status === "completed" || row.status === "failed")) break;
    await pause(1_000);
  }

  assert.deepEqual(rows.map(row => [row.job_type, row.status, row.error_code]), [
    ["purchase-order-xlsx", "completed", null],
    ["purchase-order-lines-xlsx", "completed", null],
    ["purchase-order-xlsx", "completed", null],
    ["purchase-order-lines-xlsx", "completed", null],
    ["purchase-order-lines-xlsx", "failed", "INVALID_EXPORT_COLUMNS"],
  ]);
  const headers = async binary => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(binary);
    return workbook.worksheets[0].getRow(1).values.slice(1);
  };
  assert.equal((await headers(rows[0].result_binary)).length, 8);
  assert.equal((await headers(rows[1].result_binary)).length, 92);
  assert.deepEqual(await headers(rows[2].result_binary), ["PO TOTVS", "Status", "Itens"]);
  assert.deepEqual(await headers(rows[3].result_binary), ["PO", "Produto", "Atraso acumulado até T3", "Atraso"]);
  for (const row of rows.slice(0, 4)) {
    assert.ok(Buffer.isBuffer(row.result_binary), `${row.job_type} did not produce binary output`);
    assert.equal(row.result_binary.subarray(0, 2).toString("ascii"), "PK", row.job_type);
  }
});
