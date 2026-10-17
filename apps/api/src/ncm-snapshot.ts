import type { Pool } from "pg";
import {
  createOfficialNcmCatalogProvider,
  type OfficialNcmCatalog,
  type OfficialNcmCatalogProvider,
} from "./siscomex-ncm.js";

type SnapshotMetadata = {
  catalog_source: OfficialNcmCatalog["source"];
  source_reference: string;
  source_updated_at: string | null;
  attributes_source_version: string;
  item_count: number;
  synced_at: Date | string;
};

type SnapshotItem = {
  code: string;
  name: string;
  valid_from: string | null;
  valid_to: string | null;
  mandatory_import_attributes: OfficialNcmCatalog["items"][number]["mandatoryImportAttributes"];
};

type CachedSnapshot = { catalog: OfficialNcmCatalog; syncedAt: string };

const SNAPSHOT_CHECK_INTERVAL_MS = 60_000;
const SNAPSHOT_WRITE_BATCH_SIZE = 400;

function timestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Data de sincronização do catálogo NCM inválida.");
  return parsed.toISOString();
}

export async function replaceOfficialNcmSnapshot(pool: Pool, catalog: OfficialNcmCatalog): Promise<string> {
  if (!catalog.verifiedComplete || catalog.items.length < 9_000) {
    throw new Error("Não é possível persistir um catálogo NCM incompleto.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["catalog:siscomex:ncm:snapshot"]);
    const previous = await client.query<{ item_count: number }>(
      "SELECT item_count FROM catalog.ncm_official_snapshot WHERE snapshot_id=1");
    if (previous.rows[0] && catalog.items.length < Number(previous.rows[0].item_count) * 0.95) {
      throw new Error("O catálogo NCM diminuiu mais de 5% frente à última carga; revisão necessária.");
    }
    await client.query("DELETE FROM catalog.ncm_official_item");

    for (let offset = 0; offset < catalog.items.length; offset += SNAPSHOT_WRITE_BATCH_SIZE) {
      const items = catalog.items.slice(offset, offset + SNAPSHOT_WRITE_BATCH_SIZE);
      const values: unknown[] = [];
      const tuples = items.map((item, index) => {
        const parameter = index * 5;
        values.push(item.code, item.name, item.validFrom, item.validTo,
          JSON.stringify(item.mandatoryImportAttributes));
        return `($${parameter + 1},$${parameter + 2},$${parameter + 3},$${parameter + 4},$${parameter + 5}::jsonb)`;
      });
      await client.query(
        `INSERT INTO catalog.ncm_official_item
          (code,name,valid_from,valid_to,mandatory_import_attributes)
         VALUES ${tuples.join(",")}`,
        values);
    }

    const metadata = await client.query<{ synced_at: Date | string }>(
      `INSERT INTO catalog.ncm_official_snapshot
        (snapshot_id,catalog_source,source_reference,source_updated_at,attributes_source_version,item_count,synced_at)
       VALUES (1,$1,$2,$3,$4,$5,now())
       ON CONFLICT (snapshot_id) DO UPDATE SET catalog_source=EXCLUDED.catalog_source,
         source_reference=EXCLUDED.source_reference,source_updated_at=EXCLUDED.source_updated_at,
         attributes_source_version=EXCLUDED.attributes_source_version,
         item_count=EXCLUDED.item_count,synced_at=EXCLUDED.synced_at
       RETURNING synced_at`,
      [catalog.source, catalog.sourceReference, catalog.sourceUpdatedAt,
        catalog.attributesVersion, catalog.items.length]);
    if (catalog.source === "SISCOMEX") {
      await client.query("DELETE FROM catalog.ncm_last_siscomex_item");
      await client.query("INSERT INTO catalog.ncm_last_siscomex_item SELECT * FROM catalog.ncm_official_item");
      await client.query(
        `INSERT INTO catalog.ncm_last_siscomex_snapshot
          (snapshot_id,source_updated_at,attributes_source_version,item_count,synced_at)
         VALUES (1,$1,$2,$3,now())
         ON CONFLICT (snapshot_id) DO UPDATE SET source_updated_at=EXCLUDED.source_updated_at,
           attributes_source_version=EXCLUDED.attributes_source_version,
           item_count=EXCLUDED.item_count,synced_at=EXCLUDED.synced_at`,
        [catalog.sourceUpdatedAt, catalog.attributesVersion, catalog.items.length]);
    }
    await client.query("COMMIT");
    return timestamp(metadata.rows[0].synced_at);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createPersistedOfficialNcmCatalogProvider(
  pool: Pool,
  fetchCatalog: () => Promise<OfficialNcmCatalog>,
): OfficialNcmCatalogProvider {
  const upstream = createOfficialNcmCatalogProvider(fetchCatalog);
  let cached: CachedSnapshot | null = null;
  let checkedAt = 0;
  let loading: Promise<OfficialNcmCatalog> | null = null;

  const persist = async (catalog: OfficialNcmCatalog): Promise<OfficialNcmCatalog> => {
    const syncedAt = await replaceOfficialNcmSnapshot(pool, catalog);
    cached = { catalog: { ...catalog, syncedAt }, syncedAt };
    checkedAt = Date.now();
    return cached.catalog;
  };

  const readSnapshot = async (): Promise<OfficialNcmCatalog | null> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const metadata = await client.query<SnapshotMetadata>(
        `SELECT catalog_source,source_reference,source_updated_at::text AS source_updated_at, attributes_source_version,
                item_count, synced_at
         FROM catalog.ncm_official_snapshot WHERE snapshot_id=1`);
      const row = metadata.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      const syncedAt = timestamp(row.synced_at);
      if (cached?.syncedAt === syncedAt) {
        await client.query("COMMIT");
        return cached.catalog;
      }

      const result = await client.query<SnapshotItem>(
        `SELECT code,name,valid_from::text AS valid_from,valid_to::text AS valid_to,
                mandatory_import_attributes
         FROM catalog.ncm_official_item ORDER BY code`);
      if (result.rows.length !== Number(row.item_count)) {
        throw new Error("A cópia persistida do catálogo NCM está incompleta.");
      }
      const catalog: OfficialNcmCatalog = {
        source: row.catalog_source,
        sourceReference: row.source_reference,
        sourceUpdatedAt: row.source_updated_at,
        attributesVersion: row.attributes_source_version,
        syncedAt,
        verifiedComplete: result.rows.length >= 9_000,
        items: result.rows.map(item => ({
          code: item.code,
          name: item.name,
          validFrom: item.valid_from,
          validTo: item.valid_to,
          mandatoryImportAttributes: item.mandatory_import_attributes,
        })),
      };
      await client.query("COMMIT");
      cached = { catalog, syncedAt };
      return catalog;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  const loadPersistedOrFetch = async (): Promise<OfficialNcmCatalog> => {
    if (cached && Date.now() - checkedAt < SNAPSHOT_CHECK_INTERVAL_MS) return cached.catalog;
    let snapshot: OfficialNcmCatalog | null;
    try {
      snapshot = await readSnapshot();
    } catch (error) {
      if (!cached) throw error;
      checkedAt = Date.now();
      return cached.catalog;
    }
    if (snapshot) {
      checkedAt = Date.now();
      return snapshot;
    }
    return persist(await upstream());
  };

  const refreshFromOfficialSources = async (): Promise<OfficialNcmCatalog> => {
    const latest = await upstream({ forceRefresh: true });
    return persist(latest);
  };

  return async requestOptions => {
    if (requestOptions?.forceRefresh) return refreshFromOfficialSources();
    if (loading) return loading;
    loading = loadPersistedOrFetch().finally(() => { loading = null; });
    return loading;
  };
}
