import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { permissionConfig } from "./authorization.js";

type Counts = { published: number; dead_lettered: number; leased: number;
  retry_waiting: number; ready: number; oldest_unpublished_at: Date | null };
type EventRow = { event_id: string; event_type: string; aggregate_type: string;
  occurred_at: Date; attempt_count: number; next_attempt_at: Date | null;
  lease_expires_at: Date | null; dead_lettered_at: Date | null };

export async function registerAdminOutboxRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/admin/outbox", { config: permissionConfig("users.manage", "global") },
    async (request, reply) => {
      if (!request.authorizationContext?.roles.includes("Master")) {
        return reply.code(403).send({ error: "Apenas Master pode consultar a fila." });
      }
      reply.header("cache-control", "no-store");
      const counts = await pool.query<Counts>(
        `SELECT
           count(*) FILTER (WHERE published_at IS NOT NULL)::int AS published,
           count(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NOT NULL)::int AS dead_lettered,
           count(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL
             AND lease_expires_at > now())::int AS leased,
           count(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL
             AND (lease_expires_at IS NULL OR lease_expires_at <= now())
             AND next_attempt_at > now())::int AS retry_waiting,
           count(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL
             AND (lease_expires_at IS NULL OR lease_expires_at <= now())
             AND (next_attempt_at IS NULL OR next_attempt_at <= now()))::int AS ready,
           min(occurred_at) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL)
             AS oldest_unpublished_at
         FROM audit.outbox_monitor`);
      const events = await pool.query<EventRow>(
        `SELECT event_id, event_type, aggregate_type, occurred_at, attempt_count,
                next_attempt_at, lease_expires_at, dead_lettered_at
         FROM audit.outbox_monitor WHERE published_at IS NULL
         ORDER BY occurred_at, event_id LIMIT 50`);
      const row = counts.rows[0];
      return { counts: {
        published: Number(row?.published ?? 0), deadLettered: Number(row?.dead_lettered ?? 0),
        leased: Number(row?.leased ?? 0), retryWaiting: Number(row?.retry_waiting ?? 0),
        ready: Number(row?.ready ?? 0), oldestUnpublishedAt: row?.oldest_unpublished_at ?? null,
      }, items: events.rows.map(event => ({
        id: event.event_id, eventType: event.event_type, aggregateType: event.aggregate_type,
        occurredAt: event.occurred_at, attempts: event.attempt_count,
        status: event.dead_lettered_at ? "DEAD_LETTERED"
          : event.lease_expires_at && event.lease_expires_at > new Date() ? "LEASED"
            : event.next_attempt_at && event.next_attempt_at > new Date() ? "RETRY_WAIT" : "READY",
        nextAttemptAt: event.next_attempt_at,
      })) };
    });
}
