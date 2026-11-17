import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = async path => readFile(new URL(`../app/styles/${path}`, import.meta.url), "utf8");
const [base, tokens, layout] = await Promise.all([css("base.css"), css("tokens.css"), css("layout.css")]);

test("every scrollbar of the app is thin, rounded and painted with the theme tokens", () => {
  assert.match(base, /^::-webkit-scrollbar \{ height: 10px; width: 10px; \}/mu);
  assert.match(base, /^::-webkit-scrollbar-track, ::-webkit-scrollbar-corner \{ background: transparent; \}/mu);
  assert.match(base, /^::-webkit-scrollbar-thumb \{[^}]*background-color: var\(--scrollbar-thumb\);[^}]*border-radius: var\(--radius-pill\);/mu);
  assert.match(base, /^::-webkit-scrollbar-thumb:hover \{ background-color: var\(--scrollbar-thumb-hover\); \}/mu);
});

test("the standard scrollbar properties stay unset, since Chromium drops the custom scrollbar when they are set", () => {
  assert.doesNotMatch(base, /scrollbar-(?:color|width)\s*:/u);
});

test("the colours come from tokens, and the dark sidebar has its own thumb", () => {
  assert.match(tokens, /--scrollbar-thumb: var\(--color-border-hover\);/u);
  assert.match(tokens, /--scrollbar-thumb-hover: var\(--color-text-subtle\);/u);
  assert.match(tokens, /--sidebar-scrollbar-thumb: #[0-9a-f]{6};/u);
  assert.match(tokens, /--sidebar-scrollbar-thumb-hover: #[0-9a-f]{6};/u);
  assert.match(layout, /^\.app-sidebar \{[^}]*--scrollbar-thumb: var\(--sidebar-scrollbar-thumb\); --scrollbar-thumb-hover: var\(--sidebar-scrollbar-thumb-hover\);/mu);
});
