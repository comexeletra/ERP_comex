import assert from "node:assert/strict";
import test from "node:test";
import { identityStatusLabel, statusLabel } from "../lib/i18n/labels.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

test("translates the PO identity statuses shown in the pre-shipment indicators", () => {
  for (const m of [ptBR, en, zhCN]) {
    for (const status of ["HISTORICAL_UNVERIFIED", "MANUAL_UNVERIFIED"]) {
      const label = identityStatusLabel(m, status);
      assert.ok(label && label !== status, `${status} sem tradução`);
    }
  }
  assert.equal(identityStatusLabel(en, "MANUAL_UNVERIFIED"), "Manual · number not verified");
  assert.equal(identityStatusLabel(ptBR, "OTHER_STATUS"), "OTHER_STATUS");
});

test("translates the IP statuses shown in the post-shipment indicators", () => {
  assert.equal(statusLabel(en, "DESEMBARAÇO"), "CUSTOMS CLEARANCE");
});
