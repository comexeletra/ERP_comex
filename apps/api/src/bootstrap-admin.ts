import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.ADMIN_BOOTSTRAP_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("ADMIN_BOOTSTRAP_DATABASE_URL deve apontar para uma credencial temporária de provisionamento.");
}
if (process.env.ALLOW_ADMIN_BOOTSTRAP !== "true") {
  throw new Error("Defina ALLOW_ADMIN_BOOTSTRAP=true para autorizar o bootstrap manual.");
}

const issuer = process.env.OIDC_ISSUER;
const subject = process.env.ADMIN_BOOTSTRAP_SUBJECT;
const displayName = process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME?.trim();
const importerCodes = [...new Set(
  (process.env.ADMIN_BOOTSTRAP_IMPORTERS ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean),
)];

if (!issuer || !subject || !displayName || importerCodes.length === 0) {
  throw new Error("Informe OIDC_ISSUER, ADMIN_BOOTSTRAP_SUBJECT, ADMIN_BOOTSTRAP_DISPLAY_NAME e ADMIN_BOOTSTRAP_IMPORTERS.");
}
if (displayName.length > 200 || subject.length > 500) {
  throw new Error("Nome de exibição ou subject excede o limite permitido.");
}
if (importerCodes.some((code) => code.length > 120 || /[\u0000-\u001f\u007f]/u.test(code))) {
  throw new Error("Cada código de importador deve ter até 120 caracteres imprimíveis.");
}

const issuerUrl = new URL(issuer);
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
if (issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash
  || (issuerUrl.protocol !== "https:" && !localHosts.has(issuerUrl.hostname))) {
  throw new Error("OIDC_ISSUER deve ser HTTPS, sem credenciais, query ou fragmento; HTTP só é aceito em localhost.");
}

const databaseUrlParsed = new URL(databaseUrl);
if (!new Set(["postgres:", "postgresql:"]).has(databaseUrlParsed.protocol)
  || !localHosts.has(databaseUrlParsed.hostname)) {
  throw new Error("O bootstrap só pode conectar ao PostgreSQL local da máquina de implantação.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5_000,
  application_name: "import-erp-admin-bootstrap",
});

const adminRole = "Administrador";
const lockKey = "731942062";

async function bootstrapAdmin(): Promise<void> {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [lockKey]);

    const existingAdmin = await client.query(
      "SELECT 1 FROM identity.erp_user_role WHERE role = $1 LIMIT 1",
      [adminRole],
    );
    if (existingAdmin.rowCount) {
      throw new Error("Já existe um usuário Administrador; o bootstrap inicial foi recusado.");
    }

    const existingIdentity = await client.query(
      "SELECT 1 FROM identity.erp_user WHERE issuer = $1 AND subject = $2 LIMIT 1",
      [issuer, subject],
    );
    if (existingIdentity.rowCount) {
      throw new Error("A identidade OIDC já existe; o bootstrap não altera contas existentes.");
    }

    const userId = randomUUID();
    await client.query(
      `INSERT INTO identity.erp_user (id, issuer, subject, display_name, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [userId, issuer, subject, displayName],
    );
    await client.query(
      "INSERT INTO identity.erp_user_role (user_id, role) VALUES ($1, $2)",
      [userId, adminRole],
    );
    await client.query(
      `INSERT INTO identity.erp_user_importer_scope (user_id, importer_code)
       SELECT $1, importer.code FROM unnest($2::text[]) AS importer(code)`,
      [userId, importerCodes],
    );

    await client.query("COMMIT");
    transactionStarted = false;
    console.log(`Administrador inicial provisionado com ${importerCodes.length} escopo(s) de importador.`);
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await bootstrapAdmin();
