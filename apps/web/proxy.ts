import { NextRequest, NextResponse } from "next/server";

const gatewayHeader = "x-import-erp-gateway-token";
const canonicalOrigin = "https://fup-comex-eletra.vercel.app";
const canonicalHost = new URL(canonicalOrigin).hostname;

function isGatewayPath(pathname: string): boolean {
  return pathname.startsWith("/auth/") || pathname.startsWith("/api/v1/");
}

export function proxy(request: NextRequest) {
  const requestHost = request.headers.get("host")?.split(":", 1)[0]?.toLowerCase();
  const isVercelPreview = process.env.VERCEL_ENV === "preview";
  if (isVercelPreview && !isGatewayPath(request.nextUrl.pathname)) {
    const previewOriginValue = process.env.PREVIEW_PUBLIC_ORIGIN;
    let previewOrigin: URL;
    try {
      previewOrigin = new URL(previewOriginValue ?? "");
      if (previewOrigin.protocol !== "https:" || previewOrigin.username || previewOrigin.password
        || previewOrigin.pathname !== "/" || previewOrigin.search || previewOrigin.hash) {
        throw new Error("PREVIEW_PUBLIC_ORIGIN deve ser uma origem HTTPS.");
      }
    } catch {
      return Response.json({ error: "Preview indisponível." }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    if ((request.method === "GET" || request.method === "HEAD")
      && requestHost !== previewOrigin.hostname.toLowerCase()) {
      return NextResponse.redirect(
        new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, previewOrigin),
      );
    }
  }

  // Login sessions belong to the canonical hostname. Vercel also exposes
  // project and deployment hostnames, which must open the same login page.
  // Preview aliases use a stable Preview hostname for isolated sessions.
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
  const localDevelopment = process.env.NODE_ENV === "development";
  const previewEnvironment = !localDevelopment && process.env.VERCEL_ENV !== undefined
    && process.env.VERCEL_ENV !== "production";
  const destination = localDevelopment ? process.env.API_DEV_ORIGIN ?? "http://127.0.0.1:4000"
    : previewEnvironment ? process.env.PREVIEW_API_URL : process.env.VPS_API_URL;
  const gatewayToken = localDevelopment ? process.env.API_DEV_TOKEN
    : previewEnvironment ? process.env.PREVIEW_API_TOKEN : process.env.VPS_API_TOKEN;
  if (!destination || !gatewayToken) {
    return Response.json({ error: "API indisponível." }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  let upstream: URL;
  try {
    const base = new URL(destination);
    const localAddress = localDevelopment && base.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
    if ((!localAddress && base.protocol !== "https:") || base.username || base.password
      || base.search || base.hash || base.pathname !== "/") {
      throw new Error("A URL da API deve ser uma origem válida sem caminho ou credenciais.");
    }
    upstream = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, base);
  } catch {
    return Response.json({ error: "Configuração da API inválida." }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const headers = new Headers(request.headers);
  headers.set(gatewayHeader, gatewayToken);
  // Keep version checks in an application header from the browser to avoid
  // Vercel treating If-Match as an edge precondition. Translate it only on
  // the forwarded request so currently deployed APIs remain compatible.
  const recordVersion = headers.get("x-record-version");
  if (recordVersion && /^[1-9][0-9]*$/.test(recordVersion)) {
    headers.set("if-match", `"${recordVersion}"`);
  }
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
    "/requests/:path*", "/processes/:path*", "/catalog", "/catalog/:path*", "/source-audit",
    "/pending-import-items", "/unassigned-po-items", "/admin/:path*", "/pcm", "/pcm/:path*",
    "/auth/:path*", "/api/v1/:path*",
  ],
};
