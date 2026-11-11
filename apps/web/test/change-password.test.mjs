import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

test("the new password needs at least 6 characters, as the API requires", async () => {
  assert.match(await source("app/change-password/page.tsx"), /autoComplete="new-password" minLength=\{6\} required/u);
  assert.match(await source("../api/src/password.ts"), /export const minimumPasswordLength = 6;/u);
  for (const [file, text] of [["pt-BR.ts", "pelo menos 6 caracteres"], ["en.ts", "at least 6 characters"],
    ["zh-CN.ts", "至少 6 个字符"]]) {
    assert.ok((await source(`lib/i18n/${file}`)).includes(text), file);
  }
});
