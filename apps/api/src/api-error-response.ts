import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { apiErrorDetails } from "./api-error-details.js";

function errorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const statusCode = Number(error.statusCode);
  return Number.isInteger(statusCode) ? statusCode : null;
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "UNEXPECTED";
}

function rateLimitResponse(request: FastifyRequest, reply: FastifyReply) {
  const header = reply.getHeader("retry-after");
  const parsed = Number.parseInt(Array.isArray(header) ? String(header[0]) : String(header ?? ""), 10);
  const retryAfter = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  const detail = `Muitas consultas em pouco tempo. Tente novamente em ${retryAfter} segundos.`;
  reply.header("retry-after", String(retryAfter));
  return reply.code(429).send({ type: "about:blank", title: detail, status: 429, detail,
    instance: request.url.split("?", 1)[0], traceId: request.id, code: "RATE_LIMITED" });
}

export function registerApiErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(async (error, request, reply) => {
    request.log.error({ code: errorCode(error), ...apiErrorDetails(error) }, "Falha ao processar requisição");
    if (errorStatusCode(error) === 429) return rateLimitResponse(request, reply);
    return reply.code(500).send({ error: "Erro inesperado." });
  });
}
