import { randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { Pool } from "pg";
import { generateTemporaryPassword, hashPassword } from "./password.js";

if (process.env.ALLOW_MASTER_BOOTSTRAP !== "true") {
  throw new Error("Bootstrap requer ALLOW_MASTER_BOOTSTRAP=true.");
}
const databaseUrl = process.env.MIGRATION_DATABASE_URL;
const outputPath = process.env.MASTER_CREDENTIAL_OUTPUT;
const emails = (process.env.MASTER_EMAILS ?? "").split(",")
  .map((email) => email.trim().toLowerCase()).filter(Boolean);
if (!databaseUrl || !outputPath || !outputPath.startsWith("/root/.config/import-erp/")
  || emails.length !== 2 || new Set(emails).size !== 2
  || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))) {
  throw new Error("Informe duas contas master, MIGRATION_DATABASE_URL e um arquivo de saída em /root/.config/import-erp/.");
}
const target = new URL(databaseUrl);
if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(target.hostname)
  || target.pathname !== "/erp_po_totvs_test") {
  throw new Error("Bootstrap limitado ao banco operacional local da VPS.");
}

const credentials = await Promise.all(emails.map(async (email) => {
  const password = generateTemporaryPassword();
  return { email, password, hash: await hashPassword(password) };
}));
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
let fileCreated = false;
let completed = false;
try {
  const file = await open(outputPath, "wx", 0o600);
  fileCreated = true;
  try {
    await file.writeFile(credentials.map(({ email, password }) => `${email}: ${password}`).join("\n") + "\n");
  } finally {
    await file.close();
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(731942063)");
    const existing = await client.query(
      "SELECT 1 FROM identity.erp_user_role WHERE role = 'Master' LIMIT 1",
    );
    if (existing.rowCount) throw new Error("Já existe usuário master; bootstrap recusado.");
    for (const credential of credentials) {
      const id = randomUUID();
      const displayName = credential.email.split("@", 1)[0]!
        .split(/[._-]/u).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
      await client.query(
        `INSERT INTO identity.erp_user (id, issuer, subject, display_name, is_active)
         VALUES ($1, 'urn:import-erp:local', $2, $3, true)`,
        [id, credential.email, displayName],
      );
      await client.query(
        `INSERT INTO identity.local_credential (user_id, email, password_hash)
         VALUES ($1, $2, $3)`, [id, credential.email, credential.hash],
      );
      await client.query("INSERT INTO identity.erp_user_role (user_id, role) VALUES ($1, 'Master')", [id]);
      await client.query(
        `INSERT INTO identity.user_admin_event (id, target_user_id, action)
         VALUES ($1, $2, 'bootstrap')`, [randomUUID(), id],
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
  if (fileCreated && !completed) await unlink(outputPath);
  await pool.end();
}
console.log(`Duas contas master criadas. Senhas iniciais em ${outputPath} (modo 0600).`);
