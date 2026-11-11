import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertPassword, hashPassword, minimumPasswordLength, verifyPassword } from "../dist/password.js";

test("a password needs at least 6 characters", async () => {
  assert.equal(minimumPasswordLength, 6);
  assert.throws(() => assertPassword("12345"), /de 6 a 1024 bytes/u);
  assert.doesNotThrow(() => assertPassword("123456"));
  assert.doesNotThrow(() => assertPassword("x".repeat(1024)));
  assert.throws(() => assertPassword("x".repeat(1025)));
  const encoded = await hashPassword("abc123");
  assert.equal(await verifyPassword("abc123", encoded), true);
  assert.equal(await verifyPassword("abc12", encoded), false);
});

test("the change-password route uses the same minimum", async () => {
  const auth = await readFile(new URL("../src/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /newPassword: z\.string\(\)\.min\(minimumPasswordLength\)/u);
});
