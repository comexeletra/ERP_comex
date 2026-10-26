import { isIP } from "node:net";

export function forwardedClientIp(headers: Headers): string | null {
  const realIp = headers.get("x-real-ip");
  if (realIp !== null) {
    const candidate = realIp.trim();
    return !candidate.includes(",") && isIP(candidate) !== 0 ? candidate : null;
  }

  const candidate = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ?? "";
  return isIP(candidate) !== 0 ? candidate : null;
}
