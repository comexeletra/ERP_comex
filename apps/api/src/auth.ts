import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  ClientSecretPost,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
} from "openid-client";
import type { Pool } from "pg";

const SESSION_COOKIE = "erp_session";
const OIDC_STATE_COOKIE = "erp_oidc_state";
const OIDC_CALLBACK_PATH = "/auth/callback";
const LOGIN_TRANSACTION_TTL_SECONDS = 10 * 60;
const SESSION_ABSOLUTE_TTL_SECONDS = 8 * 60 * 60;
const SESSION_IDLE_TTL_MINUTES = 30;

type AuthContext = {
  userId: string;
  issuer: string;
  subject: string;
  displayName: string | null;
  sessionToken: string;
};

declare module "fastify" {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}

type OidcSettings = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  appOrigin: string;
  secureCookies: boolean;
  sessionSecret: string;
  clientAuthMethod: "client_secret_basic" | "client_secret_post";
};

function getOidcSettings(): OidcSettings | null {
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const sessionSecret = process.env.AUTH_SESSION_SECRET;
  const appOriginValue = process.env.APP_PUBLIC_ORIGIN;
  if (!issuer || !clientId || !clientSecret || !sessionSecret || !appOriginValue) return null;
  if (Buffer.byteLength(sessionSecret) < 32) throw new Error("AUTH_SESSION_SECRET deve ter pelo menos 32 bytes.");

  const issuerUrl = new URL(issuer);
  const appUrl = new URL(appOriginValue);
  if (issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash) {
    throw new Error("OIDC_ISSUER deve ser o identificador do issuer, sem credenciais, query ou fragmento.");
  }
  const isLocal = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(issuerUrl.hostname)
    && new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(appUrl.hostname);
  if (issuerUrl.protocol !== "https:" && !isLocal) throw new Error("OIDC_ISSUER deve usar HTTPS.");
  if (appUrl.protocol !== "https:" && !isLocal) throw new Error("APP_PUBLIC_ORIGIN deve usar HTTPS.");
  if (appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    throw new Error("APP_PUBLIC_ORIGIN deve conter somente a origem pública.");
  }
  const clientAuthMethod = process.env.OIDC_CLIENT_AUTH_METHOD ?? "client_secret_basic";
  if (clientAuthMethod !== "client_secret_basic" && clientAuthMethod !== "client_secret_post") {
    throw new Error("OIDC_CLIENT_AUTH_METHOD deve ser client_secret_basic ou client_secret_post.");
  }

  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri: new URL(OIDC_CALLBACK_PATH, appUrl).href,
    appOrigin: appUrl.origin,
    secureCookies: appUrl.protocol === "https:",
    sessionSecret,
    clientAuthMethod,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function csrfToken(settings: OidcSettings, sessionToken: string): string {
  return createHmac("sha256", settings.sessionSecret).update(`csrf:${sessionToken}`).digest("base64url");
}

function setNoStore(reply: FastifyReply): void {
  reply.header("cache-control", "no-store").header("pragma", "no-cache");
}

function isMutating(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function requiresSession(path: string): boolean {
  return path === "/api/v1" || path.startsWith("/api/v1/")
    || path === "/auth/me" || path === "/auth/csrf" || path === "/auth/logout";
}

export async function registerAuthRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.decorateRequest("authContext", null);
  let oidcConfiguration: Promise<Configuration> | null = null;
  const getConfiguration = (settings: OidcSettings): Promise<Configuration> => {
    oidcConfiguration ??= discovery(
      new URL(settings.issuer),
      settings.clientId,
      { client_secret: settings.clientSecret },
      settings.clientAuthMethod === "client_secret_post"
        ? ClientSecretPost(settings.clientSecret)
        : ClientSecretBasic(settings.clientSecret),
    ).catch((error: unknown) => {
      oidcConfiguration = null;
      throw error;
    });
    return oidcConfiguration;
  };

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?", 1)[0] ?? request.url;
    if (!requiresSession(path)) return;

    const settings = getOidcSettings();
    if (!settings) return reply.code(503).send({ error: "Autenticação indisponível." });
    const rawSessionToken = request.cookies[SESSION_COOKIE];
    if (!rawSessionToken) return reply.code(401).send({ error: "Sessão ausente ou expirada." });

    const result = await pool.query<{
      id: string;
      issuer: string;
      subject: string;
      display_name: string | null;
    }>(
      `UPDATE identity.auth_session AS s
       SET last_seen_at = now()
       FROM identity.erp_user AS u
       WHERE s.user_id = u.id
         AND s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND s.last_seen_at > now() - ($2::int * interval '1 minute')
         AND u.is_active = true
       RETURNING u.id, u.issuer, u.subject, u.display_name`,
      [sha256(rawSessionToken), SESSION_IDLE_TTL_MINUTES],
    );
    const user = result.rows[0];
    if (!user) {
      reply.clearCookie(SESSION_COOKIE, { path: "/", secure: settings.secureCookies, sameSite: "lax" });
      return reply.code(401).send({ error: "Sessão ausente ou expirada." });
    }

    request.authContext = {
      userId: user.id,
      issuer: user.issuer,
      subject: user.subject,
      displayName: user.display_name,
      sessionToken: rawSessionToken,
    };

    if (isMutating(request.method)) {
      const origin = request.headers.origin;
      const suppliedCsrf = request.headers["x-csrf-token"];
      const expectedCsrf = csrfToken(settings, rawSessionToken);
      if (origin !== settings.appOrigin || typeof suppliedCsrf !== "string" || !safeEqual(expectedCsrf, suppliedCsrf)) {
        return reply.code(403).send({ error: "Validação anti-CSRF recusada." });
      }
    }
  });

  app.get("/auth/login", async (_request, reply) => {
    setNoStore(reply);
    const settings = getOidcSettings();
    if (!settings) return reply.code(503).send({ error: "Provedor OIDC não configurado." });

    const state = randomState();
    const nonce = randomNonce();
    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const expiresAt = new Date(Date.now() + LOGIN_TRANSACTION_TTL_SECONDS * 1000);
    await pool.query("DELETE FROM identity.oidc_login_transaction WHERE expires_at <= now()");
    await pool.query(
      `INSERT INTO identity.oidc_login_transaction (state_hash, nonce, code_verifier, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [sha256(state), nonce, codeVerifier, expiresAt],
    );

    reply.setCookie(OIDC_STATE_COOKIE, state, {
      path: OIDC_CALLBACK_PATH,
      httpOnly: true,
      secure: settings.secureCookies,
      sameSite: "lax",
      maxAge: LOGIN_TRANSACTION_TTL_SECONDS,
    });
    const configuration = await getConfiguration(settings);
    const authorizationUrl = buildAuthorizationUrl(configuration, {
      redirect_uri: settings.redirectUri,
      scope: "openid profile",
      response_type: "code",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });
    return reply.code(302).redirect(authorizationUrl.href);
  });

  app.get(OIDC_CALLBACK_PATH, async (request, reply) => {
    setNoStore(reply);
    const settings = getOidcSettings();
    if (!settings) return reply.code(503).send({ error: "Provedor OIDC não configurado." });

    const callbackUrl = new URL(request.url, settings.appOrigin);
    if (callbackUrl.origin !== settings.appOrigin || callbackUrl.pathname !== OIDC_CALLBACK_PATH) {
      return reply.code(400).send({ error: "Resposta OIDC inválida." });
    }
    const state = callbackUrl.searchParams.get("state");
    const stateCookie = request.cookies[OIDC_STATE_COOKIE];
    reply.clearCookie(OIDC_STATE_COOKIE, {
      path: OIDC_CALLBACK_PATH,
      httpOnly: true,
      secure: settings.secureCookies,
      sameSite: "lax",
    });
    if (!state || !stateCookie || !safeEqual(state, stateCookie)) {
      return reply.code(400).send({ error: "Resposta OIDC inválida." });
    }

    const consumed = await pool.query<{ nonce: string; code_verifier: string }>(
      `DELETE FROM identity.oidc_login_transaction
       WHERE state_hash = $1 AND expires_at > now()
       RETURNING nonce, code_verifier`,
      [sha256(state)],
    );
    const transaction = consumed.rows[0];
    if (!transaction) return reply.code(400).send({ error: "Fluxo de autenticação expirado ou já utilizado." });
    if (callbackUrl.searchParams.has("error")) {
      return reply.code(303).redirect(new URL("/login?error=authentication_failed", settings.appOrigin).href);
    }

    try {
      const configuration = await getConfiguration(settings);
      const tokens = await authorizationCodeGrant(configuration, callbackUrl, {
        expectedState: state,
        expectedNonce: transaction.nonce,
        pkceCodeVerifier: transaction.code_verifier,
      });
      const claims = tokens.claims();
      if (!claims) return reply.code(401).send({ error: "Identidade OIDC inválida." });
      const issuer = typeof claims.iss === "string" ? claims.iss : "";
      const subject = typeof claims.sub === "string" ? claims.sub : "";
      if (!issuer || !subject || issuer !== settings.issuer) {
        return reply.code(401).send({ error: "Identidade OIDC inválida." });
      }

      const displayName = typeof claims.name === "string"
        ? claims.name
        : typeof claims.preferred_username === "string"
          ? claims.preferred_username
          : typeof claims.email === "string" ? claims.email : null;
      const identity = await pool.query<{ id: string; is_active: boolean }>(
        `INSERT INTO identity.erp_user (id, issuer, subject, display_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (issuer, subject) DO UPDATE
           SET display_name = COALESCE(EXCLUDED.display_name, identity.erp_user.display_name)
         RETURNING id, is_active`,
        [randomUUID(), issuer, subject, displayName],
      );
      const user = identity.rows[0];
      if (!user?.is_active) {
        return reply.code(403).send({ error: "Acesso não autorizado." });
      }

      const rawSessionToken = randomBytes(32).toString("base64url");
      const sessionExpiresAt = new Date(Date.now() + SESSION_ABSOLUTE_TTL_SECONDS * 1000);
      await pool.query(
        `DELETE FROM identity.auth_session
         WHERE expires_at <= now()
            OR last_seen_at <= now() - ($1::int * interval '1 minute')
            OR revoked_at IS NOT NULL`,
        [SESSION_IDLE_TTL_MINUTES],
      );
      await pool.query(
        `INSERT INTO identity.auth_session (token_hash, user_id, expires_at)
         VALUES ($1, $2, $3)`,
        [sha256(rawSessionToken), user.id, sessionExpiresAt],
      );
      reply.setCookie(SESSION_COOKIE, rawSessionToken, {
        path: "/",
        httpOnly: true,
        secure: settings.secureCookies,
        sameSite: "lax",
        maxAge: SESSION_ABSOLUTE_TTL_SECONDS,
      });
      return reply.code(303).redirect(new URL("/", settings.appOrigin).href);
    } catch {
      return reply.code(303).redirect(new URL("/login?error=authentication_failed", settings.appOrigin).href);
    }
  });

  app.get("/auth/me", async (request, reply) => {
    setNoStore(reply);
    const auth = request.authContext;
    if (!auth) return reply.code(401).send({ error: "Sessão ausente ou expirada." });
    const grants = await pool.query<{ role: string | null; importer_code: string | null }>(
      `SELECT r.role, s.importer_code
       FROM identity.erp_user AS u
       LEFT JOIN identity.erp_user_role AS r ON r.user_id = u.id
       LEFT JOIN identity.erp_user_importer_scope AS s ON s.user_id = u.id
       WHERE u.id = $1`,
      [auth.userId],
    );
    return {
      authenticated: true,
      user: { id: auth.userId, issuer: auth.issuer, subject: auth.subject, displayName: auth.displayName },
      roles: [...new Set(grants.rows.flatMap((row) => row.role ? [row.role] : []))],
      importerScopes: [...new Set(grants.rows.flatMap((row) => row.importer_code ? [row.importer_code] : []))],
    };
  });

  app.get("/auth/csrf", async (request, reply) => {
    setNoStore(reply);
    const settings = getOidcSettings();
    const auth = request.authContext;
    if (!settings) return reply.code(503).send({ error: "Autenticação indisponível." });
    if (!auth) return reply.code(401).send({ error: "Sessão ausente ou expirada." });
    return { token: csrfToken(settings, auth.sessionToken) };
  });

  app.post("/auth/logout", async (request, reply) => {
    setNoStore(reply);
    const settings = getOidcSettings();
    const auth = request.authContext;
    if (!settings) return reply.code(503).send({ error: "Autenticação indisponível." });
    if (auth) await pool.query("DELETE FROM identity.auth_session WHERE token_hash = $1", [sha256(auth.sessionToken)]);
    reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, secure: settings.secureCookies, sameSite: "lax" });
    return reply.code(204).send();
  });
}
