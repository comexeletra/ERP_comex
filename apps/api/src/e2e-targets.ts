import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { DEFAULT_E2E_TARGET_SET, type E2eTargetSet } from "./followup-calculations.js";
import { actorAndScopes, BusinessError, problem, record, transaction, versionFrom } from "./operations.js";

const columns = `id, valid_from::text AS "validFrom", t0_days AS "t0Days", t1_days AS "t1Days", t2_days AS "t2Days",
  t3_mts_days AS "t3MtsDays", t3_not_mts_days AS "t3NotMtsDays", t4_sea_days AS "t4SeaDays",
  t4_air_days AS "t4AirDays", t5_days AS "t5Days", version::text AS version, updated_at AS "updatedAt"`;
const days = z.number().int().min(0).max(365);
const targetFields = z.object({
  validFrom: z.iso.date(), t0Days: days, t1Days: days, t2Days: days, t3MtsDays: days, t3NotMtsDays: days,
  t4SeaDays: days, t4AirDays: days, t5Days: days, reason: z.string().trim().min(3).max(1000),
}).strict();
const targetColumns: Record<keyof E2eTargetSet, string> = {
  validFrom: "valid_from", t0Days: "t0_days", t1Days: "t1_days", t2Days: "t2_days", t3MtsDays: "t3_mts_days",
  t3NotMtsDays: "t3_not_mts_days", t4SeaDays: "t4_sea_days", t4AirDays: "t4_air_days", t5Days: "t5_days",
};
type StoredSet = E2eTargetSet & { id: string; version: string; updatedAt: string };

/** Target sets ordered by start; the defaults when none is stored yet. */
export async function loadE2eTargetSets(pool: Pick<Pool, "query">): Promise<E2eTargetSet[]> {
  const result = await pool.query<StoredSet>(`SELECT ${columns} FROM catalog.e2e_target_set ORDER BY valid_from`);
  return result.rows.length ? result.rows : [DEFAULT_E2E_TARGET_SET];
}

export async function registerE2eTargetRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/e2e-targets", { config: permissionConfig("purchase-orders.read") }, async () => {
    const result = await pool.query<StoredSet>(`SELECT ${columns} FROM catalog.e2e_target_set ORDER BY valid_from`);
    return { items: result.rows };
  });

  app.post("/api/v1/e2e-targets", { config: permissionConfig("e2e-targets.manage", "global") }, async (request, reply) => {
    const parsed = targetFields.safeParse(request.body);
    if (!parsed.success) return problem(reply, 400, "INVALID_E2E_TARGETS", "Revise a vigência e as metas (0 a 365 dias).");
    let actor: ReturnType<typeof actorAndScopes>["actor"];
    try { actor = actorAndScopes(request).actor; } catch (error) {
      if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error;
    }
    const { reason, ...set } = parsed.data;
    return transaction(pool, reply, async client => {
      const keys = Object.keys(targetColumns) as (keyof E2eTargetSet)[];
      const inserted = await client.query<StoredSet>(`INSERT INTO catalog.e2e_target_set
          (${keys.map(key => targetColumns[key]).join(",")}, created_by, updated_by)
        VALUES (${keys.map((_, index) => `$${index + 1}`).join(",")}, $${keys.length + 1}, $${keys.length + 1})
        ON CONFLICT (valid_from) DO NOTHING RETURNING ${columns}`,
      [...keys.map(key => set[key]), `${actor.issuer}#${actor.subject}`]);
      if (!inserted.rows[0]) throw new BusinessError(409, "E2E_TARGETS_DATE_TAKEN", "Já existe um conjunto de metas com essa vigência.");
      await record(client, "E2E_TARGET_SET", inserted.rows[0].id, "E2E_TARGET_SET", inserted.rows[0].id, "CREATE",
        null, set, actor, reason);
      return inserted.rows[0];
    }, 201);
  });

  app.patch<{ Params: { id: string } }>("/api/v1/e2e-targets/:id",
    { config: permissionConfig("e2e-targets.manage", "global") }, async (request, reply) => {
      const id = z.uuid().safeParse(request.params.id); const parsed = targetFields.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_E2E_TARGETS", "Revise a vigência e as metas (0 a 365 dias).");
      let actor: ReturnType<typeof actorAndScopes>["actor"]; let version: string;
      try { actor = actorAndScopes(request).actor; version = versionFrom(request); } catch (error) {
        if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error;
      }
      const { reason, ...set } = parsed.data;
      return transaction(pool, reply, async client => {
        const current = await client.query<StoredSet>(`SELECT ${columns} FROM catalog.e2e_target_set WHERE id = $1 FOR UPDATE`, [id.data]);
        if (!current.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Conjunto de metas não encontrado.");
        if (`"${current.rows[0].version}"` !== version) {
          throw new BusinessError(409, "VERSION_CONFLICT", "As metas foram alteradas por outra pessoa. Recarregue antes de salvar.");
        }
        const keys = Object.keys(targetColumns) as (keyof E2eTargetSet)[];
        const updated = await client.query<StoredSet>(`UPDATE catalog.e2e_target_set
          SET ${keys.map((key, index) => `${targetColumns[key]} = $${index + 2}`).join(", ")},
            version = version + 1, updated_at = now(), updated_by = $${keys.length + 2}
          WHERE id = $1 RETURNING ${columns}`, [id.data, ...keys.map(key => set[key]), `${actor.issuer}#${actor.subject}`]);
        const { id: _id, version: _version, updatedAt: _updatedAt, ...before } = current.rows[0];
        await record(client, "E2E_TARGET_SET", id.data, "E2E_TARGET_SET", id.data, "UPDATE", before, set, actor, reason);
        return updated.rows[0];
      });
    });
}
