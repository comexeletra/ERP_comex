import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { minimumExporterAliasLength, normalizeExporterText } from "./exporter-alias.js";
import { actorAndScopes, BusinessError, keyFrom, problem, receipt, record, saveReceipt, transaction,
  versionFrom } from "./operations.js";

// Exporter aliases of a global supplier (M074). Reading follows the catalog;
// writing follows the supplier edit rule (Master, Administrador, Compras).
type AliasRow = { id: string; supplierId: string; alias: string; normalizedAlias: string; status: "ACTIVE" | "REMOVED";
  version: string; createdAt: string; createdBy: string };
const aliasColumns = `id, supplier_entry_id AS "supplierId", alias, normalized_alias AS "normalizedAlias", status,
  version::text AS version, created_at AS "createdAt", created_by AS "createdBy"`;
const reason = z.string().trim().min(3).max(1000);
const createBody = z.object({ alias: z.string().trim().min(1).max(240), reason }).strict();
const removeBody = z.object({ reason }).strict();
const supplierWriters = ["Master", "Administrador", "Compras"];
const commandType = "SUPPLIER_EXPORTER_ALIAS";

function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message);
  throw error;
}
function writer(request: FastifyRequest) {
  const roles = request.authorizationContext?.roles ?? [];
  if (!roles.some(role => supplierWriters.includes(role))) {
    throw new BusinessError(403, "PERMISSION_DENIED", "Perfil sem permissão para editar fornecedores.");
  }
  return actorAndScopes(request).actor;
}
function author(actor: { issuer: string; subject: string }) { return `${actor.issuer}#${actor.subject}`; }

export async function registerSupplierAliasRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/v1/suppliers/:id/exporter-aliases",
    { config: permissionConfig("catalog.read", "global") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id);
      if (!id.success) return problem(reply, 400, "INVALID_SUPPLIER", "Fornecedor inválido.");
      const [supplier, aliases] = await Promise.all([
        pool.query(`SELECT id FROM catalog.entry WHERE id = $1 AND kind = 'SUPPLIER' AND importer IS NULL`, [id.data]),
        pool.query<AliasRow>(`SELECT ${aliasColumns} FROM catalog.supplier_exporter_alias
          WHERE supplier_entry_id = $1 AND status = 'ACTIVE' ORDER BY alias`, [id.data]),
      ]);
      if (!supplier.rows[0]) return problem(reply, 404, "RESOURCE_NOT_FOUND", "Fornecedor não encontrado.");
      reply.header("cache-control", "no-store");
      return { items: aliases.rows };
    });

  app.post<{ Params: { id: string } }>("/api/v1/suppliers/:id/exporter-aliases",
    { config: permissionConfig("catalog.write", "global") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id), parsed = createBody.safeParse(request.body);
      if (!id.success || !parsed.success
        || normalizeExporterText(parsed.data.alias).length < minimumExporterAliasLength) {
        return problem(reply, 400, "INVALID_EXPORTER_ALIAS",
          `Informe o apelido (ao menos ${minimumExporterAliasLength} letras ou números) e o motivo.`);
      }
      let actor: ReturnType<typeof writer>; let key: string;
      try { actor = writer(request); key = keyFrom(request); } catch (error) { return failure(reply, error); }
      const supplierId = id.data, { alias, reason: why } = parsed.data;
      return transaction(pool, reply, async client => {
        const command = await receipt(client, actor.userId, key, commandType, { supplierId, alias, reason: why });
        if (command.existingId) {
          const previous = await client.query<AliasRow>(`SELECT ${aliasColumns} FROM catalog.supplier_exporter_alias
            WHERE id = $1`, [command.existingId]);
          return previous.rows[0];
        }
        const supplier = await client.query<{ id: string; code: string; name: string }>(
          `SELECT id, code, name FROM catalog.entry WHERE id = $1 AND kind = 'SUPPLIER' AND importer IS NULL FOR SHARE`,
          [supplierId]);
        if (!supplier.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Fornecedor não encontrado.");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`catalog:exporter-alias:${supplierId}`]);
        const duplicate = await client.query(`SELECT id FROM catalog.supplier_exporter_alias
          WHERE supplier_entry_id = $1 AND normalized_alias = $2 AND status = 'ACTIVE'`,
        [supplierId, normalizeExporterText(alias)]);
        if (duplicate.rows[0]) {
          throw new BusinessError(409, "EXPORTER_ALIAS_DUPLICATE", "Este apelido já está cadastrado para o fornecedor.");
        }
        const inserted = await client.query<AliasRow>(`INSERT INTO catalog.supplier_exporter_alias
            (id, supplier_entry_id, alias, created_by) VALUES ($1, $2, $3, $4) RETURNING ${aliasColumns}`,
        [randomUUID(), supplierId, alias, author(actor)]);
        const row = inserted.rows[0];
        await record(client, "CATALOG_ENTRY", supplierId, "SUPPLIER_EXPORTER_ALIAS", row.id, "CREATE", null,
          { supplierId, supplierCode: supplier.rows[0].code, alias }, actor, why);
        await saveReceipt(client, actor.userId, key, command.hash, commandType, row.id);
        return row;
      }, 201);
    });

  app.post<{ Params: { id: string; aliasId: string } }>("/api/v1/suppliers/:id/exporter-aliases/:aliasId/remove",
    { config: permissionConfig("catalog.write", "global") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id), aliasId = z.uuid().safeParse(request.params.aliasId);
      const parsed = removeBody.safeParse(request.body);
      if (!id.success || !aliasId.success || !parsed.success) {
        return problem(reply, 400, "INVALID_EXPORTER_ALIAS", "Informe o apelido e o motivo da remoção.");
      }
      let actor: ReturnType<typeof writer>; let version: string;
      try { actor = writer(request); version = versionFrom(request); } catch (error) { return failure(reply, error); }
      return transaction(pool, reply, async client => {
        const current = await client.query<AliasRow>(`SELECT ${aliasColumns} FROM catalog.supplier_exporter_alias
          WHERE id = $1 AND supplier_entry_id = $2 FOR UPDATE`, [aliasId.data, id.data]);
        const before = current.rows[0];
        if (!before) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Apelido não encontrado.");
        if (before.status === "REMOVED") throw new BusinessError(409, "EXPORTER_ALIAS_REMOVED", "Este apelido já foi removido.");
        if (`"${before.version}"` !== version) {
          throw new BusinessError(409, "VERSION_CONFLICT", "O apelido foi alterado por outra pessoa. Recarregue antes de salvar.");
        }
        const updated = await client.query<AliasRow>(`UPDATE catalog.supplier_exporter_alias
          SET status = 'REMOVED', removed_at = now(), removed_by = $2, remove_reason = $3, version = version + 1
          WHERE id = $1 RETURNING ${aliasColumns}`, [aliasId.data, author(actor), parsed.data.reason]);
        await record(client, "CATALOG_ENTRY", id.data, "SUPPLIER_EXPORTER_ALIAS", aliasId.data, "REMOVE",
          { alias: before.alias, status: before.status }, { alias: before.alias, status: "REMOVED" }, actor, parsed.data.reason);
        return updated.rows[0];
      });
    });
}
