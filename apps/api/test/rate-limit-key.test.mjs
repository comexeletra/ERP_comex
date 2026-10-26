import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { gatewayTokenMatches, rateLimitKey } from "../dist/rate-limit-key.js";

const gatewayToken = "test-gateway-token-at-least-32-bytes";

function request(headers = {}, ip = "172.18.0.16") {
  return { headers, ip };
}

test("gatewayTokenMatches accepts only one exact token", () => {
  assert.equal(gatewayTokenMatches(gatewayToken, gatewayToken), true);
  assert.equal(gatewayTokenMatches(undefined, gatewayToken), false);
  assert.equal(gatewayTokenMatches(`${gatewayToken}-wrong`, gatewayToken), false);
  assert.equal(gatewayTokenMatches([gatewayToken], gatewayToken), false);
});

test("rateLimitKey trusts one valid client IP only with a valid gateway token", () => {
  assert.equal(rateLimitKey(request({
    "x-import-erp-gateway-token": gatewayToken,
    "x-import-erp-client-ip": "198.51.100.10",
  }), gatewayToken), "client:198.51.100.10");
  assert.equal(rateLimitKey(request({
    "x-import-erp-gateway-token": gatewayToken,
    "x-import-erp-client-ip": "2001:db8::1",
  }), gatewayToken), "client:2001:db8::1");

  for (const headers of [
    { "x-import-erp-client-ip": "198.51.100.10" },
    { "x-import-erp-gateway-token": "wrong", "x-import-erp-client-ip": "198.51.100.10" },
    { "x-import-erp-gateway-token": gatewayToken, "x-import-erp-client-ip": "invalid" },
    { "x-import-erp-gateway-token": gatewayToken, "x-import-erp-client-ip": "198.51.100.10, 198.51.100.11" },
    { "x-import-erp-gateway-token": gatewayToken, "x-import-erp-client-ip": ["198.51.100.10"] },
  ]) {
    assert.equal(rateLimitKey(request(headers), gatewayToken), "peer:172.18.0.16");
  }
});

test("rate-limit plugin keeps client quotas independent and forged headers on the peer quota", async t => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(rateLimit, {
    max: 2,
    timeWindow: "1 minute",
    keyGenerator: request => rateLimitKey(request, gatewayToken),
  });
  app.get("/limited", async () => ({ ok: true }));

  const trustedHeaders = ip => ({
    "x-import-erp-gateway-token": gatewayToken,
    "x-import-erp-client-ip": ip,
  });
  assert.equal((await app.inject({ url: "/limited", headers: trustedHeaders("198.51.100.10") })).statusCode, 200);
  assert.equal((await app.inject({ url: "/limited", headers: trustedHeaders("198.51.100.10") })).statusCode, 200);
  assert.equal((await app.inject({ url: "/limited", headers: trustedHeaders("198.51.100.10") })).statusCode, 429);
  assert.equal((await app.inject({ url: "/limited", headers: trustedHeaders("198.51.100.11") })).statusCode, 200);

  assert.equal((await app.inject({ url: "/limited", headers: { "x-import-erp-client-ip": "203.0.113.1" } })).statusCode, 200);
  assert.equal((await app.inject({ url: "/limited", headers: { "x-import-erp-client-ip": "203.0.113.2" } })).statusCode, 200);
  assert.equal((await app.inject({ url: "/limited", headers: { "x-import-erp-client-ip": "203.0.113.3" } })).statusCode, 429);
});

test("gateway hook keeps rejecting missing and incorrect tokens with 401", async t => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  app.addHook("onRequest", async (request, reply) => {
    if (!gatewayTokenMatches(request.headers["x-import-erp-gateway-token"], gatewayToken)) {
      return reply.code(401).send({ error: "Não autorizado." });
    }
  });
  app.get("/protected", async () => ({ ok: true }));

  assert.equal((await app.inject({ url: "/protected" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/protected", headers: {
    "x-import-erp-gateway-token": "wrong",
  } })).statusCode, 401);
  assert.equal((await app.inject({ url: "/protected", headers: {
    "x-import-erp-gateway-token": gatewayToken,
  } })).statusCode, 200);

  const server = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(server, /gatewayTokenMatches\(request\.headers\["x-import-erp-gateway-token"\], gatewayToken\)/u);
  assert.match(server, /reply\.code\(401\)/u);
});
