import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fetchRetryingTransient, isTransientStatus, transientRetryDelaysMs } from "../lib/transient-retry.ts";

const response = status => new Response(status === 200 ? "{}" : "", { status });
const noWait = async () => undefined;

test("only server and gateway failures are transient; client errors are not retried", () => {
  for (const status of [500, 502, 503, 504]) assert.equal(isTransientStatus(status), true, String(status));
  for (const status of [200, 400, 401, 403, 404, 409, 422, 429]) assert.equal(isTransientStatus(status), false, String(status));
  assert.deepEqual([...transientRetryDelaysMs], [1000, 3000]);
});

test("a transient failure is tried again after each delay until it succeeds", async () => {
  const statuses = [500, 503, 200];
  const waits = [];
  let calls = 0;
  const result = await fetchRetryingTransient(async () => response(statuses[calls++]), new AbortController().signal,
    [1000, 3000], async ms => { waits.push(ms); });
  assert.equal(result.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 3000]);
});

test("after the last retry the failure is returned to show its message", async () => {
  let calls = 0;
  const result = await fetchRetryingTransient(async () => { calls++; return response(500); }, new AbortController().signal,
    [1000, 3000], noWait);
  assert.equal(result.status, 500);
  assert.equal(calls, 3);
});

test("a client error is returned at once, without retrying", async () => {
  let calls = 0;
  const result = await fetchRetryingTransient(async () => { calls++; return response(400); }, new AbortController().signal,
    [1000, 3000], noWait);
  assert.equal(result.status, 400);
  assert.equal(calls, 1);
});

test("a network failure is retried, but a cancelled request stops at once", async () => {
  let calls = 0;
  const result = await fetchRetryingTransient(async () => {
    calls++;
    if (calls === 1) throw new TypeError("Failed to fetch");
    return response(200);
  }, new AbortController().signal, [1000], noWait);
  assert.equal(result.status, 200);
  assert.equal(calls, 2);

  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(fetchRetryingTransient(async () => { attempts++; controller.abort(); return response(500); },
    controller.signal, [1000, 3000], noWait), { name: "AbortError" });
  assert.equal(attempts, 1);
});

test("the wait between retries ends early when the request is cancelled", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const pending = fetchRetryingTransient(async () => response(503), controller.signal, [60_000]);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, { name: "AbortError" });
  assert.ok(Date.now() - started < 5000);
});

test("the retry helper stays free of UI text and value imports", async () => {
  const source = await readFile(new URL("../lib/transient-retry.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import\s+(?!type\b)/mu);
});
