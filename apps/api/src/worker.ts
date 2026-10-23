import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { queryPurchaseOrderExport, purchaseOrderExportXlsx, purchaseOrderLinesXlsx,
  type PurchaseOrderExportFilters } from "./purchase-order-exports.js";
import { queryShipmentLines, shipmentLineQuery } from "./shipment-lines.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL não configurada para o worker.");

const parsedDatabaseUrl = new URL(connectionString);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
if (process.env.NODE_ENV === "production" && !loopbackHosts.has(parsedDatabaseUrl.hostname)) {
  throw new Error("A conexão PostgreSQL de produção deve permanecer local à VPS.");
}

const pool = new Pool({
  connectionString,
  max: 1,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 60_000,
  application_name: "import-erp-export-worker",
});

type ExportJob = {
  id: string;
  job_type: string;
  importer_scopes: string[];
  parameters: PurchaseOrderExportFilters | Record<string, unknown>;
  attempt_count: number;
};

class PermanentJobError extends Error {
  constructor(readonly code: string) { super(code); }
}

const workerId = randomUUID();
let stopping = false;
let nextCleanupAt = 0;

async function cleanupExpiredJobs(): Promise<void> {
  if (Date.now() < nextCleanupAt) return;
  nextCleanupAt = Date.now() + 60_000;
  await pool.query("DELETE FROM jobs.export_job WHERE expires_at <= now()");
}

async function claimJob(): Promise<ExportJob | null> {
  await pool.query(
    `UPDATE jobs.export_job
     SET status = 'failed', error_code = 'WORKER_RETRIES_EXHAUSTED', completed_at = now(),
         expires_at = now() + interval '7 days', lease_owner = NULL, lease_expires_at = NULL
     WHERE status = 'running' AND lease_expires_at <= now() AND attempt_count >= 3`,
  );

  const result = await pool.query<ExportJob>(
    `WITH candidate AS (
       SELECT id FROM jobs.export_job
       WHERE ((status = 'queued' AND available_at <= now())
          OR (status = 'running' AND lease_expires_at <= now()))
         AND attempt_count < 3
       ORDER BY available_at, created_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE jobs.export_job AS job
     SET status = 'running', attempt_count = job.attempt_count + 1,
         lease_owner = $1, lease_expires_at = now() + interval '5 minutes',
         started_at = coalesce(job.started_at, now()), error_code = NULL
     FROM candidate
     WHERE job.id = candidate.id
     RETURNING job.id, job.job_type, job.importer_scopes, job.parameters, job.attempt_count`,
    [workerId],
  );
  return result.rows[0] ?? null;
}

async function completeJob(job: ExportJob, workbook: Buffer): Promise<void> {
  await pool.query(
    `UPDATE jobs.export_job
     SET status = 'completed', result_binary = $3, result_text = NULL, completed_at = now(),
         expires_at = now() + interval '24 hours', lease_owner = NULL, lease_expires_at = NULL
     WHERE id = $1 AND status = 'running' AND lease_owner = $2`,
    [job.id, workerId, workbook],
  );
}

async function failJob(job: ExportJob, error: unknown): Promise<void> {
  const permanent = error instanceof PermanentJobError;
  const errorCode = permanent ? error.code : "EXPORT_PROCESSING_FAILED";
  const terminal = permanent || job.attempt_count >= 3;
  const delaySeconds = Math.min(60, 5 * (2 ** Math.max(0, job.attempt_count - 1)));
  await pool.query(
    `UPDATE jobs.export_job
     SET status = $3,
         available_at = CASE WHEN $3 = 'queued' THEN now() + make_interval(secs => $4) ELSE available_at END,
         error_code = $5,
         completed_at = CASE WHEN $3 = 'failed' THEN now() ELSE NULL END,
         expires_at = CASE WHEN $3 = 'failed' THEN now() + interval '7 days' ELSE NULL END,
         lease_owner = NULL, lease_expires_at = NULL
     WHERE id = $1 AND status = 'running' AND lease_owner = $2`,
    [job.id, workerId, terminal ? "failed" : "queued", delaySeconds, errorCode],
  );
  console.error(JSON.stringify({ event: "export_job_failed", jobId: job.id, errorCode,
    attempt: job.attempt_count, retrying: !terminal }));
}

async function processJob(job: ExportJob): Promise<void> {
  try {
    if (job.job_type === "purchase-order-lines-xlsx") {
      const filters = shipmentLineQuery.safeParse(job.parameters);
      if (!filters.success) throw new PermanentJobError("INVALID_EXPORT_FILTERS");
      const result = await queryShipmentLines(pool, job.importer_scopes, filters.data, 5001, 0);
      if (result.totalCount > 5000) throw new PermanentJobError("EXPORT_TOO_LARGE");
      await completeJob(job, await purchaseOrderLinesXlsx(result.lines));
      console.info(JSON.stringify({ event: "export_job_completed", jobId: job.id, rowCount: result.lines.length }));
      return;
    }
    if (job.job_type !== "purchase-order-xlsx" && job.job_type !== "purchase-order-csv") {
      throw new PermanentJobError("UNSUPPORTED_JOB_TYPE");
    }
    const result = await queryPurchaseOrderExport(pool, job.importer_scopes, job.parameters as PurchaseOrderExportFilters);
    if (result.totalCount > 5000) throw new PermanentJobError("EXPORT_TOO_LARGE");
    await completeJob(job, await purchaseOrderExportXlsx(result.rows));
    console.info(JSON.stringify({ event: "export_job_completed", jobId: job.id, rowCount: result.rows.length }));
  } catch (error) {
    await failJob(job, error);
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

try {
  console.info(JSON.stringify({ event: "export_worker_started", workerId }));
  while (!stopping) {
    await cleanupExpiredJobs();
    const job = await claimJob();
    if (job) await processJob(job);
    else await delay(1000);
  }
} finally {
  await pool.end();
  console.info(JSON.stringify({ event: "export_worker_stopped", workerId }));
}
