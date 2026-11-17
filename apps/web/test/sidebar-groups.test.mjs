import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { toggleSidebarGroup, withActiveSidebarGroup } from "../lib/sidebar-groups.ts";

const sidebar = await readFile(new URL("../components/AppSidebar.tsx", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/styles/layout.css", import.meta.url), "utf8");

test("only the section of the current page starts open", () => {
  assert.deepEqual(withActiveSidebarGroup([], "analysis"), ["analysis"]);
  assert.deepEqual(withActiveSidebarGroup([], undefined), []);
});

test("navigating to another section opens it and keeps the ones the user opened", () => {
  assert.deepEqual(withActiveSidebarGroup(["operation"], "admin"), ["operation", "admin"]);
  const open = ["operation"];
  assert.equal(withActiveSidebarGroup(open, "operation"), open);
});

test("clicking a section expands it, and clicking again collapses it", () => {
  assert.deepEqual(toggleSidebarGroup([], "management"), ["management"]);
  assert.deepEqual(toggleSidebarGroup(["operation", "management"], "operation"), ["management"]);
});

test("the section header is a button that controls its list", () => {
  assert.match(sidebar, /<button className="sidebar-group-toggle" type="button"/u);
  assert.match(sidebar, /aria-expanded=\{open\}/u);
  assert.match(sidebar, /aria-controls=\{listId\}/u);
  assert.match(sidebar, /<ul id=\{listId\}>/u);
  assert.match(sidebar, /open \? "sidebar-group is-open" : "sidebar-group"/u);
  assert.doesNotMatch(sidebar, /useEffect/u);
});

test("a closed section hides its items, except in the icon-only sidebar, which has no header to click", () => {
  assert.match(layout, /\.sidebar-group:not\(\.is-open\) ul \{ display: none; \}/u);
  assert.match(layout, /\.app-sidebar\.is-collapsed \.sidebar-group ul \{[^}]*display: grid;/u);
});

test("closed sections stay together at the top instead of spreading over the sidebar height", () => {
  assert.match(layout, /\.sidebar-navigation \{ align-content: start; display: grid; flex: 1 0 auto;/u);
});
