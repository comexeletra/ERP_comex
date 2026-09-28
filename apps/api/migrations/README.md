# PostgreSQL migrations

These PostgreSQL migrations are applied by the explicit Node migration runner.
`M002` is the PostgreSQL counterpart for quality-review records. Each file is
applied in its own transaction and recorded with a SHA-256 checksum in
`migration.schema_migration`; an applied file whose checksum changes stops the
runner. Line endings are normalized to LF before hashing and execution, so a
Windows checkout and Linux release produce the same checksum. A PostgreSQL
advisory lock prevents two runners from applying at once.
`M007` adds short-lived OIDC login transactions and hashed server-side sessions.

The API never runs migrations at startup. From `apps/api`, build the API, then
set `MIGRATION_ENV=isolated` in the shell or `.env` before running
`pnpm migrate:status` to inspect the target without creating the ledger. For a
disposable or isolated database, `pnpm migrate:up` applies pending migrations.
The CLI reads `apps/api/.env` if present. Every migration command requires an
explicit `MIGRATION_ENV=isolated` or `MIGRATION_ENV=production`. Remote isolated
test targets also require `ALLOW_REMOTE_MIGRATIONS=true`; production additionally requires a dedicated
`MIGRATION_DATABASE_URL` and
`ALLOW_PRODUCTION_MIGRATIONS=true`. Production approval, a verified restorable
backup, and a reviewed release remain required.
Never point the runner at the operational database as a development shortcut.

## First administrator

`pnpm bootstrap:admin` is a separate, manual, one-time command. It requires
`ALLOW_ADMIN_BOOTSTRAP=true`, `ADMIN_BOOTSTRAP_DATABASE_URL` for a PostgreSQL
listener on localhost, the exact `OIDC_ISSUER` and `ADMIN_BOOTSTRAP_SUBJECT`, a
display name, and a comma-separated list of importer scopes. Migrations M003
and later must already be applied. The command creates only the specified
identity with role `Administrador` and the listed scopes; it refuses to run if
an administrator or that identity already exists. Remove the temporary opt-in
and bootstrap credential after use. Never put bootstrap settings in the
persistent API service environment.

The old SQLite migrations and .NET runner were removed with the retired local
architecture. Historical validation results remain in
`CHECKLIST_IMPLEMENTACAO.md`; they do not imply that the Node API has feature
parity. On 2026-09-25, the runner was exercised against the isolated VPS test
database: status reported 0 applied/7 pending, `migrate:up` applied all seven,
the next status reported 7 applied/0 pending, and reapplication applied zero.
Checksum tampering, concurrent execution, upgrades, and production TLS still
require validation before DEV05 acceptance.
