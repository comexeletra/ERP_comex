import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { forwardedClientIp } from "../lib/forwarded-client-ip.ts";

test("forwardedClientIp prefers a single valid x-real-ip", () => {
  const headers = new Headers({
    "x-real-ip": "2001:db8::1",
    "x-forwarded-for": "198.51.100.10, 10.0.0.1",
  });

  assert.equal(forwardedClientIp(headers), "2001:db8::1");
});

test("forwardedClientIp falls back to the first valid x-forwarded-for item", () => {
  const headers = new Headers({ "x-forwarded-for": " 198.51.100.10, 10.0.0.1 " });

  assert.equal(forwardedClientIp(headers), "198.51.100.10");
});

test("forwardedClientIp rejects invalid, empty, or repeated x-real-ip values", () => {
  assert.equal(forwardedClientIp(new Headers({ "x-real-ip": "not-an-ip" })), null);
  assert.equal(forwardedClientIp(new Headers({ "x-real-ip": "" })), null);
  assert.equal(forwardedClientIp(new Headers({ "x-real-ip": "198.51.100.10, 198.51.100.11" })), null);
});

test("forwardedClientIp rejects an invalid first x-forwarded-for item", () => {
  const headers = new Headers({ "x-forwarded-for": "unknown, 198.51.100.10" });

  assert.equal(forwardedClientIp(headers), null);
});

test("proxy removes a browser client IP before setting the calculated value", async () => {
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  const removeAt = proxy.indexOf('headers.delete("x-import-erp-client-ip")');
  const setAt = proxy.indexOf('headers.set("x-import-erp-client-ip", clientIp)');

  assert.ok(removeAt >= 0, "proxy must remove the browser-provided client IP");
  assert.ok(setAt > removeAt, "proxy must remove the inbound value before setting the calculated IP");
  assert.match(proxy, /const clientIp = forwardedClientIp\(request\.headers\)/u);
});
