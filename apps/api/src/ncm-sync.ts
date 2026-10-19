import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { officialNcmAttributesHash, type OfficialNcmCatalog, type OfficialNcmCatalogProvider } from "./siscomex-ncm.js";

export type NcmRefreshResult = {
  catalogSource: OfficialNcmCatalog["source"];
  siscomexRetryAt: number | null;
  siscomexFailure?: string | null;
  matchedCount: number;
  updatedCount: number;
  inactivatedCount: number;
  attributesUpdatedCount: number;
  preservedUnmatchedCount: number;
  sourceUpdatedAt: string | null;
  attributesSourceVersion: string | null;
};

export async function refreshRegisteredNcms(
  pool: Pool,
  official: OfficialNcmCatalog,
  actor: { issuer: string; subject: string; userId: string | null },
  reason?: string,
): Promise<NcmRefreshResult> {
  if (official.source !== "SISCOMEX") {
    throw new Error("A fonte MDIC está inativa; somente o Siscomex pode sincronizar NCMs.");
  }
  const client = await pool.connect();
  let matchedCount = 0;
  let updatedCount = 0;
  let inactivatedCount = 0;
  let preservedUnmatchedCount = 0;
  let attributesUpdatedCount = 0;
  const correlationId = randomUUID();
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const officialByCode = new Map(official.items.map(item => [item.code, item]));
  const auditReason = reason ?? "Atualização automática diária dos NCMs cadastrados pela fonte oficial do Siscomex.";
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["catalog:siscomex:ncm:refresh"]);
    const result = await client.query<any>(
      `SELECT entry.*, entry.normalized_code, entry.valid_from::text AS valid_from,
              entry.valid_to::text AS valid_to, official.mandatory_import_attributes, official.creation_act,
              official.source_updated_at::text AS source_updated_at, official.attributes_source_version,
              official.attributes_sha256, official.synced_at
       FROM catalog.entry AS entry
       LEFT JOIN catalog.ncm_siscomex_data AS official ON official.ncm_entry_id = entry.id
       WHERE entry.kind = 'NCM' AND entry.importer IS NULL
       ORDER BY entry.normalized_code FOR UPDATE OF entry`);

    for (const before of result.rows) {
      const source = officialByCode.get(before.normalized_code);
      if (!source && !official.verifiedComplete) {
        preservedUnmatchedCount += 1;
        continue;
      }
      if (source) matchedCount += 1;

      const isCurrentlyValid = source
        && (!source.validFrom || source.validFrom <= today)
        && (!source.validTo || source.validTo >= today);
      const evidence = source
        ? isCurrentlyValid
          ? `Vigência confirmada pela tabela oficial NCM da Receita Federal / Portal Único Siscomex em ${today}.`
          : `Não vigente em ${today}, conforme as datas da tabela oficial NCM do Siscomex.`
        : `Código ausente da tabela oficial completa de NCMs vigentes do Siscomex consultada em ${today}; inativado automaticamente para revisão fiscal.`;
      const changed = source
        ? {
          name: source.name,
          status: isCurrentlyValid ? "ACTIVE" : "INACTIVE",
          evidence,
          valid_from: source.validFrom,
          valid_to: source.validTo,
          provenance: "OFFICIAL_SISCOMEX",
        }
        : { name: before.name, status: "INACTIVE", evidence, valid_from: before.valid_from,
          valid_to: before.valid_to, provenance: before.provenance };
      const old = { name: before.name, status: before.status, evidence: before.evidence,
        valid_from: before.valid_from, valid_to: before.valid_to, provenance: before.provenance };
      const differences = Object.entries(changed).filter(([field, value]) => value !== old[field as keyof typeof old]);
      if (differences.length) {
        const updated = await client.query<any>(
          `UPDATE catalog.entry SET name=$2,status=$3,evidence=$4,valid_from=$5,valid_to=$6,
             provenance=$7,version=version+1,updated_by=$8,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [before.id, changed.name, changed.status, changed.evidence, changed.valid_from, changed.valid_to,
            changed.provenance, actor.userId]);
        updatedCount += 1;
        if (before.status !== "INACTIVE" && changed.status === "INACTIVE") inactivatedCount += 1;
        for (const [field, value] of differences) {
          await client.query(
            `INSERT INTO audit.audit_log
              (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
             VALUES ($1,'CATALOG_ENTRY',$2,'CATALOG_ENTRY',$2,'UPDATE',$3,$4::jsonb,$5::jsonb,$6,now(),$7,$8)`,
            [randomUUID(), before.id, field, JSON.stringify(old[field as keyof typeof old]), JSON.stringify(value),
              `${actor.issuer}#${actor.subject}`, auditReason, correlationId]);
        }
        await client.query(
          `INSERT INTO audit.outbox_message (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
           VALUES ($1,'catalog.entry.updated','CATALOG_ENTRY',$2,$3::jsonb,now())`,
          [randomUUID(), before.id, JSON.stringify({ id: before.id, importer: null, kind: "NCM",
            version: String(updated.rows[0].version), changedFields: differences.map(([field]) => field) })]);
      }

      if (!source) continue;
      const attributesHash = officialNcmAttributesHash(source.mandatoryImportAttributes);
      if (before.attributes_sha256?.trim() !== attributesHash) {
        attributesUpdatedCount += 1;
        await client.query(
          `INSERT INTO audit.audit_log
            (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
           VALUES ($1,'CATALOG_ENTRY',$2,'CATALOG_ENTRY',$2,$3,'mandatoryImportAttributes',$4::jsonb,$5::jsonb,$6,now(),$7,$8)`,
          [randomUUID(), before.id, before.attributes_sha256 ? "UPDATE" : "CREATE",
            before.mandatory_import_attributes ? JSON.stringify(before.mandatory_import_attributes) : null,
              JSON.stringify(source.mandatoryImportAttributes), `${actor.issuer}#${actor.subject}`, auditReason, correlationId]);
      }
      const creationAct = source.creationAct ?? null;
      const previousCreationAct = before.creation_act ?? null;
      const creationActChanged = (["tipoOrgaoAtoIni", "numeroAtoIni", "anoAtoIni"] as const)
        .some(field => (previousCreationAct?.[field] ?? null) !== (creationAct?.[field] ?? null));
      if (creationActChanged) {
        await client.query(
          `INSERT INTO audit.audit_log
            (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,actor_id,occurred_at,reason,correlation_id)
           VALUES ($1,'CATALOG_ENTRY',$2,'CATALOG_ENTRY',$2,$3,'creationAct',$4::jsonb,$5::jsonb,$6,now(),$7,$8)`,
          [randomUUID(), before.id, previousCreationAct ? "UPDATE" : "CREATE",
            JSON.stringify(previousCreationAct), JSON.stringify(creationAct),
            `${actor.issuer}#${actor.subject}`, auditReason, correlationId]);
      }
      await client.query(
        `INSERT INTO catalog.ncm_siscomex_data
          (ncm_entry_id,source_updated_at,attributes_source_version,mandatory_import_attributes,attributes_sha256,creation_act,synced_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,now())
         ON CONFLICT (ncm_entry_id) DO UPDATE SET source_updated_at=EXCLUDED.source_updated_at,
           attributes_source_version=EXCLUDED.attributes_source_version,
           mandatory_import_attributes=EXCLUDED.mandatory_import_attributes,
           attributes_sha256=EXCLUDED.attributes_sha256,creation_act=EXCLUDED.creation_act,synced_at=now()`,
        [before.id, official.sourceUpdatedAt, official.attributesVersion,
          JSON.stringify(source.mandatoryImportAttributes), attributesHash,
          creationAct ? JSON.stringify(creationAct) : null]);
    }
    await client.query(
      `INSERT INTO audit.outbox_message (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
       VALUES ($1,'catalog.ncm.official.refreshed','NCM_SYNC',$1,$2::jsonb,now())`,
      [correlationId, JSON.stringify({ catalogSource: official.source, matchedCount, updatedCount,
        inactivatedCount, attributesUpdatedCount, sourceUpdatedAt: official.sourceUpdatedAt,
        attributesSourceVersion: official.attributesVersion })]);
    await client.query("COMMIT");
    return { catalogSource: official.source, siscomexRetryAt: official.siscomexRetryAt ?? null,
      siscomexFailure: official.siscomexFailure ?? null,
      matchedCount, updatedCount, inactivatedCount, attributesUpdatedCount, preservedUnmatchedCount,
      sourceUpdatedAt: official.sourceUpdatedAt, attributesSourceVersion: official.attributesVersion };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export const systemNcmRefreshActor = { issuer: "system", subject: "siscomex-ncm-scheduler", userId: null };

export async function refreshInitialNcms(provider: OfficialNcmCatalogProvider, pool: Pool): Promise<NcmRefreshResult> {
  const official = await provider({ forceRefresh: true });
  return refreshRegisteredNcms(pool, official, systemNcmRefreshActor,
    "Sincronização automática inicial do catálogo oficial do Siscomex.");
}

export async function refreshScheduledNcms(provider: OfficialNcmCatalogProvider, pool: Pool): Promise<NcmRefreshResult> {
  const official = await provider({ forceRefresh: true });
  return refreshRegisteredNcms(pool, official, systemNcmRefreshActor);
}

const BRASILIA_TIME_ZONE = "America/Sao_Paulo";
const brasiliaParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRASILIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function localTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): number {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(brasiliaParts.formatToParts(guess).map(part => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += desired - represented;
  }
  return guess;
}

export function nextBrasiliaNcmRefresh(now: number, times: string | readonly string[] = "06:00,12:00"): number {
  const configuredTimes = (typeof times === "string" ? times.split(",") : [...times]).map(time => time.trim());
  if (configuredTimes.length === 0 || configuredTimes.some(time => {
    const match = /^(\d{2}):(\d{2})$/u.exec(time);
    return !match || Number(match[1]) > 23 || Number(match[2]) > 59;
  })) throw new Error("NCM_AUTO_REFRESH_TIME deve conter horários no formato HH:mm separados por vírgula.");
  const local = Object.fromEntries(brasiliaParts.formatToParts(now).map(part => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day)));
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    const runDate = new Date(date.getTime() + dayOffset * 86_400_000);
    const candidates = configuredTimes.map(time => {
      const [hour, minute] = time.split(":").map(Number);
      return localTimeToUtc(runDate.getUTCFullYear(), runDate.getUTCMonth() + 1, runDate.getUTCDate(), hour, minute);
    }).filter(candidate => candidate > now).sort((a, b) => a - b);
    if (candidates[0] !== undefined) return candidates[0];
  }
  throw new Error("Não foi possível calcular o próximo horário da sincronização de NCM.");
}

export function startDailyNcmRefresh(
  times: string | readonly string[],
  refresh: () => Promise<NcmRefreshResult>,
  logger: { info: (details: object, message: string) => void; error: (details: object, message: string) => void },
  options: { initialRefresh?: () => Promise<NcmRefreshResult> } = {},
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  let initialRefreshPending = options.initialRefresh !== undefined;

  const scheduleAt = (nextAt: number) => {
    if (stopped) return;
    logger.info({ nextAt: new Date(nextAt).toISOString(), times, timeZone: BRASILIA_TIME_ZONE },
      "Agendada proxima sincronizacao diaria de NCMs");
    timer = setTimeout(() => { void runRefresh(); }, Math.max(1, nextAt - Date.now()));
  };
  const scheduleNextDaily = (after = Date.now()) => scheduleAt(nextBrasiliaNcmRefresh(after, times));

  const runRefresh = async () => {
    if (stopped || running) return;
    running = true;
    const isInitial = initialRefreshPending;
    try {
      const result = await (isInitial ? options.initialRefresh!() : refresh());
      if (result.catalogSource === "MDIC_GECEX") {
        throw new Error("A fonte MDIC está inativa; somente o Siscomex pode concluir a sincronização.");
      }
      logger.info({ ...result, initial: isInitial }, "Sincronizacao automatica de NCMs concluida");
      if (isInitial) initialRefreshPending = false;
      scheduleNextDaily();
    } catch (error) {
      logger.error({ error, initial: isInitial }, "Falha na sincronizacao automatica de NCMs");
      const reportedRetryAt = error && typeof error === "object" && "retryAt" in error
        && typeof error.retryAt === "number" && Number.isFinite(error.retryAt) ? error.retryAt : 0;
      scheduleNextDaily(Math.max(Date.now(), reportedRetryAt));
    } finally {
      running = false;
    }
  };

  if (initialRefreshPending) void runRefresh();
  else scheduleNextDaily();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
