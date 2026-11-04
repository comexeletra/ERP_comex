import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { easeOrganic, tweenAt } from "../lib/motion.ts";

test("the organic easing starts fast, settles slowly and stays inside the range", () => {
  assert.equal(easeOrganic(0), 0);
  assert.equal(easeOrganic(1), 1);
  // Most of the way is covered early, as a value that decelerates into place.
  assert.ok(easeOrganic(.25) > .5);
  assert.ok(easeOrganic(.75) > .95 && easeOrganic(.75) < 1);
  for (let step = 0; step < 10; step++) assert.ok(easeOrganic(step / 10) <= easeOrganic((step + 1) / 10));
  // Out-of-range progress is clamped instead of overshooting.
  assert.equal(easeOrganic(-1), 0);
  assert.equal(easeOrganic(2), 1);
});

test("a tween goes from the previous value to the target and lands exactly on it", () => {
  assert.equal(tweenAt(100, 300, 0, 600), 100);
  assert.equal(tweenAt(100, 300, 600, 600), 300);
  assert.equal(tweenAt(100, 300, 900, 600), 300);
  const middle = tweenAt(100, 300, 300, 600);
  assert.ok(middle > 200 && middle < 300);
  // Counting down works as well as counting up, and no duration means no animation.
  assert.ok(tweenAt(300, 100, 150, 600) < 300);
  assert.equal(tweenAt(0, 42, 0, 0), 42);
});

test("motion math stays free of UI text and value imports", async () => {
  const source = await readFile(new URL("../lib/motion.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import\s+(?!type\b)/mu);
});
