import type { Pool } from "pg";
import { nextBrasiliaNcmRefresh, type NcmRefreshResult } from "./ncm-sync.js";

const RETRY_MS = 30 * 60 * 1000;
const LOCK_KEY = "catalog:ncm:coordinated-refresh";

export type NcmSyncState = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSource: "SISCOMEX" | "MDIC_GECEX" | null;
  lastSiscomexSuccessAt: string | null;
  lastError: string | null;
  nextAttemptAt: string;
  retryMode: boolean;
};

type StateRow = {
  last_attempt_at: Date | null;
  last_success_at: Date | null;
  last_source: NcmSyncState["lastSource"];
  last_siscomex_success_at: Date | null;
  last_error: string | null;
  next_attempt_at: Date;
  retry_mode: boolean;
};

const stateSql = `SELECT last_attempt_at,last_success_at,last_source,last_siscomex_success_at,
  last_error,next_attempt_at,retry_mode FROM catalog.ncm_sync_state WHERE id=1`;

function present(row: StateRow): NcmSyncState {
  return {
    lastAttemptAt: row.last_attempt_at?.toISOString() ?? null,
    lastSuccessAt: row.last_success_at?.toISOString() ?? null,
    lastSource: row.last_source,
    lastSiscomexSuccessAt: row.last_siscomex_success_at?.toISOString() ?? null,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at.toISOString(),
    retryMode: row.retry_mode,
  };
}

export async function readNcmSyncState(pool: Pool): Promise<NcmSyncState> {
  const result = await pool.query<StateRow>(stateSql);
  if (!result.rows[0]) throw new Error("Estado da sincronização NCM não inicializado.");
  return present(result.rows[0]);
}

export class NcmRefreshDeferred extends Error {
  readonly retryAt: number;
  constructor(retryAt: number) {
    super("A sincronização automática de NCM já está agendada ou em execução.");
    this.retryAt = retryAt;
    this.name = "NcmRefreshDeferred";
  }
}

function nextRetryAt(reported: number | null | undefined): number {
  const now = Date.now();
  return reported && reported > now ? reported + 30_000 : now + RETRY_MS;
}

function errorRetryAt(error: unknown): number | null {
  return error && typeof error === "object" && "retryAt" in error
    && typeof error.retryAt === "number" && Number.isFinite(error.retryAt) ? error.retryAt : null;
}

export async function runCoordinatedNcmRefresh(
  pool: Pool,
  refresh: () => Promise<NcmRefreshResult>,
  times: string,
  mode: "manual" | "automatic",
): Promise<{ result: NcmRefreshResult; state: NcmSyncState }> {
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [LOCK_KEY]);
    locked = lock.rows[0]?.acquired === true;
    if (!locked) throw new NcmRefreshDeferred(Date.now() + 60_000);

    const current = await client.query<StateRow>(stateSql);
    const state = current.rows[0];
    if (!state) throw new Error("Estado da sincronização NCM não inicializado.");
    const scheduledAt = state.next_attempt_at.getTime();
    if ((mode === "automatic" || state.retry_mode) && scheduledAt > Date.now()) {
      throw new NcmRefreshDeferred(scheduledAt);
    }

    // Write a recovery time before network I/O. A process crash cannot lose the retry.
    await client.query(
      `UPDATE catalog.ncm_sync_state SET last_attempt_at=now(),
         next_attempt_at=now()+interval '30 minutes',retry_mode=true,
         last_error='Tentativa interrompida antes da conclusão.',updated_at=now() WHERE id=1`);
    try {
      const result = await refresh();
      const nextAt = result.catalogSource === "SISCOMEX"
        ? nextBrasiliaNcmRefresh(Date.now(), times)
        : nextRetryAt(result.siscomexRetryAt);
      await client.query(
        `UPDATE catalog.ncm_sync_state SET last_success_at=now(),last_source=$1::text,
           last_siscomex_success_at=CASE WHEN $1::text='SISCOMEX' THEN now() ELSE last_siscomex_success_at END,
           last_error=$2,next_attempt_at=$3,retry_mode=$4,updated_at=now() WHERE id=1`,
        [result.catalogSource, result.catalogSource === "SISCOMEX" ? null
          : result.siscomexFailure ?? "Siscomex indisponível; catálogo MDIC carregado.",
        new Date(nextAt), result.catalogSource !== "SISCOMEX"]);
      const saved = await client.query<StateRow>(stateSql);
      if (!saved.rows[0]) throw new Error("Estado da sincronização NCM não inicializado após a atualização.");
      return { result, state: present(saved.rows[0]) };
    } catch (error) {
      const nextAt = nextRetryAt(errorRetryAt(error));
      await client.query(
        `UPDATE catalog.ncm_sync_state SET last_error=$1,next_attempt_at=$2,
           retry_mode=true,updated_at=now() WHERE id=1`,
        [error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida.", new Date(nextAt)]);
      throw error;
    }
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]);
    client.release();
  }
}

export function startDurableNcmRefresh(
  pool: Pool,
  times: string,
  refresh: () => Promise<NcmRefreshResult>,
  logger: { info: (details: object, message: string) => void; error: (details: object, message: string) => void },
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped) return;
    try {
      const state = await readNcmSyncState(pool);
      if (Date.parse(state.nextAttemptAt) <= Date.now()) {
        try {
          const completed = await runCoordinatedNcmRefresh(pool, refresh, times, "automatic");
          logger.info({ ...completed.result, nextAt: completed.state.nextAttemptAt }, "Sincronização automática de NCMs concluída");
        } catch (error) {
          if (!(error instanceof NcmRefreshDeferred)) logger.error({ error }, "Falha na sincronização automática de NCMs");
        }
      }
    } catch (error) {
      logger.error({ error }, "Não foi possível consultar o agendamento de NCMs");
    } finally {
      if (!stopped) timer = setTimeout(() => { void tick(); }, 60_000);
    }
  };
  void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
