import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { generateTemporaryPassword, hashPassword } from "./password.js";

const roles = ["Administrador", "PCM", "Importação", "Compras", "Fiscal", "Logística", "Gestor", "Consulta"] as const;
const emailField = z.email().trim().max(254).transform((value) => value.toLowerCase());
const scopesField = z.array(z.string().trim().min(1).max(120)).max(50)
  .refine((values) => new Set(values).size === values.length);
const createUserBody = z.object({
  email: emailField,
  displayName: z.string().trim().min(2).max(200),
  role: z.enum(roles),
  importerScopes: scopesField,
});
const updateUserBody = z.object({
  displayName: z.string().trim().min(2).max(200).optional(),
  role: z.enum(roles).optional(),
  importerScopes: scopesField.optional(),
  isActive: z.boolean().optional(),
}).refine((body) => Object.keys(body).length > 0);
const idParams = z.object({ id: z.uuid() });

async function masterOnly(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.authorizationContext?.roles.includes("Master")) {
    reply.code(403).send({ error: "Apenas o usuário master pode gerir acessos." });
  }
}

async function validImporters(pool: Pool, scopes: string[]): Promise<boolean> {
  const result = await pool.query<{ importer: string }>(
    `SELECT DISTINCT importer FROM procurement.purchase_order WHERE importer = ANY($1::text[])
     UNION SELECT DISTINCT importer FROM imports.import_process WHERE importer = ANY($1::text[])`,
    [scopes],
  );
  return result.rows.length === scopes.length;
}

async function audit(pool: { query: Pool["query"] }, actor: string, target: string,
  action: string, details: object): Promise<void> {
  await pool.query(
    `INSERT INTO identity.user_admin_event
       (id, actor_user_id, target_user_id, action, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [randomUUID(), actor, target, action, JSON.stringify(details)],
  );
}

export async function registerAdminUserRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const options = { config: permissionConfig("users.manage", "global"), preHandler: masterOnly };

  app.get("/api/v1/admin/importers", options, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    const result = await pool.query<{ importer: string }>(
      `SELECT DISTINCT importer FROM procurement.purchase_order WHERE importer IS NOT NULL
       UNION SELECT DISTINCT importer FROM imports.import_process WHERE importer IS NOT NULL
       ORDER BY importer`,
    );
    return { items: result.rows.map((row) => row.importer) };
  });

  app.get("/api/v1/admin/users", options, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    const result = await pool.query<{
      id: string; email: string; display_name: string | null; is_active: boolean;
      role: string | null; importer_scopes: string[]; must_change_password: boolean;
    }>(
      `SELECT u.id, lc.email, u.display_name, u.is_active, lc.must_change_password,
              (SELECT r.role FROM identity.erp_user_role AS r WHERE r.user_id = u.id
               ORDER BY (r.role = 'Master') DESC, r.role LIMIT 1) AS role,
              ARRAY(SELECT s.importer_code FROM identity.erp_user_importer_scope AS s
                    WHERE s.user_id = u.id ORDER BY s.importer_code) AS importer_scopes
       FROM identity.local_credential AS lc
       JOIN identity.erp_user AS u ON u.id = lc.user_id
       ORDER BY lower(lc.email)`,
    );
    return { items: result.rows.map((row) => ({
      id: row.id, email: row.email, displayName: row.display_name,
      isActive: row.is_active, role: row.role,
      importerScopes: row.importer_scopes,
      mustChangePassword: row.must_change_password,
    })) };
  });

  app.post("/api/v1/admin/users", options, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const parsed = createUserBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Dados de usuário inválidos." });
    const { email, displayName, role, importerScopes } = parsed.data;
    if (!await validImporters(pool, importerScopes)) {
      return reply.code(400).send({ error: "Uma ou mais importadoras não existem nos dados TOTVS." });
    }
    const password = generateTemporaryPassword();
    const passwordHash = await hashPassword(password);
    const userId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO identity.erp_user (id, issuer, subject, display_name, is_active)
         VALUES ($1, 'urn:import-erp:local', $2, $3, true)`,
        [userId, email, displayName],
      );
      await client.query(
        `INSERT INTO identity.local_credential (user_id, email, password_hash)
         VALUES ($1, $2, $3)`, [userId, email, passwordHash],
      );
      await client.query("INSERT INTO identity.erp_user_role (user_id, role) VALUES ($1, $2)", [userId, role]);
      await client.query(
        `INSERT INTO identity.erp_user_importer_scope (user_id, importer_code)
         SELECT $1, unnest($2::text[])`, [userId, importerScopes],
      );
      await audit(client, request.authContext!.userId, userId, "created", { role, importerScopes });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return reply.code(409).send({ error: "E-mail já cadastrado." });
      }
      throw error;
    } finally {
      client.release();
    }
    return reply.code(201).send({ id: userId, temporaryPassword: password });
  });

  app.patch("/api/v1/admin/users/:id", options, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const params = idParams.safeParse(request.params);
    const parsed = updateUserBody.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: "Dados inválidos." });
    const changes = parsed.data;
    if (changes.importerScopes && !await validImporters(pool, changes.importerScopes)) {
      return reply.code(400).send({ error: "Uma ou mais importadoras não existem nos dados TOTVS." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ is_master: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM identity.erp_user_role AS r
                       WHERE r.user_id = u.id AND r.role = 'Master') AS is_master
         FROM identity.erp_user AS u
         JOIN identity.local_credential AS lc ON lc.user_id = u.id
         WHERE u.id = $1 FOR UPDATE OF u`, [params.data.id],
      );
      if (!existing.rows[0]) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Usuário não encontrado." }); }
      if (existing.rows[0].is_master) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "Contas master não são alteradas por esta rota." });
      }
      if (changes.displayName !== undefined || changes.isActive !== undefined) {
        await client.query(
          `UPDATE identity.erp_user SET display_name = COALESCE($2, display_name),
           is_active = COALESCE($3, is_active) WHERE id = $1`,
          [params.data.id, changes.displayName ?? null, changes.isActive ?? null],
        );
      }
      if (changes.role !== undefined) {
        await client.query("DELETE FROM identity.erp_user_role WHERE user_id = $1", [params.data.id]);
        await client.query("INSERT INTO identity.erp_user_role (user_id, role) VALUES ($1, $2)",
          [params.data.id, changes.role]);
      }
      if (changes.importerScopes !== undefined) {
        await client.query("DELETE FROM identity.erp_user_importer_scope WHERE user_id = $1", [params.data.id]);
        await client.query(
          `INSERT INTO identity.erp_user_importer_scope (user_id, importer_code)
           SELECT $1, unnest($2::text[])`, [params.data.id, changes.importerScopes],
        );
      }
      await client.query("DELETE FROM identity.auth_session WHERE user_id = $1", [params.data.id]);
      await audit(client, request.authContext!.userId, params.data.id, "updated", changes);
      await client.query("COMMIT");
      return reply.code(204).send();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/v1/admin/users/:id/reset-password", options, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Usuário inválido." });
    const password = generateTemporaryPassword();
    const passwordHash = await hashPassword(password);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query<{ is_master: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM identity.erp_user_role AS r
                       WHERE r.user_id = lc.user_id AND r.role = 'Master') AS is_master
         FROM identity.local_credential AS lc
         WHERE lc.user_id = $1 FOR UPDATE OF lc`, [params.data.id],
      );
      if (!target.rows[0]) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Usuário não encontrado." }); }
      if (target.rows[0].is_master) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "Contas master não são alteradas por esta rota." });
      }
      await client.query(
        `UPDATE identity.local_credential SET password_hash = $1,
         must_change_password = true, failed_attempts = 0, locked_until = NULL, updated_at = now()
         WHERE user_id = $2`, [passwordHash, params.data.id],
      );
      await client.query("DELETE FROM identity.auth_session WHERE user_id = $1", [params.data.id]);
      await audit(client, request.authContext!.userId, params.data.id, "password_reset", {});
      await client.query("COMMIT");
      return { temporaryPassword: password };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
