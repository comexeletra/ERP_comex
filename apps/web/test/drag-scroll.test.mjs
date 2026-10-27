import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dragIgnoreSelector, dragScrollPosition, dragStarted, scrollerFor } from "../lib/drag-scroll.ts";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

/** Box with the scroll sizes of an element and the computed overflow of each axis. */
const box = (parentElement, sizes = {}, overflow = "visible") => ({
  parentElement, scrollWidth: 100, clientWidth: 100, scrollHeight: 100, clientHeight: 100, overflow, ...sizes,
});
const overflowOf = node => node.overflow;

test("a drag starts only after the pointer moves more than 4 px", () => {
  assert.equal(dragStarted({ x: 3, y: -4 }), false);
  assert.equal(dragStarted({ x: 5, y: 0 }), true);
  assert.equal(dragStarted({ x: 0, y: -5 }), true);
});

test("dragging moves the content with the pointer on both axes", () => {
  assert.deepEqual(dragScrollPosition({ left: 200, top: 50 }, { x: -120, y: 30 }), { left: 320, top: 20 });
});

test("the horizontal scroller is the nearest ancestor with hidden content on that axis", () => {
  const page = box(null);
  const wrap = box(page, { scrollWidth: 900 }, "auto");
  const table = box(wrap, { scrollWidth: 900, clientWidth: 900 });
  assert.equal(scrollerFor(table, "x", overflowOf), wrap);
  assert.equal(scrollerFor(table, "y", overflowOf), null, "a wrap without a height limit does not scroll vertically");
});

test("a wrap with a height limit scrolls vertically, and one with visible overflow is skipped", () => {
  const page = box(null);
  const limited = box(page, { scrollHeight: 800, clientHeight: 320 }, "auto");
  const visible = box(limited, { scrollHeight: 800, clientHeight: 320 });
  const table = box(visible);
  assert.equal(scrollerFor(table, "y", overflowOf), limited);
});

test("hidden overflow and sub-pixel leftovers do not count as scrollable", () => {
  const clipped = box(null, { scrollWidth: 900 }, "hidden");
  assert.equal(scrollerFor(box(clipped), "x", overflowOf), null);
  const rounded = box(null, { scrollWidth: 101 }, "auto");
  assert.equal(scrollerFor(box(rounded), "x", overflowOf), null);
});

test("controls inside a table keep their own pointer behaviour", () => {
  for (const selector of ["a", "button", "input", "select", "textarea", "label", "summary", "[role=button]", "[contenteditable]"]) {
    assert.ok(dragIgnoreSelector.split(", ").includes(selector), selector);
  }
});

test("every table drags to scroll from a single listener in the root layout", async () => {
  const layout = await source("app/layout.tsx");
  assert.match(layout, /import TableDragScroll from "\.\.\/components\/TableDragScroll";/u);
  assert.match(layout, /<TableDragScroll \/>/u);
  const component = await source("components/TableDragScroll.tsx");
  assert.match(component, /closest\("table"\)/u);
  assert.match(component, /event\.altKey/u, "Alt + drag keeps the native text selection");
  assert.match(component, /pointerType !== "mouse"/u, "touch keeps the native scrolling");
});

test("the source audit grid uses the shared drag instead of its own", async () => {
  const page = await source("app/source-audit/page.tsx");
  assert.doesNotMatch(page, /onPointerDown|GridDrag|setPointerCapture/u);
  const styles = await source("app/styles/features/source-audit.css");
  assert.doesNotMatch(styles, /is-dragging|cursor: grab/u);
});
