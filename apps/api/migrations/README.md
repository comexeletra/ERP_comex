# PostgreSQL migrations

These PostgreSQL migrations are applied by the explicit Node migration runner.
`M002` is the PostgreSQL counterpart for quality-review records. Each file is
applied in its own transaction and recorded with a SHA-256 checksum in
`migration.schema_migration`; an applied file whose checksum changes stops the
runner. Line endings are normalized to LF before hashing and execution, so a
Windows checkout and Linux release produce the same checksum. A PostgreSQL
advisory lock prevents two runners from applying at once.

The API never runs migrations at startup. From `apps/api`, run `pnpm build`,
then `pnpm migrate:status` to inspect the target database without creating the
ledger. For a disposable or isolated database, `pnpm migrate:up` applies
pending migrations. The CLI reads `apps/api/.env` if present. Remote isolated
test targets require `ALLOW_REMOTE_MIGRATIONS=true`; production additionally requires a
dedicated `MIGRATION_DATABASE_URL`, `MIGRATION_ENV=production`, and
`ALLOW_PRODUCTION_MIGRATIONS=true`. Production approval, a verified restorable
backup, and a reviewed release remain required.
Never point the runner at the operational database as a development shortcut.

The old SQLite migrations and .NET runner were removed with the retired local
architecture. Historical validation results remain in
`CHECKLIST_IMPLEMENTACAO.md`; they do not imply that the Node API has feature
parity. The runner has not yet been exercised against a PostgreSQL instance;
that remains a required validation before the DEV05 acceptance criteria pass.
