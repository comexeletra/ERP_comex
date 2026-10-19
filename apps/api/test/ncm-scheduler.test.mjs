import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { NcmRefreshDeferred, readNcmSyncState, runCoordinatedNcmRefresh,
  startDurableNcmRefresh } from "../dist/ncm-scheduler.js";
import { nextBrasiliaNcmRefresh } from "../dist/ncm-sync.js";

function fakePool() {
  const row = { last_attempt_at: null, last_success_at: null, last_source: null,
    last_siscomex_success_at: null, last_error: null,
    next_attempt_at: new Date(Date.now() - 1), retry_mode: true };
  let lockHeld = false;
  const query = async (sql, values = []) => {
    if (sql.includes("pg_try_advisory_lock")) {
      const acquired = !lockHeld;
      lockHeld = true;
      return { rows: [{ acquired }] };
    }
    if (sql.includes("pg_advisory_unlock")) { lockHeld = false; return { rows: [] }; }
    if (sql.includes("FROM catalog.ncm_sync_state")) return { rows: [{ ...row }] };
    if (sql.includes("UPDATE catalog.ncm_sync_state")) {
      if (sql.includes("last_attempt_at=now()")) {
        row.last_attempt_at = new Date();
        row.next_attempt_at = values[0];
        row.retry_mode = false;
        row.last_error = "Tentativa interrompida antes da conclusão.";
      } else if (values.length === 4) {
        row.last_success_at = new Date();
        row.last_source = values[0];
        if (values[0] === "SISCOMEX") row.last_siscomex_success_at = new Date();
        row.last_error = values[1];
        row.next_attempt_at = values[2];
        row.retry_mode = values[3];
      } else {
        row.last_error = values[0];
        row.next_attempt_at = values[1];
        row.retry_mode = false;
      }
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const client = Object.assign(new EventEmitter(), { query, release() {} });
  return { query, async connect() { return client; }, row, client };
}

const mdicResult = { catalogSource: "MDIC_GECEX", siscomexRetryAt: null,
  siscomexFailure: "Siscomex HTTP 422; catálogo MDIC carregado.",
  matchedCount: 1, updatedCount: 1, inactivatedCount: 1,
  attributesUpdatedCount: 0, preservedUnmatchedCount: 0,
  sourceUpdatedAt: "2026-10-05", attributesSourceVersion: "not-provided" };

test("MDIC cannot mark a synchronization successful or change the Siscomex catalog", async () => {
  const pool = fakePool();
  let calls = 0;
  await assert.rejects(runCoordinatedNcmRefresh(pool, async () => {
    calls += 1; return mdicResult;
  }, "06:00,12:00", "automatic"), /MDIC está inativa/u);
  const state = await readNcmSyncState(pool);
  assert.equal(state.lastSource, null);
  assert.equal(state.lastSiscomexSuccessAt, null);
  assert.equal(state.retryMode, false);
  assert.match(state.lastError, /MDIC está inativa/u);
  assert.ok(Date.parse(state.nextAttemptAt) > Date.now());
  await assert.rejects(runCoordinatedNcmRefresh(pool, async () => {
    calls += 1; return mdicResult;
  }, "06:00,12:00", "automatic"), NcmRefreshDeferred);
  const stop = startDurableNcmRefresh(pool, "06:00,12:00", async () => {
    calls += 1; return mdicResult;
  }, { info() {}, error() {} });
  await new Promise(resolve => setImmediate(resolve));
  stop();
  assert.equal(calls, 1);
});

test("failed sync keeps the last success and waits for the next fixed slot", async () => {
  const pool = fakePool();
  pool.row.last_source = "SISCOMEX";
  pool.row.last_siscomex_success_at = new Date("2026-10-15T12:00:00Z");
  const releaseAt = Date.now() + 10 * 60_000;
  await assert.rejects(runCoordinatedNcmRefresh(pool, async () => {
    throw Object.assign(new Error("Siscomex HTTP 422"), { retryAt: releaseAt });
  }, "06:00,12:00", "automatic"), /422/u);
  const state = await readNcmSyncState(pool);
  assert.equal(state.lastSource, "SISCOMEX");
  assert.equal(state.lastSiscomexSuccessAt, "2026-10-15T12:00:00.000Z");
  assert.equal(Date.parse(state.nextAttemptAt), nextBrasiliaNcmRefresh(releaseAt, "06:00,12:00"));
  assert.equal(state.retryMode, false);
});

test("a lost lock connection is handled without an unhandled client error", async () => {
  const pool = fakePool();
  await assert.rejects(runCoordinatedNcmRefresh(pool, async () => {
    pool.client.emit("error", new Error("Connection terminated unexpectedly"));
    throw new Error("Database unavailable during snapshot");
  }, "06:00,12:00", "manual"), /Database unavailable/u);
  assert.match(pool.row.last_error, /Database unavailable/u);
});
