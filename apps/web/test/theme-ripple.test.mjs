import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { rippleGeometry, rippleWaveWidth } from "../lib/theme-ripple.ts";

const rect = { left: 20, top: 600, width: 200, height: 40 };
const viewport = { width: 1000, height: 800 };

test("the ripple starts where the pointer touched the theme button", () => {
  const ripple = rippleGeometry({ clientX: 60, clientY: 610, detail: 1 }, rect, viewport);
  assert.equal(ripple.x, 60);
  assert.equal(ripple.y, 610);
});

test("keyboard activation starts the ripple at the button center", () => {
  const ripple = rippleGeometry({ clientX: 0, clientY: 0, detail: 0 }, rect, viewport);
  assert.equal(ripple.x, 120);
  assert.equal(ripple.y, 620);
});

test("the ripple ends past the farthest corner, wave included", () => {
  const ripple = rippleGeometry({ clientX: 0, clientY: 0, detail: 1 }, rect, viewport);
  assert.equal(ripple.radius, Math.ceil(Math.hypot(1000, 800)) + rippleWaveWidth);
  const center = rippleGeometry({ clientX: 500, clientY: 400, detail: 1 }, rect, viewport);
  assert.equal(center.radius, Math.ceil(Math.hypot(500, 400)) + rippleWaveWidth);
});

test("the stylesheet animates the radius the script sets", async () => {
  const css = await readFile(new URL("../app/styles/base.css", import.meta.url), "utf8");
  assert.match(css, /@property --ripple-radius\s*\{[^}]*syntax:\s*"<length>"/u);
  assert.match(css, /::view-transition-new\(root\)\s*\{[^}]*animation:\s*theme-ripple/u);
  assert.match(css, new RegExp(`--ripple-radius\\) - ${rippleWaveWidth}px`, "u"));
  const gate = await readFile(new URL("../components/AuthGate.tsx", import.meta.url), "utf8");
  for (const name of ["--ripple-x", "--ripple-y", "--ripple-end"]) assert.match(gate, new RegExp(name, "u"));
  assert.match(gate, /prefers-reduced-motion: reduce/u);
});
