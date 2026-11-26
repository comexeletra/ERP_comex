import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

// Decision of 2026-11-26: there is no import request flow in the platform. A record enters
// only after it is exported from Protheus, so the "Solicitações" screens must not come back.
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const exists = path => access(new URL(path, import.meta.url)).then(() => true, () => false);

test("the sidebar has no Solicitações item", async () => {
  const sidebar = await read("../components/AppSidebar.tsx");
  assert.doesNotMatch(sidebar, /href: "\/requests"/u);
  assert.doesNotMatch(sidebar, /label: "requests"/u);
});

test("the request pages, their permission helper and protected route are gone", async () => {
  assert.equal(await exists("../app/requests/page.tsx"), false);
  assert.equal(await exists("../app/requests/[id]/page.tsx"), false);
  assert.equal(await exists("../lib/request-permissions.ts"), false);
  assert.doesNotMatch(await read("../proxy.ts"), /"\/requests/u);
});

test("no dictionary keeps texts of the request screens", () => {
  for (const messages of [ptBR, en, zhCN]) {
    assert.equal("requests" in messages, false);
    assert.equal("requestDetail" in messages, false);
    assert.equal("requests" in messages.sidebar.items, false);
  }
});
