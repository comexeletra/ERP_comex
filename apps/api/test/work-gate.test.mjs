import assert from "node:assert/strict";
import test from "node:test";
import { createWorkGate, WorkCancelledError } from "../dist/work-gate.js";

/** A job that only ends when the test releases it. */
function job(name, log) {
  let release;
  const done = new Promise(resolve => { release = resolve; });
  return { release: () => release(name), run: async () => { log.push(`start ${name}`); const value = await done; log.push(`end ${name}`); return value; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("no more than the limit runs at once; the others wait in arrival order", async () => {
  const gate = createWorkGate(2);
  const log = [];
  const jobs = ["a", "b", "c", "d"].map(name => job(name, log));
  const results = jobs.map(item => gate.run(item.run));
  await tick();
  assert.deepEqual(log, ["start a", "start b"]);
  assert.deepEqual([gate.active, gate.waiting], [2, 2]);
  jobs[1].release();
  await tick();
  assert.deepEqual(log, ["start a", "start b", "end b", "start c"]);
  jobs[0].release(); jobs[2].release(); jobs[3].release();
  assert.deepEqual(await Promise.all(results), ["a", "b", "c", "d"]);
  assert.deepEqual([gate.active, gate.waiting], [0, 0]);
});

test("a failed job frees its place for the next one", async () => {
  const gate = createWorkGate(1);
  const failed = gate.run(async () => { throw new Error("boom"); });
  const thrown = gate.run(() => { throw new Error("before the promise"); });
  const next = gate.run(async () => "next");
  await assert.rejects(failed, /boom/u);
  await assert.rejects(thrown, /before the promise/u);
  assert.equal(await next, "next");
  assert.equal(gate.active, 0);
});

test("a job whose request was cancelled while waiting never runs", async () => {
  const gate = createWorkGate(1);
  const log = [];
  const first = job("first", log);
  const running = gate.run(first.run);
  const controller = new AbortController();
  let ran = false;
  const cancelled = gate.run(async () => { ran = true; }, controller.signal);
  const last = gate.run(async () => "last");
  await tick();
  controller.abort();
  // It leaves the queue at once instead of holding its place.
  await assert.rejects(cancelled, WorkCancelledError);
  assert.equal(gate.waiting, 1);
  first.release();
  assert.equal(await running, "first");
  assert.equal(await last, "last");
  assert.equal(ran, false);
});

test("an already cancelled request is refused without running", async () => {
  const gate = createWorkGate(2);
  const controller = new AbortController();
  controller.abort();
  let ran = false;
  await assert.rejects(gate.run(async () => { ran = true; }, controller.signal), WorkCancelledError);
  assert.equal(ran, false);
  assert.equal(gate.active, 0);
});

test("the limit must be a positive integer", () => {
  for (const limit of [0, -1, 1.5, Number.NaN]) assert.throws(() => createWorkGate(limit), RangeError);
});
