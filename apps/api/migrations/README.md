# PostgreSQL migrations

These PostgreSQL migrations are applied by the explicit Node migration runner.
`M002` is the PostgreSQL counterpart for quality-review records. Each file is
applied in its own transaction and recorded with a SHA-256 checksum in
`migration.schema_migration`; an applied file whose checksum changes stops the
runner. Line endings are normalized to LF before hashing and execution, so a
Windows checkout and Linux release produce the same checksum. A PostgreSQL
advisory lock prevents two runners from applying at once.
`M007` adds short-lived OIDC login transactions and hashed server-side sessions.
`M008` adds per-issue resolution evidence and actor-scoped idempotency to quality
reviews. It is required by the Node `/api/v1/data-issues` routes. On 2026-09-29,
the user selected `erp_po_totvs_test` as the operational database. A restorable
backup was verified, M008 was applied to a temporary restored copy, and then
M008 was applied to that operational database. Its ledger now has M001–M008
applied and zero pending.

Local DEV12 review on 2026-09-29 confirmed the M008 dependencies and route
contracts, and 6 handler tests passed for scope, 401/403/404, idempotent replay
and conflict, session actor, and a simulated outbox failure. M008 execution was
also verified against the restored PostgreSQL copy before the operational
upgrade. The Vercel deployment was later confirmed ready. OIDC remains a future
integration; local accounts provide the initial production login.

`M009` adds local password credentials and administrative audit events. The two
initial Master accounts were created on the VPS with random passwords kept in a
root-only file. Only Master can provision other accounts; importer scopes and
roles are assigned per user. Local login, forced password change, account
creation, role isolation and session revocation passed against a restored VPS
database copy before M009 was applied to the operational database. The ledger
now has M001–M009 applied and zero pending. OIDC is optional for a future phase.

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

## Initial Master accounts

`bootstrap:masters` is a one-time VPS command after M009. It requires the
dedicated migration credential, `ALLOW_MASTER_BOOTSTRAP=true`, exactly two
`MASTER_EMAILS`, and a root-only `MASTER_CREDENTIAL_OUTPUT` path under
`/root/.config/import-erp/`. It refuses to run if any Master exists and prints
only the path to the initial passwords. Both Masters must change their password
at first login. Remove the file after both have done so.

## Future OIDC administrator

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
On 2026-09-28, checksum tampering was rejected and restored, and a temporary
probe migration was applied once by two concurrent runners (the second applied
zero); the probe table and ledger row were then removed, returning the isolated
database to M001–M007 applied/zero pending. Those checks do not validate TLS or
CI. The product migration M008 was applied later, on 2026-09-29, after backup
and verification against a restored copy.
