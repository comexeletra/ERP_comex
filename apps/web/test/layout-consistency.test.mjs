import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function listFiles(directory, extension) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? listFiles(`${directory}${entry.name}/`, extension)
    : entry.name.endsWith(extension) ? [`${directory}${entry.name}`] : []));
  return nested.flat();
}
const readAll = async paths => Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(new URL(path, root), "utf8")])));

const styles = await readAll(await listFiles("app/styles/", ".css"));
const components = await readAll([...await listFiles("app/", ".tsx"), ...await listFiles("components/", ".tsx")]);
const libraries = await readAll(await listFiles("lib/", ".ts"));
const tokensPath = "app/styles/tokens.css";
const breakpoints = new Set([480, 760, 1100]);

const withoutComments = css => css.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/url\([^)]*\)/gu, "url()");
/** Declaration blocks (the innermost `{ ... }`) of a stylesheet. */
const bodies = css => [...withoutComments(css).matchAll(/\{([^{}]*)\}/gu)].map(match => match[1]);
const declarations = (css, property) => bodies(css).flatMap(body =>
  [...body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "gu"))].map(match => match[1].trim()));
const featureStyles = Object.entries(styles).filter(([path]) => path !== tokensPath);

/** Rules per context (top level or media query) as [context, selector] pairs. */
function rules(css) {
  const found = [];
  const code = withoutComments(css);
  let index = 0;
  const walk = context => {
    while (index < code.length) {
      const open = code.indexOf("{", index);
      const close = code.indexOf("}", index);
      if (close !== -1 && (open === -1 || close < open)) { index = close + 1; return; }
      if (open === -1) { index = code.length; return; }
      const prelude = code.slice(index, open).trim();
      index = open + 1;
      if (prelude.startsWith("@media")) walk(prelude);
      else if (prelude.startsWith("@keyframes")) { let depth = 1; while (depth > 0 && index < code.length) { if (code[index] === "{") depth++; if (code[index] === "}") depth--; index++; } }
      else {
        const selectors = prelude.split(",");
        for (const selector of selectors) found.push([context, selector.replace(/\s+/gu, " ").trim(), selectors.length === 1]);
        index = code.indexOf("}", index) + 1;
      }
    }
  };
  walk("top");
  return found;
}

/** Static class names written in className attributes. Comparison operands such as `view === "new"` are ignored. */
function usedClasses(source) {
  const names = new Set();
  const add = text => text.split(/\s+/u).filter(name => /^[a-z][a-z0-9-]*$/u.test(name)).forEach(name => names.add(name));
  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{)/gu)) {
    if (match[1] !== undefined) { add(match[1]); continue; }
    let depth = 1; let end = match.index + match[0].length;
    while (depth > 0 && end < source.length) { if (source[end] === "{") depth++; if (source[end] === "}") depth--; end++; }
    const addStrings = code => {
      for (const literal of code.matchAll(/"([^"]*)"/gu)) {
        const before = code.slice(0, literal.index).trimEnd();
        const after = code.slice(literal.index + literal[0].length).trimStart();
        if (!/[=!]==?$/u.test(before) && !/^[=!]==?/u.test(after)) add(literal[1]);
      }
    };
    let expression = source.slice(match.index + match[0].length, end - 1);
    for (const template of expression.matchAll(/`([^`]*)`/gu)) {
      // A name glued to an interpolation (`side-${side}`) is built at runtime and is not checked.
      add(template[1].replace(/\$\{[^}]*\}/gu, "\u0000"));
      for (const interpolation of template[1].matchAll(/\$\{([^}]*)\}/gu)) addStrings(interpolation[1]);
    }
    expression = expression.replace(/`[^`]*`/gu, "");
    addStrings(expression);
  }
  return names;
}
const definedClasses = new Set(Object.values(styles).flatMap(css =>
  rules(css).flatMap(([, selector]) => [...selector.matchAll(/\.([a-z][a-z0-9-]*)/gu)].map(match => match[1]))));

function tokenValues(block) {
  const css = withoutComments(styles[tokensPath]);
  const start = css.indexOf(`${block} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/giu)].map(match => [match[1], match[2]]));
}
function contrast(first, second) {
  const luminance = hex => {
    const [red, green, blue] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map(value => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * red + .7152 * green + .0722 * blue;
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
}

test("form controls stay inside their grid columns", () => {
  const base = styles["app/styles/base.css"];
  const controls = base.match(/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\), select, textarea \{([^}]*)\}/u)?.[1] ?? "";
  assert.match(controls, /max-width:\s*100%/u);
  assert.match(controls, /min-width:\s*0/u);
});

test("portfolio filter inputs and selects fill their columns", () => {
  const css = styles["app/styles/components.css"];
  assert.match(css, /\.portfolio-filter :is\(input, select\)[^{]*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/u);
});

test("product line filters use four, two and one columns at the approved breakpoints", () => {
  const css = styles["app/styles/features/operations.css"];
  assert.match(css, /\.product-lines-filter \{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/u);
  assert.match(css, /@media \(max-width: 1100px\) \{[\s\S]*?\.product-lines-filter \{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/u);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.product-lines-filter \{[^}]*grid-template-columns:\s*1fr;/u);
});

test("portfolio filters use five columns and keep actions on their own row", () => {
  const componentsCss = styles["app/styles/components.css"];
  const operationsCss = styles["app/styles/features/operations.css"];
  const portfolio = componentsCss.match(/\.portfolio-filter \{([^}]*)\}/u)?.[1] ?? "";
  assert.match(portfolio, /gap:\s*16px/u);
  assert.match(portfolio, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/u);
  assert.match(components["app/page.tsx"], /<div className="button-row portfolio-filter-actions"><button className="button" type="submit">/u);
  assert.match(components["components/ProcessDirectory.tsx"], /<div className="button-row portfolio-filter-actions"><button className="button">/u);
  assert.match(operationsCss, /\.portfolio-filter-actions,[^}]*\.product-lines-filter-actions \{[^}]*grid-column:\s*1 \/ -1;/u);
});

test("allocation search labels stack their bold labels above their fields", () => {
  const css = styles["app/styles/features/operations.css"];
  for (const selector of ["operational-search", "allocation-search-row"]) {
    const body = css.match(new RegExp(`\\.${selector} label \\{([^}]*)\\}`, "u"))?.[1] ?? "";
    assert.match(body, /display:\s*grid/u, selector);
    assert.match(body, /font-weight:\s*700/u, selector);
  }
});

test("catalog and shipment form labels use the standard bold weight", () => {
  const selectors = [
    [styles["app/styles/features/catalog.css"], "entity-values-card"],
    [styles["app/styles/features/catalog.css"], "ncm-tax-form"],
    [styles["app/styles/features/operations.css"], "shipment-date-form"],
  ];
  for (const [css, selector] of selectors) {
    const body = css.match(new RegExp(`\\.${selector} label \\{([^}]*)\\}`, "u"))?.[1] ?? "";
    assert.match(body, /font-weight:\s*700/u, selector);
  }
});

test("literal colors exist only in the token file", () => {
  for (const [path, css] of featureStyles) {
    for (const body of bodies(css)) {
      assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/iu, `${path}: ${body.trim().slice(0, 120)}`);
    }
  }
});

test("brand colors come from the Eletra logo", () => {
  const light = tokenValues(":root");
  assert.equal(light["--brand-blue"], "#02a0d1");
  assert.equal(light["--brand-green"], "#9fc916");
  assert.equal(light["--sidebar-indicator"], light["--brand-green"]);
});

test("End to End charts define the approved palette in both themes", () => {
  const light = tokenValues(":root");
  const dark = tokenValues(':root[data-theme="dark"]');
  const expected = {
    "--color-chart-status-1": ["#b0457f", "#c0609a"],
    "--color-chart-status-2": ["#b97400", "#bb8524"],
    "--color-chart-status-3": ["#037599", "#2f96c2"],
    "--color-chart-status-4": ["#d0603a", "#d27650"],
    "--color-chart-status-5": ["#7c5cc4", "#8f76d2"],
    "--color-chart-status-6": ["#5f8f12", "#72a22a"],
    "--color-chart-on-time": ["#1a9478", "#2ea88a"],
    "--color-chart-on-limit": ["#a87300", "#b8841a"],
    "--color-chart-late": ["#b02a3a", "#d0384f"],
    "--color-chart-no-data": ["#4f5d65", "#b4c1c8"],
  };
  for (const [token, [lightValue, darkValue]] of Object.entries(expected)) {
    assert.equal(light[token], lightValue, token);
    assert.equal(dark[token], darkValue, token);
    assert.ok(contrast(lightValue, light["--color-surface"]) >= 3, `${token} light contrast`);
    assert.ok(contrast(darkValue, dark["--color-surface"]) >= 3, `${token} dark contrast`);
  }
});

test("the End to End overview is a compact 3:2 row that stacks below 1100 px", () => {
  const css = styles["app/styles/features/e2e.css"];
  assert.match(css, /\.e2e-overview \{[^}]*grid-template-columns:\s*minmax\(0, 3fr\) minmax\(0, 2fr\);/u);
  assert.match(css, /@media \(max-width: 1100px\) \{[^@]*\.e2e-overview \{ grid-template-columns: 1fr; \}/u);
  for (const rule of [".e2e-distribution {", ".e2e-distribution-segment {", ".e2e-chart-legend-item {", ".e2e-pie-layout {"]) {
    assert.ok(css.includes(rule), rule);
  }
  // No Excel-like external labels or guide lines, and a pie no larger than the legend beside it.
  for (const rule of [".e2e-pie-guide", ".e2e-pie-label", ".e2e-pie-action"]) assert.ok(!css.includes(rule), rule);
  assert.match(css, /\.e2e-pie \{[^}]*height:\s*120px;[^}]*width:\s*120px;/u);
});

test("font sizes, radii and layers use the token scales", () => {
  for (const [path, css] of featureStyles) {
    for (const value of declarations(css, "font-size")) assert.match(value, /^(var\(--fs-[\w-]+\)|inherit)$/u, `${path}: font-size ${value}`);
    for (const value of declarations(css, "border-radius")) {
      for (const part of value.split(/\s+(?![^(]*\))/u)) assert.match(part, /^(var\(--radius-[\w-]+\)|0|50%|inherit)$/u, `${path}: border-radius ${value}`);
    }
    for (const value of declarations(css, "z-index")) assert.match(value, /^(var\(--z-[\w-]+\)|calc\(var\(--z-[\w-]+\) \+ \d+\))$/u, `${path}: z-index ${value}`);
  }
});

test("layouts change only at the approved breakpoints", () => {
  for (const [path, css] of Object.entries(styles)) {
    for (const match of withoutComments(css).matchAll(/@media\s*\(([^)]*)\)/gu)) {
      if (match[1].trim() === "prefers-reduced-motion: reduce") continue;
      const width = /^max-width:\s*(\d+)px$/u.exec(match[1].trim());
      assert.ok(width && breakpoints.has(Number(width[1])), `${path}: @media (${match[1]})`);
    }
  }
});

test("!important is used only to honour reduced motion", () => {
  for (const [path, css] of Object.entries(styles)) {
    const outsideReducedMotion = withoutComments(css).replace(/@media \(prefers-reduced-motion: reduce\) \{[^\n]*\}\s*\}/gu, "");
    assert.doesNotMatch(outsideReducedMotion, /!important/u, path);
  }
});

test("each selector has a single rule of its own per media context", () => {
  // A selector may also appear in grouped rules that share declarations, but never in two rules of its own.
  const seen = new Map();
  for (const [path, css] of Object.entries(styles)) {
    for (const [context, selector, alone] of rules(css)) {
      if (!alone) continue;
      const key = `${context} → ${selector}`;
      assert.ok(!seen.has(key), `${selector} (${context}) is defined in ${seen.get(key)} and ${path}`);
      seen.set(key, path);
    }
  }
});

test("every class written in a component has a style rule", () => {
  for (const [path, source] of Object.entries(components)) {
    const missing = [...usedClasses(source)].filter(name => !definedClasses.has(name));
    assert.deepEqual(missing, [], `${path} uses classes without CSS`);
  }
});

test("every style rule targets a class that is still used", () => {
  const sources = [...Object.values(components), ...Object.values(libraries)].join("\n");
  // Built at runtime from data: `is-${state}` in the end-to-end flow and the sticky columns of the source grid.
  const dynamic = /^(is-(done|current|reached|target|final-ok|final-late|late|ok|ink|slack|end|on)|source-pin-\d)$/u;
  const unused = [...definedClasses].filter(name => !dynamic.test(name)
    && !new RegExp(`(?<![\\w-])${name}(?![\\w-])`, "u").test(sources));
  assert.deepEqual(unused, []);
});

test("text and controls meet WCAG AA contrast in both themes", () => {
  const light = tokenValues(":root");
  const dark = { ...light, ...tokenValues(':root[data-theme="dark"]') };
  const pairs = [
    ...["--color-text-strong", "--color-text", "--color-text-secondary", "--color-text-muted", "--color-link"]
      .flatMap(text => ["--color-surface", "--color-page", "--color-surface-muted", "--color-surface-sunken"].map(surface => [text, surface, 4.5])),
    ["--color-text-subtle", "--color-surface", 4.5], ["--color-text-subtle", "--color-surface-muted", 4.5],
    ["--color-text", "--color-field-bg", 4.5], ["--color-placeholder", "--color-field-bg", 3],
    ["--color-on-primary", "--color-primary", 4.5], ["--color-on-primary", "--color-primary-hover", 4.5],
    ["--color-on-primary", "--color-danger", 4.5], ["--color-on-accent", "--color-accent", 4.5],
    ["--color-accent-text", "--color-surface", 4.5], ["--color-accent-text", "--color-accent-soft", 4.5],
    ["--color-primary-strong", "--color-surface", 4.5], ["--color-primary-strong", "--color-primary-soft", 4.5],
    ["--color-success-text", "--color-success-bg", 4.5], ["--color-warning-text", "--color-warning-bg", 4.5],
    ["--color-danger-text", "--color-danger-bg", 4.5], ["--color-info-text", "--color-info-bg", 4.5],
    ["--sidebar-text", "--sidebar-bg", 4.5], ["--sidebar-muted", "--sidebar-bg", 4.5],
    ["--sidebar-text-strong", "--sidebar-active", 4.5], ["--focus-ring", "--color-page", 2.5],
  ];
  for (const [theme, values] of [["light", light], ["dark", dark]]) {
    for (const [foreground, background, minimum] of pairs) {
      const ratio = contrast(values[foreground], values[background]);
      assert.ok(ratio >= minimum, `${theme}: ${foreground} on ${background} = ${ratio.toFixed(2)} (< ${minimum})`);
    }
  }
});

test("stylesheets load in cascade order from the root layout", async () => {
  const layout = await readFile(new URL("app/layout.tsx", root), "utf8");
  const imports = [...layout.matchAll(/import "\.\/(styles\/[^"]+)";/gu)].map(match => `app/${match[1]}`);
  assert.deepEqual(imports.slice(0, 4), ["app/styles/tokens.css", "app/styles/base.css", "app/styles/layout.css", "app/styles/components.css"]);
  assert.deepEqual([...imports].sort(), Object.keys(styles).sort());
  assert.match(layout, /title: `\$\{productName\} \| Eletra`/u);
});

test("screens use the shared header, dialog and navigation", () => {
  for (const [path, source] of Object.entries(components)) {
    if (path !== "components/PageHeader.tsx") assert.doesNotMatch(source, /className="page-header/u, `${path} writes its own page header`);
    assert.doesNotMatch(source, /window\.confirm\(/u, `${path} uses the browser confirmation`);
  }
  const sidebar = components["components/AppSidebar.tsx"];
  for (const href of ["/reports/pre", "/quality", "/source-audit", "/pending-import-items", "/unassigned-po-items"]) {
    assert.match(sidebar, new RegExp(`href: "${href}"`, "u"));
  }
  assert.match(sidebar, /src="\/brand-mark\.png"/u);
  assert.match(components["components/ConfirmDialog.tsx"], /<dialog ref=\{dialogRef\}/u);
  assert.match(components["components/ConfirmDialog.tsx"], /dialog\.showModal\(\)/u);
});
