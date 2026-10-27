import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { tooltipPosition } from "../lib/tooltip-position.ts";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

async function listFiles(directory) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? listFiles(`${directory}${entry.name}/`)
    : entry.name.endsWith(".tsx") ? [`${directory}${entry.name}`] : []));
  return nested.flat();
}

/**
 * Attributes written at the top level of each JSX opening tag that reaches the DOM: HTML and SVG
 * elements and the Next components that pass their props to one (`Link`, `Image`). Expressions in
 * braces are skipped, so `onClick={() => x > 1}` does not end the tag.
 */
function domTagAttributes(code) {
  const found = [];
  for (const match of code.matchAll(/<([a-z][\w-]*|Link|Image)(?=[\s/>])/gu)) {
    let depth = 0; let quote = ""; let attributes = "";
    for (let index = match.index + match[0].length; index < code.length; index++) {
      const char = code[index];
      if (quote) { if (char === quote) quote = ""; if (depth === 0) attributes += char; continue; }
      if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (depth === 0 && (char === "\"" || char === "'")) quote = char;
      else if (depth === 0 && char === ">") break;
      if (depth === 0 && char !== "}") attributes += char;
    }
    found.push([match[1], attributes]);
  }
  return found;
}

const viewport = { width: 1000, height: 800 };
const box = { width: 200, height: 60 };

test("a tooltip goes above its anchor, centred, and below it when the top has no room", () => {
  assert.deepEqual(tooltipPosition({ left: 400, top: 300, width: 100, height: 20 }, box, viewport, "top"),
    { left: 350, top: 232 });
  assert.deepEqual(tooltipPosition({ left: 400, top: 40, width: 100, height: 20 }, box, viewport, "top"),
    { left: 350, top: 68 });
});

test("a tooltip on the right of its anchor moves to the left when the right has no room", () => {
  assert.deepEqual(tooltipPosition({ left: 100, top: 300, width: 40, height: 40 }, box, viewport, "right"),
    { left: 148, top: 290 });
  assert.deepEqual(tooltipPosition({ left: 850, top: 300, width: 40, height: 40 }, box, viewport, "right"),
    { left: 642, top: 290 });
});

test("a tooltip stays inside the viewport with an 8 px margin", () => {
  assert.deepEqual(tooltipPosition({ left: 0, top: 300, width: 20, height: 20 }, box, viewport, "top"),
    { left: 8, top: 232 });
  assert.deepEqual(tooltipPosition({ left: 990, top: 300, width: 10, height: 20 }, box, viewport, "top"),
    { left: 792, top: 232 });
  assert.deepEqual(tooltipPosition({ left: 100, top: 790, width: 40, height: 10 }, box, viewport, "right"),
    { left: 148, top: 732 });
  // Taller than the viewport: it starts at the margin instead of leaving the top.
  assert.deepEqual(tooltipPosition({ left: 400, top: 10, width: 10, height: 10 }, { width: 100, height: 900 }, viewport, "top"),
    { left: 355, top: 8 });
});

test("a cursor anchor is a point, so the tooltip is centred above the pointer", () => {
  assert.deepEqual(tooltipPosition({ left: 500, top: 400, width: 0, height: 0 }, box, viewport, "top", 12),
    { left: 400, top: 328 });
});

test("screens use the shared tooltip instead of the browser title", async () => {
  for (const path of [...await listFiles("app/"), ...await listFiles("components/")]) {
    const code = await source(path);
    assert.doesNotMatch(code, /<title>/u, `${path} uses an SVG <title> tooltip`);
    for (const [tag, attributes] of domTagAttributes(code)) {
      assert.doesNotMatch(attributes, /(?:^|\s)title=/u, `${path}: <${tag}> uses the browser title`);
    }
  }
});

test("the attribute scan finds a title after an arrow function and ignores component props", () => {
  const scan = code => domTagAttributes(code).filter(([, attributes]) => /(?:^|\s)title=/u.test(attributes)).map(([tag]) => tag);
  assert.deepEqual(scan(`<button onClick={() => go(a > b)} title={label}>x</button>`), ["button"]);
  assert.deepEqual(scan(`<Link href="/" title="a">x</Link><PageHeader title={t.title} />`), ["Link"]);
  assert.deepEqual(scan(`<span className="a" data-x={{ title: 1 }}>x</span>`), []);
});

test("the tooltip is announced, follows the theme tokens and is mounted once in the root layout", async () => {
  const component = await source("components/Tooltip.tsx");
  assert.match(component, /role="tooltip"/u);
  assert.match(component, /aria-describedby/u);
  assert.match(component, /"Escape"/u);
  assert.match(component, /createPortal\(/u);
  const layout = await source("app/layout.tsx");
  assert.match(layout, /<TooltipProvider><I18nProvider><AuthGate>\{children\}<\/AuthGate><\/I18nProvider><\/TooltipProvider>/u);
  const css = await source("app/styles/components.css");
  const rule = css.match(/\n\.tooltip \{([^}]*)\}/u)?.[1] ?? "";
  for (const declaration of [/background:\s*var\(--color-tooltip-bg\)/u, /color:\s*var\(--color-tooltip-text\)/u,
    /pointer-events:\s*none/u, /position:\s*fixed/u, /z-index:\s*var\(--z-tooltip\)/u]) assert.match(rule, declaration);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.tooltip \{ animation: none; \} \}/u);
  assert.match(await source("app/styles/tokens.css"), /--z-tooltip: 1200;/u);
});

test("the End to End charts show the rich card that follows the cursor", async () => {
  const charts = await source("components/E2eOverviewCharts.tsx");
  assert.equal(charts.match(/<Tooltip (?:key=\{entry\.key\} )?content=\{<ChartTip /gu)?.length, 3);
  assert.equal(charts.match(/followCursor/gu)?.length, 3);
  assert.match(charts, /overviewTip\(/u);
});
