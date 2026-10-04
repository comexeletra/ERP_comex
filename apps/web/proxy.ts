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
  const isVercelPreview = process.env.VERCEL_ENV === "preview";
  // Login sessions belong to the canonical hostname. Vercel also exposes
  // project and deployment hostnames, which must open the same login page.
  // Preview deployments keep their own hostname so they use isolated sessions.
  if ((request.method === "GET" || request.method === "HEAD")
    && !isVercelPreview
    && requestHost?.endsWith(".vercel.app")
    && requestHost !== canonicalHost
    && !isGatewayPath(request.nextUrl.pathname)) {
    return NextResponse.redirect(
      new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, canonicalOrigin),
    );
  }

  if (!isGatewayPath(request.nextUrl.pathname)) return NextResponse.next();

  // Preview must have its own API endpoint and gateway token. If staging is
  // not configured, fail closed instead of forwarding Preview to production.
  const previewEnvironment = process.env.VERCEL_ENV !== undefined
    && process.env.VERCEL_ENV !== "production";
  const destination = previewEnvironment
    ? process.env.PREVIEW_API_URL
    : process.env.VPS_API_URL;
  const gatewayToken = previewEnvironment
    ? process.env.PREVIEW_API_TOKEN
    : process.env.VPS_API_TOKEN;
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
    "/requests/:path*", "/processes/:path*", "/catalog", "/source-audit",
    "/pending-import-items", "/unassigned-po-items", "/admin/:path*",
    "/auth/:path*", "/api/v1/:path*",
  ],
};
