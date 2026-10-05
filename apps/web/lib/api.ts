export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const emptyPost = method === "POST" && init.body == null;
  if (emptyPost) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = await fetch("/auth/csrf", { credentials: "same-origin", cache: "no-store" });
    if (!csrf.ok) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
    const payload = await csrf.json() as { token: string };
    headers.set("X-CSRF-TOKEN", payload.token);
  }

  if (/^https?:\/\//i.test(path)) {
    throw new Error("A API deve usar a mesma origem da aplicação.");
  }

  return fetch(path, {
    ...init,
    method,
    headers,
    body: emptyPost ? "{}" : init.body,
    credentials: "same-origin"
  });
}

export async function readApiJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let body: (T & { detail?: string }) | undefined;
  try {
    body = raw ? JSON.parse(raw) as T & { detail?: string } : undefined;
  } catch {
    const excerpt = raw.trim().slice(0, 240);
    throw new Error(`A API respondeu HTTP ${response.status} sem JSON${excerpt ? `: ${excerpt}` : "."}`);
  }
  if (!response.ok) throw new Error(body?.detail ?? `Falha na API (HTTP ${response.status}).`);
  if (body === undefined) throw new Error(`A API respondeu HTTP ${response.status} sem conteúdo.`);
  return body as T;
}
