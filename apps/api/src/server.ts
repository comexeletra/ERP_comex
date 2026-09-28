import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { registerAuthRoutes } from "./auth.js";
import { registerAuthorization } from "./authorization.js";
import { registerPurchaseOrderReadRoutes } from "./purchase-orders.js";

const gatewayToken = process.env.GATEWAY_TOKEN;
const connectionString = process.env.DATABASE_URL;

if (!gatewayToken || Buffer.byteLength(gatewayToken) < 32) {
  throw new Error("GATEWAY_TOKEN ausente ou curto demais.");
}
if (!connectionString) throw new Error("DATABASE_URL não configurada na VPS.");

const parsedDatabaseUrl = new URL(connectionString);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
if (process.env.NODE_ENV === "production" && !loopbackHosts.has(parsedDatabaseUrl.hostname)) {
  throw new Error("A conexão PostgreSQL de produção deve permanecer local à VPS.");
}

const pool = new Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: false,
});

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.cookie", "req.headers.authorization", "req.headers.x-import-erp-gateway-token"],
  },
  bodyLimit: 1_048_576,
});

await app.register(helmet);
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await app.register(cookie);

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health/live") return;

  const supplied = request.headers["x-import-erp-gateway-token"];
  if (typeof supplied !== "string") {
    return reply.code(401).send({ error: "Não autorizado." });
  }

  const expectedBytes = Buffer.from(gatewayToken);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return reply.code(401).send({ error: "Não autorizado." });
  }
});

await registerAuthorization(app, pool);
await registerAuthRoutes(app, pool);
await registerPurchaseOrderReadRoutes(app, pool);

app.get("/health/live", async () => ({ status: "ok" }));

app.get("/health/ready", async (_request, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ok" };
  } catch {
    return reply.code(503).send({ status: "unavailable" });
  }
});

app.setNotFoundHandler(async (_request, reply) => {
  return reply.code(404).send({ error: "Recurso não encontrado." });
});

app.setErrorHandler(async (error, request, reply) => {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "UNEXPECTED";
  request.log.error({ code }, "Falha ao processar requisição");
  return reply.code(500).send({ error: "Erro inesperado." });
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Encerrando API");
  await app.close();
  await pool.end();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";
await app.listen({ port, host });
