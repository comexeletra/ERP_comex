import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
import { z } from "zod";
import { hashPassword, verifyPassword } from "./password.js";

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
  mustChangePassword: boolean;
};

declare module "fastify" {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}

type AuthSettings = {
  appOrigin: string;
  secureCookies: boolean;
  sessionSecret: string;
};

type OidcSettings = AuthSettings & {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  clientAuthMethod: "client_secret_basic" | "client_secret_post";
};

function getAuthSettings(): AuthSettings | null {
  const sessionSecret = process.env.AUTH_SESSION_SECRET;
  const appOriginValue = process.env.APP_PUBLIC_ORIGIN;
  if (!sessionSecret || !appOriginValue) return null;
  if (Buffer.byteLength(sessionSecret) < 32) throw new Error("AUTH_SESSION_SECRET deve ter pelo menos 32 bytes.");

  const appUrl = new URL(appOriginValue);
  const isLocal = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(appUrl.hostname);
  if (appUrl.protocol !== "https:" && !isLocal) throw new Error("APP_PUBLIC_ORIGIN deve usar HTTPS.");
  if (appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    throw new Error("APP_PUBLIC_ORIGIN deve conter somente a origem pública.");
  }
  return { appOrigin: appUrl.origin, secureCookies: appUrl.protocol === "https:", sessionSecret };
}

function getOidcSettings(): OidcSettings | null {
  const auth = getAuthSettings();
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  if (!auth || !issuer || !clientId || !clientSecret) return null;
  const issuerUrl = new URL(issuer);
  if (issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash) {
    throw new Error("OIDC_ISSUER deve ser o identificador do issuer, sem credenciais, query ou fragmento.");
  }
  const isLocal = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(issuerUrl.hostname)
    && !auth.secureCookies;
  if (issuerUrl.protocol !== "https:" && !isLocal) throw new Error("OIDC_ISSUER deve usar HTTPS.");
  const clientAuthMethod = process.env.OIDC_CLIENT_AUTH_METHOD ?? "client_secret_basic";
  if (clientAuthMethod !== "client_secret_basic" && clientAuthMethod !== "client_secret_post") {
    throw new Error("OIDC_CLIENT_AUTH_METHOD deve ser client_secret_basic ou client_secret_post.");
  }

  return {
    ...auth,
    issuer,
    clientId,
    clientSecret,
    redirectUri: new URL(OIDC_CALLBACK_PATH, auth.appOrigin).href,
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

function csrfToken(settings: AuthSettings, sessionToken: string): string {
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
    || path === "/auth/me" || path === "/auth/csrf" || path === "/auth/logout"
    || path === "/auth/local/password";
}

const loginBody = z.object({
  email: z.email().trim().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(1024),
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(15).max(1024),
});

async function createSession(app: FastifyInstance, pool: Pool, reply: FastifyReply,
  settings: AuthSettings, userId: string): Promise<void> {
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
    [sha256(rawSessionToken), userId, sessionExpiresAt],
  );
  reply.setCookie(SESSION_COOKIE, rawSessionToken, {
    path: "/", httpOnly: true, secure: settings.secureCookies,
    sameSite: "lax", maxAge: SESSION_ABSOLUTE_TTL_SECONDS,
  });
  app.log.info({ userId }, "Sessão iniciada");
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

    const settings = getAuthSettings();
    if (!settings) return reply.code(503).send({ error: "Autenticação indisponível." });
    const rawSessionToken = request.cookies[SESSION_COOKIE];
    if (!rawSessionToken) return reply.code(401).send({ error: "Sessão ausente ou expirada." });

    const result = await pool.query<{
      id: string;
      issuer: string;
      subject: string;
      display_name: string | null;
      must_change_password: boolean | null;
    }>(
      `UPDATE identity.auth_session AS s
       SET last_seen_at = now()
       FROM identity.erp_user AS u
       LEFT JOIN identity.local_credential AS lc ON lc.user_id = u.id
       WHERE s.user_id = u.id
         AND s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND s.last_seen_at > now() - ($2::int * interval '1 minute')
         AND u.is_active = true
       RETURNING u.id, u.issuer, u.subject, u.display_name, lc.must_change_password`,
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
      mustChangePassword: user.must_change_password === true,
    };

    if (user.must_change_password && path !== "/auth/me" && path !== "/auth/csrf"
      && path !== "/auth/logout" && path !== "/auth/local/password") {
      return reply.code(403).send({ error: "Troca de senha obrigatória." });
    }

    if (isMutating(request.method)) {
      const origin = request.headers.origin;
      const suppliedCsrf = request.headers["x-csrf-token"];
      const expectedCsrf = csrfToken(settings, rawSessionToken);
      if (origin !== settings.appOrigin || typeof suppliedCsrf !== "string" || !safeEqual(expectedCsrf, suppliedCsrf)) {
        return reply.code(403).send({ error: "Validação anti-CSRF recusada." });
      }
    }
  });

  app.post("/auth/local/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      setNoStore(reply);
      const settings = getAuthSettings();
      if (!settings) return reply.code(503).send({ error: "Autenticação indisponível." });
      if (request.headers.origin !== settings.appOrigin) {
        return reply.code(403).send({ error: "Origem inválida." });
      }
      const parsed = loginBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Informe e-mail e senha válidos." });
      const { email, password } = parsed.data;
      const result = await pool.query<{
        user_id: string; password_hash: string; must_change_password: boolean;
        is_active: boolean; locked_until: Date | null;
      }>(
        `SELECT lc.user_id, lc.password_hash, lc.must_change_password,
                lc.locked_until, u.is_active
         FROM identity.local_credential AS lc
         JOIN identity.erp_user AS u ON u.id = lc.user_id
         WHERE lower(lc.email) = $1`, [email],
      );
      const credential = result.rows[0];
      const passwordMatches = await verifyPassword(password, credential?.password_hash ?? null);
      if (!credential || !credential.is_active || !passwordMatches
        || (credential.locked_until !== null && credential.locked_until > new Date())) {
        if (credential && !passwordMatches && credential.is_active) {
          await pool.query(
            `UPDATE identity.local_credential
             SET failed_attempts = failed_attempts + 1,
                 locked_until = CASE WHEN failed_attempts + 1 >= 5
                   THEN now() + interval '15 minutes' ELSE locked_until END
             WHERE user_id = $1 AND (locked_until IS NULL OR locked_until <= now())`,
            [credential.user_id],
          );
        }
        return reply.code(401).send({ error: "E-mail ou senha inválidos." });
      }
      await pool.query(
        `UPDATE identity.local_credential
         SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1`,
        [credential.user_id],
      );
      await createSession(app, pool, reply, settings, credential.user_id);
      return { authenticated: true, mustChangePassword: credential.must_change_password };
    });

  app.post("/auth/local/password", async (request, reply) => {
    setNoStore(reply);
    const auth = request.authContext;
    if (!auth) return reply.code(401).send({ error: "Sessão ausente ou expirada." });
    const parsed = changePasswordBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Senha inválida." });
    const credential = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM identity.local_credential WHERE user_id = $1", [auth.userId],
    );
    if (!await verifyPassword(parsed.data.currentPassword, credential.rows[0]?.password_hash ?? null)) {
      return reply.code(401).send({ error: "Senha atual inválida." });
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return reply.code(400).send({ error: "A nova senha deve ser diferente." });
    }
    const encoded = await hashPassword(parsed.data.newPassword);
    await pool.query(
      `UPDATE identity.local_credential
       SET password_hash = $1, must_change_password = false, failed_attempts = 0,
           locked_until = NULL, updated_at = now()
       WHERE user_id = $2`, [encoded, auth.userId],
    );
    await pool.query(
      "DELETE FROM identity.auth_session WHERE user_id = $1 AND token_hash <> $2",
      [auth.userId, sha256(auth.sessionToken)],
    );
    return reply.code(204).send();
  });

  app.get("/auth/login", async (_request, reply) => {
    setNoStore(reply);
    const settings = getOidcSettings();
    if (!settings) return reply.code(303).redirect("/login");

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

      const identity = await pool.query<{ id: string; is_active: boolean }>(
        `SELECT id, is_active
         FROM identity.erp_user
         WHERE issuer = $1 AND subject = $2`,
        [issuer, subject],
      );
      const user = identity.rows[0];
      if (!user?.is_active) {
        return reply.code(403).send({ error: "Acesso não autorizado." });
      }

      await createSession(app, pool, reply, settings, user.id);
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
      mustChangePassword: auth.mustChangePassword,
      roles: [...new Set(grants.rows.flatMap((row) => row.role ? [row.role] : []))],
      importerScopes: [...new Set(grants.rows.flatMap((row) => row.importer_code ? [row.importer_code] : []))],
    };
  });

  app.get("/auth/csrf", async (request, reply) => {
    setNoStore(reply);
    const settings = getAuthSettings();
    const auth = request.authContext;
    if (!settings) return reply.code(503).send({ error: "Autenticação indisponível." });
    if (!auth) return reply.code(401).send({ error: "Sessão ausente ou expirada." });
    return { token: csrfToken(settings, auth.sessionToken) };
  });

  app.post("/auth/logout", async (request, reply) => {
    setNoStore(reply);
    const settings = getAuthSettings();
    const auth = request.authContext;
    if (!settings) return reply.code(503).send({ error: "Autenticação indisponível." });
    if (auth) await pool.query("DELETE FROM identity.auth_session WHERE token_hash = $1", [sha256(auth.sessionToken)]);
    reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, secure: settings.secureCookies, sameSite: "lax" });
    return reply.code(204).send();
  });
}
