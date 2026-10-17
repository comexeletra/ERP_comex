import assert from "node:assert/strict";
import test from "node:test";
import { nextBrasiliaNcmRefresh, startDailyNcmRefresh } from "../dist/ncm-sync.js";

test("NCM refresh is scheduled at 06:00 and 12:00 Brasilia time", () => {
  const beforeSix = Date.parse("2026-10-16T08:59:00.000Z"); // 05:59 in Brasilia
  assert.equal(nextBrasiliaNcmRefresh(beforeSix, "06:00,12:00"), Date.parse("2026-10-16T09:00:00.000Z"));
  const afterSix = Date.parse("2026-10-16T09:05:00.000Z");
  assert.equal(nextBrasiliaNcmRefresh(afterSix, "06:00,12:00"), Date.parse("2026-10-16T15:00:00.000Z"));
  const afterTwelve = Date.parse("2026-10-16T15:01:00.000Z");
  assert.equal(nextBrasiliaNcmRefresh(afterTwelve, "06:00,12:00"), Date.parse("2026-10-17T09:00:00.000Z"));
});

test("NCM scheduler rejects invalid fixed times", () => {
  assert.throws(() => nextBrasiliaNcmRefresh(Date.now(), "25:00,12:00"), /HH:mm/u);
  assert.throws(() => nextBrasiliaNcmRefresh(Date.now(), "06:00,3h"), /HH:mm/u);
});

test("automatic refresh runs only at the configured slots", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse("2026-10-16T08:59:00.000Z") });
  let calls = 0;
  const logger = { info() {}, error() {} };
  const stop = startDailyNcmRefresh("06:00,12:00", async () => {
    calls += 1;
    return { matchedCount: 0, updatedCount: 0, attributesUpdatedCount: 0,
      preservedUnmatchedCount: 0, sourceUpdatedAt: null, attributesSourceVersion: null };
  }, logger);
  t.after(stop);

  t.mock.timers.tick(60_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  t.mock.timers.tick(6 * 60 * 60 * 1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
});

test("a failed Siscomex slot does not retry before the next fixed slot", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse("2026-10-16T08:59:00.000Z") });
  let calls = 0;
  const stop = startDailyNcmRefresh("06:00,12:00", async () => {
    calls += 1;
    throw new Error("Siscomex indisponível");
  }, { info() {}, error() {} });
  t.after(stop);
  t.mock.timers.tick(60_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  t.mock.timers.tick(5 * 60 * 60 * 1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  t.mock.timers.tick(60 * 60 * 1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
});
