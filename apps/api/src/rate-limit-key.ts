import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";

type RateLimitRequest = Pick<FastifyRequest, "headers" | "ip">;

export function gatewayTokenMatches(
  supplied: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof supplied !== "string") return false;

  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

export function rateLimitKey(request: RateLimitRequest, gatewayToken: string): string {
  const suppliedToken = request.headers["x-import-erp-gateway-token"];
  const clientIp = request.headers["x-import-erp-client-ip"];
  if (gatewayTokenMatches(suppliedToken, gatewayToken)
    && typeof clientIp === "string"
    && !clientIp.includes(",")
    && isIP(clientIp) !== 0) {
    return `client:${clientIp}`;
  }

  return `peer:${request.ip}`;
}
