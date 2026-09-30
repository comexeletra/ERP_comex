import { NextRequest, NextResponse } from "next/server";

const gatewayHeader = "x-import-erp-gateway-token";
const canonicalOrigin = "https://fup-comex-eletra.vercel.app";
const canonicalHost = new URL(canonicalOrigin).hostname;

function isGatewayPath(pathname: string): boolean {
  return pathname.startsWith("/auth/") || pathname.startsWith("/api/v1/");
}

export function proxy(request: NextRequest) {
  // During local transition, next.config.ts proxies these paths to the legacy API.
  if (process.env.NODE_ENV === "development") return NextResponse.next();

  const requestHost = request.headers.get("host")?.split(":", 1)[0]?.toLowerCase();
  // Login sessions belong to the canonical hostname. Vercel also exposes
  // project and deployment hostnames, which must open the same login page.
  if ((request.method === "GET" || request.method === "HEAD")
    && requestHost?.endsWith(".vercel.app")
    && requestHost !== canonicalHost
    && !isGatewayPath(request.nextUrl.pathname)) {
    return NextResponse.redirect(
      new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, canonicalOrigin),
    );
  }

  if (!isGatewayPath(request.nextUrl.pathname)) return NextResponse.next();

  const destination = process.env.VPS_API_URL;
  const gatewayToken = process.env.VPS_API_TOKEN;
  if (!destination || !gatewayToken) {
    return Response.json({ error: "API indisponível." }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  let upstream: URL;
  try {
    const base = new URL(destination);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
      throw new Error("VPS_API_URL deve ser uma origem HTTPS sem caminho ou credenciais.");
    }
    upstream = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, base);
  } catch {
    return Response.json({ error: "Configuração da API inválida." }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const headers = new Headers(request.headers);
  headers.set(gatewayHeader, gatewayToken);
  headers.delete("host");
  // A same-origin browser request can lose Origin at an intermediary. Restore
  // it only when Fetch Metadata confirms that it came from this hostname.
  if (!headers.has("origin") && request.headers.get("sec-fetch-site") === "same-origin") {
    headers.set("origin", request.nextUrl.origin);
  }
  return NextResponse.rewrite(upstream, { request: { headers } });
}

export const config = {
  matcher: [
    "/", "/login", "/change-password", "/quality", "/purchase-orders/:path*",
    "/admin/:path*", "/auth/:path*", "/api/v1/:path*",
  ],
};
