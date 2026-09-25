import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL não configurada.");

const mode = process.argv[2] ?? "status";
if (mode !== "status" && mode !== "up") {
  throw new Error("Uso: node dist/migrate.js [status|up]");
}

const parsedUrl = new URL(databaseUrl);
const isLocal = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(parsedUrl.hostname);
const environment = process.env.MIGRATION_ENV ?? "isolated";
if (environment === "production") {
  if (!process.env.MIGRATION_DATABASE_URL) {
    throw new Error("Migrações de produção exigem a credencial dedicada MIGRATION_DATABASE_URL.");
  }
  if (process.env.ALLOW_PRODUCTION_MIGRATIONS !== "true") {
    throw new Error("Migrações de produção exigem ALLOW_PRODUCTION_MIGRATIONS=true após backup restaurável.");
  }
}
if (environment !== "production" && !isLocal && process.env.ALLOW_REMOTE_MIGRATIONS !== "true") {
  throw new Error("Banco remoto exige ALLOW_REMOTE_MIGRATIONS=true e deve ser isolado/teste.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5_000,
  application_name: "import-erp-migrations",
});

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrationFilePattern = /^M(\d{3})_[a-z0-9_]+\.sql$/;
const lockKey = "731942061";

type Migration = { name: string; sql: string; checksum: string };

async function loadMigrations(): Promise<Migration[]> {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => migrationFilePattern.test(name))
    .sort();

  return Promise.all(names.map(async (name) => {
    // Canonicalize line endings so Windows and Linux checkouts hash the same SQL.
    const sql = (await readFile(join(migrationsDirectory, name), "utf8")).replace(/\r\n?/g, "\n");
    return {
      name,
      sql,
      checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
    };
  }));
}

async function readApplied(client: PoolClient, createLedger: boolean): Promise<Map<string, string>> {
  if (createLedger) {
    await client.query("CREATE SCHEMA IF NOT EXISTS migration");
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration.schema_migration (
        version varchar(128) PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  } else {
    const exists = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('migration.schema_migration') IS NOT NULL AS exists",
    );
    if (!exists.rows[0]?.exists) return new Map();
  }
  const result = await client.query<{ version: string; checksum: string }>(
    "SELECT version, checksum FROM migration.schema_migration ORDER BY version",
  );
  return new Map(result.rows.map((row) => [row.version, row.checksum.trim()]));
}

async function run(): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [lockKey]);
    locked = true;

    const migrations = await loadMigrations();
    const applied = await readApplied(client, mode === "up");
    const knownNames = new Set(migrations.map((migration) => migration.name));
    const unknownApplied = [...applied.keys()].filter((name) => !knownNames.has(name));
    if (unknownApplied.length > 0) {
      throw new Error(`Ledger contém migrations ausentes do repositório: ${unknownApplied.join(", ")}`);
    }
    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.name);
      if (existingChecksum && existingChecksum !== migration.checksum) {
        throw new Error(`Checksum divergente para ${migration.name}; não edite uma migração aplicada.`);
      }
    }

    const pending = migrations.filter((migration) => !applied.has(migration.name));
    if (mode === "status") {
      console.log(`Migrations: ${applied.size} aplicadas, ${pending.length} pendentes.`);
      for (const migration of migrations) {
        console.log(`${applied.has(migration.name) ? "aplicada" : "pendente"}  ${migration.name}`);
      }
      return;
    }

    for (const migration of pending) {
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO migration.schema_migration (version, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        console.log(`Aplicada ${migration.name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    console.log(`Concluído: ${pending.length} migration(s) aplicada(s).`);
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1::bigint)", [lockKey]);
    client.release();
    await pool.end();
  }
}

await run();
