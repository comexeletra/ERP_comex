import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerApiErrorHandler } from "../dist/api-error-response.js";

test("rate-limit errors preserve 429 and Retry-After in a problem response", async t => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  registerApiErrorHandler(app);
  app.get("/limited", async (_request, reply) => {
    reply.header("retry-after", "43");
    throw Object.assign(new Error("Rate limit exceeded, retry in 43 seconds"), { statusCode: 429 });
  });

  const response = await app.inject({ method: "GET", url: "/limited" });
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["retry-after"], "43");
  assert.deepEqual(response.json(), {
    type: "about:blank", title: "Muitas consultas em pouco tempo. Tente novamente em 43 segundos.",
    status: 429, detail: "Muitas consultas em pouco tempo. Tente novamente em 43 segundos.",
    instance: "/limited", traceId: response.json().traceId, code: "RATE_LIMITED",
  });
  assert.equal(typeof response.json().traceId, "string");
});

test("unexpected errors remain generic and do not leak their message", async t => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  registerApiErrorHandler(app);
  app.get("/failure", async () => { throw new Error("database password leaked"); });

  const response = await app.inject({ method: "GET", url: "/failure" });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: "Erro inesperado." });
  assert.doesNotMatch(response.body, /password leaked/u);
});
