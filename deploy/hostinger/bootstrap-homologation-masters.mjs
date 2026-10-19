#!/usr/bin/env node
// Add isolated local Master accounts to the empty homologation database.
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink, chmod } from "node:fs/promises";
import pg from "/opt/import-erp/apps/api/node_modules/pg/lib/index.js";
import { generateTemporaryPassword, hashPassword } from "/opt/import-erp/apps/api/dist/password.js";

const { Pool } = pg;
const migrationEnv = await readFile("/etc/import-erp/migration-release.env", "utf8");
const connection = migrationEnv.match(/^MIGRATION_DATABASE_URL=(.+)$/mu)?.[1];
const databaseUrl = connection ? new URL(connection) : null;
if (!databaseUrl || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseUrl.hostname)) {
  throw new Error("Migration URL must point to the local PostgreSQL server.");
}
databaseUrl.pathname = "/erp_po_totvs_hml";

const emails = (process.env.HOMOLOGATION_MASTER_EMAILS
  ?? "francisco.matheus@eletraenergy.com.br,ricardo.rodrigues@eletraenergy.com")
  .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
if (emails.length !== 2 || new Set(emails).size !== 2
  || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))) {
  throw new Error("Supply exactly two distinct HOMOLOGATION_MASTER_EMAILS.");
}

const outputPath = "/root/.config/import-erp/homologation-master-credentials.txt";
const credentials = await Promise.all(emails.map(async (email) => {
  const password = generateTemporaryPassword();
  return { email, password, hash: await hashPassword(password) };
}));

await mkdir("/root/.config/import-erp", { recursive: true, mode: 0o700 });
await chmod("/root/.config/import-erp", 0o700);
const output = await open(outputPath, "wx", 0o600);
let completed = false;
const pool = new Pool({ connectionString: databaseUrl.toString(), max: 1 });
try {
  await output.writeFile(credentials.map(({ email, password }) => `${email}: ${password}`).join("\n") + "\n");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(731942063)");
    const existing = await client.query("SELECT 1 FROM identity.erp_user_role WHERE role = 'Master' LIMIT 1");
    if (existing.rowCount) throw new Error("A homologation Master already exists; bootstrap refused.");
    for (const credential of credentials) {
      const id = randomUUID();
      const displayName = credential.email.split("@", 1)[0]
        .split(/[._-]/u).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
      await client.query(
        `INSERT INTO identity.erp_user (id, issuer, subject, display_name, is_active)
         VALUES ($1, 'urn:import-erp:local', $2, $3, true)`,
        [id, credential.email, displayName],
      );
      await client.query(
        "INSERT INTO identity.local_credential (user_id, email, password_hash) VALUES ($1, $2, $3)",
        [id, credential.email, credential.hash],
      );
      await client.query("INSERT INTO identity.erp_user_role (user_id, role) VALUES ($1, 'Master')", [id]);
      await client.query(
        "INSERT INTO identity.user_admin_event (id, target_user_id, action) VALUES ($1, $2, 'bootstrap')",
        [randomUUID(), id],
      );
    }
    await client.query("COMMIT");
    completed = true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await output.close();
  if (!completed) await unlink(outputPath);
  await pool.end();
}
console.log(`Two isolated Master accounts created. Initial passwords are stored in ${outputPath} (0600).`);
