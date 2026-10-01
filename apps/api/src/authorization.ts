import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";

/** Permission keys for the business operations already described by the API plan. */
export type Permission =
  | "purchase-orders.read"
  | "processes.read"
  | "quality.read"
  | "quality.resolve"
  | "catalog.read"
  | "catalog.write"
  | "requests.read"
  | "requests.write"
  | "users.manage";

type Role = "Master" | "Administrador" | "Importação" | "Compras" | "Fiscal" | "Logística" | "Gestor" | "Consulta";

const rolePermissions: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  Master: new Set(["purchase-orders.read", "processes.read", "quality.read", "quality.resolve", "catalog.read", "catalog.write", "requests.read", "requests.write", "users.manage"]),
  Administrador: new Set(["purchase-orders.read", "processes.read", "quality.read", "quality.resolve", "catalog.read", "catalog.write", "requests.read", "requests.write"]),
  Importação: new Set(["purchase-orders.read", "processes.read", "quality.read", "quality.resolve", "catalog.read", "requests.read", "requests.write"]),
  Compras: new Set(["purchase-orders.read", "processes.read", "quality.read", "quality.resolve", "catalog.read", "catalog.write", "requests.read"]),
  Fiscal: new Set(["purchase-orders.read", "processes.read", "quality.read", "quality.resolve", "catalog.read", "catalog.write", "requests.read"]),
  Logística: new Set(["purchase-orders.read", "processes.read", "quality.read", "quality.resolve", "catalog.read"]),
  Gestor: new Set(["purchase-orders.read", "processes.read", "quality.read", "catalog.read"]),
  Consulta: new Set(["purchase-orders.read", "processes.read", "quality.read", "catalog.read"]),
};

export type AuthorizationContext = {
  roles: string[];
  importerScopes: string[];
  permissions: ReadonlySet<Permission>;
};

declare module "fastify" {
  interface FastifyRequest {
    authorizationContext: AuthorizationContext | null;
  }

  interface FastifyContextConfig {
    permission?: Permission;
    scopeMode?: "importer" | "global";
  }
}

function isApiPath(url: string): boolean {
  const path = url.split("?", 1)[0] ?? url;
  return path === "/api/v1" || path.startsWith("/api/v1/");
}

function deny(reply: FastifyReply, status: 401 | 403): FastifyReply {
  const title = status === 401 ? "Não autenticado" : "Acesso negado";
  const detail = status === 401 ? "Sessão ausente ou expirada." : "Permissão insuficiente.";
  return reply.code(status).send({
    type: "about:blank",
    title,
    status,
    detail,
    instance: reply.request.url.split("?", 1)[0],
    traceId: reply.request.id,
    code: status === 401 ? "AUTHENTICATION_REQUIRED" : "PERMISSION_DENIED",
  });
}

/** Register before business routes so every matched API route fails closed. */
export async function registerAuthorization(app: FastifyInstance, pool: Pool): Promise<void> {
  app.decorateRequest("authorizationContext", null);

  app.addHook("preHandler", async (request, reply) => {
    if (!isApiPath(request.url)) return;
    // Fastify invokes global hooks for its synthetic not-found route too.
    // Let that route preserve the contract's 404 instead of returning 403.
    if (!request.routeOptions.url || request.routeOptions.url === "*" || request.routeOptions.url === "/*") return;
    const identity = request.authContext;
    if (!identity) return deny(reply, 401);

    const permission = request.routeOptions.config.permission;
    const scopeMode = request.routeOptions.config.scopeMode;
    if (!permission || !scopeMode || (scopeMode === "global" && permission !== "users.manage")) {
      return deny(reply, 403);
    }

    const result = await pool.query<{ role: string; importer_code: string }>(
      `SELECT r.role, s.importer_code
       FROM identity.erp_user AS u
       LEFT JOIN identity.erp_user_role AS r ON r.user_id = u.id
       LEFT JOIN identity.erp_user_importer_scope AS s ON s.user_id = u.id
       WHERE u.issuer = $1 AND u.subject = $2 AND u.is_active = true`,
      [identity.issuer, identity.subject],
    );
    const roles = [...new Set(result.rows.flatMap((row) => row.role ? [row.role] : []))];
    let importerScopes = [...new Set(result.rows.flatMap((row) => row.importer_code ? [row.importer_code] : []))];
    if (roles.includes("Master")) {
      const allImporters = await pool.query<{ importer: string }>(
        `SELECT DISTINCT importer FROM procurement.purchase_order WHERE importer IS NOT NULL
         UNION SELECT DISTINCT importer FROM imports.import_process WHERE importer IS NOT NULL`,
      );
      importerScopes = allImporters.rows.map((row) => row.importer);
    }
    const permissions = new Set<Permission>();
    for (const role of roles) {
      if (Object.hasOwn(rolePermissions, role)) {
        for (const permission of rolePermissions[role as Role]) permissions.add(permission);
      }
    }
    const context = { roles, importerScopes, permissions };
    request.authorizationContext = context;
    // A master can inspect an empty database before its first import. Scoped
    // queries still return no rows until an importer exists.
    if (!permissions.has(permission)
      || (scopeMode === "importer" && importerScopes.length === 0 && !roles.includes("Master"))) {
      return deny(reply, 403);
    }
  });
}

/** Explicit route guard for use where a route needs an additional permission check. */
export function requirePermission(permission: Permission): preHandlerHookHandler {
  return async (request, reply) => {
    const context = request.authorizationContext;
    if (!context) return deny(reply, 401);
    if (!context.permissions.has(permission)) return deny(reply, 403);
  };
}

/**
 * Add the importer restriction to a SQL WHERE clause before pagination. Use
 * the resulting predicate in both list queries and id lookups; an empty scope
 * produces no rows, so an out-of-scope resource is indistinguishable (404).
 */
export function importerScopePredicate(
  column: string,
  firstParameter: number,
  scopes: readonly string[],
): { sql: string; values: unknown[] } {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/iu.test(column)) {
    throw new Error("Coluna SQL de importador inválida.");
  }
  if (!Number.isSafeInteger(firstParameter) || firstParameter < 1) {
    throw new Error("Posição de parâmetro SQL inválida.");
  }
  return { sql: `${column} = ANY($${firstParameter}::text[])`, values: [[...new Set(scopes)]] };
}

/** Route metadata enables fail-closed global policy checking in preHandler. */
export function permissionConfig(
  permission: Permission,
  scopeMode: "importer" | "global" = "importer",
): { permission: Permission; scopeMode: "importer" | "global" } {
  return { permission, scopeMode };
}
