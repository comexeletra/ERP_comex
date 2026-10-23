import type { Messages } from "./i18n/pt-BR";

// The language provider registers the current dictionary here, since lib modules do not import it.
let apiMessages: (() => Messages) | null = null;

export function setApiMessages(source: () => Messages): void {
  apiMessages = source;
}

function apiText(): Messages["api"] {
  if (!apiMessages) throw new Error("setApiMessages must run before the first API call.");
  return apiMessages().api;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const emptyPost = method === "POST" && init.body == null;
  if (emptyPost) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = await fetch("/auth/csrf", { credentials: "same-origin", cache: "no-store" });
    if (!csrf.ok) throw new Error(apiText().sessionExpired);
    const payload = await csrf.json() as { token: string };
    headers.set("X-CSRF-TOKEN", payload.token);
  }

  if (/^https?:\/\//i.test(path)) {
    throw new Error(apiText().sameOrigin);
  }

  return fetch(path, {
    ...init,
    method,
    headers,
    body: emptyPost ? "{}" : init.body,
    credentials: "same-origin"
  });
}

export function isMissingApiRoute(status: number, body: unknown, route = "/api/v1/purchase-orders/complete"): boolean {
  if (status !== 404 || !body || typeof body !== "object" || Array.isArray(body)) return false;
  const error = body as Record<string, unknown>;
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return (typeof error.message === "string" &&
      new RegExp(`^Route (?:POST|GET|PATCH|PUT|DELETE):${escapedRoute} not found$`, "i").test(error.message))
    || (Object.keys(error).length === 1 && error.error === "Recurso não encontrado.");
}

export function hasIpLifecycleSupport(process: unknown): boolean {
  if (!process || typeof process !== "object" || Array.isArray(process)) return false;
  const lifecycleStatus = (process as Record<string, unknown>).lifecycleStatus;
  return lifecycleStatus === "OPEN" || lifecycleStatus === "CLOSED";
}

export function hasPoLifecycleSupport(purchaseOrder: unknown): boolean {
  if (!purchaseOrder || typeof purchaseOrder !== "object" || Array.isArray(purchaseOrder)) return false;
  const lifecycleStatus = (purchaseOrder as Record<string, unknown>).lifecycleStatus;
  return lifecycleStatus === "ACTIVE" || lifecycleStatus === "CLOSED"
    || lifecycleStatus === "CANCELLED" || lifecycleStatus === "DELETED";
}

export async function readApiJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let body: (T & { detail?: string }) | undefined;
  try {
    body = raw ? JSON.parse(raw) as T & { detail?: string } : undefined;
  } catch {
    const excerpt = raw.trim().slice(0, 240);
    throw new Error(apiText().noJson(response.status, excerpt));
  }
  if (!response.ok) throw new Error(body?.detail ?? apiText().failed(response.status));
  if (body === undefined) throw new Error(apiText().empty(response.status));
  return body as T;
}
