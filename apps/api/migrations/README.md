# PostgreSQL migrations

These PostgreSQL migrations are applied by the explicit Node migration runner.
`M018_operational_po_ip.sql` adds manually transcribed PO items and quantitative
allocations to IPs, plus editable operational header fields. It preserves the
historical Excel observations and PO–IP links. A row-locking trigger enforces
same-importer links and prevents allocation totals from exceeding the item's
entered quantity. M018 passed restored-copy validation and was published to
the VPS after a verified operational backup; see
`docs/PRIMEIRO_FLUXO_OPERACIONAL_PO_IP.md`.
`M019_followup_operational.sql` and `M020_process_document_amount.sql` add typed
item and IP follow-up fields, individual Invoice/BL/NF records and their input
constraints. The API derives spreadsheet-style calculations on read rather
than storing formula results. See `docs/ACOMPANHAMENTO_CALCULOS_PO.md` for the
field map and rules. Run both migrations together before starting the new API.
M019–M020 passed a restored-copy test and were applied to the operational VPS
database on 2026-10-04, after a verified backup. The ledger is 20/20; release
evidence and rollback paths are in `deploy/hostinger/README.md`.
`M021_operational_selectors.sql` adds the selectable-value entities used by
PO/IP forms, seeds their initial values from workbook source columns, and adds
the PO-item product group. Apply it before deploying the UI/API changes. Values
are administered in `/catalog/values`; product and supplier selectors include
source observations and reviewed active entries, which remain managed in
`/catalog`.
`M022_purchase_order_ip_event_history.sql` exposes filtered, read-only views of
the immutable PO/allocation and IP/document audit events. The follow-up handler
checks importer scope before reading them and renders the split history with
each IP's own dates and quantities. M022 was released on 2026-10-06 with M023
and M024; see `deploy/hostinger/README.md` for validation and release evidence.
`deploy/hostinger/validate-m022-on-copy.py` is the acceptance gate: it backs up
the operational database, restores a disposable copy, applies M022, checks the
history-view grants, then runs both `operations.integration.mjs` and
`followup.integration.mjs`. The integration contract covers one PO item split
across two IPs with independent invoice quantities, ETAs and delivery dates,
an IP shared by multiple POs, quantity limits, concurrent allocations, edits,
cancellation and event history. It drops only the disposable restored copy.
`M023_process_closure.sql` adds an explicit open/closed lifecycle to each IP,
separate from its logistics status. The analyst can close or reopen an IP with
a reason regardless of its logistics stage. Closed IPs remain visible, and
their operational data and allocations are read-only until reopened. M023 was
validated on a restored copy and applied to the operational database on
2026-10-06 as part of the M022–M024 release; see `deploy/hostinger/README.md`.

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

`M010` creates the reviewed operational catalog for supplier, product and NCM
entries, literal aliases and actor-scoped command receipts. It does not seed
official data from the historical workbook. The migration conditionally grants
the existing `import_erp_app` runtime role only the required catalog permissions;
an empty CI database can apply it before that role is provisioned. On
2026-10-01, `deploy/hostinger/validate-m010-on-copy.py` created a verified
backup, restored an isolated copy, applied M010 there and passed the real
PostgreSQL route checks. M010 was then applied to the selected operational
database after another restored backup. The operational ledger is M001–M010,
with zero pending migrations.

`M011_native_requests.sql` adds native request headers and requester-described
items, a server-number sequence, actor-scoped idempotency receipts, and the
least-privilege grants for the API role. Native records carry `source_kind` and
do not derive from historical rows. The request handler writes request/items,
audit and outbox in one transaction. Purpose/cost center are preserved only as
requester-entered text; quantity, unit, official product and workflow remain
pending business confirmation. On 2026-10-01 M011 was applied after a protected
backup and restored-copy validation; the operational ledger is M001–M011 with
zero pending migrations.

`M012_native_request_editing.sql` grants the API role `UPDATE` and `DELETE` on
native request items so the versioned edit command can maintain existing items
and remove those omitted from the submitted replacement. Request edits remain
limited in the API to `SUBMITTED` records in the caller's importer scope and
use `If-Match`; status transitions are not part of this migration or command.
On 2026-10-02 M012 passed migration and runtime UPDATE/DELETE privilege checks
on a temporary restored database, then was applied to the operational database.
The pre-release verified backup is
`/var/backups/import-erp/erp_po_totvs_test_20261002T190606Z.dump` (SHA-256
`78232483deb7f06038c008b12577ae232eb7bbc05772b6c08374645c8bb2fdde`). The
operational ledger is M001-M012 with zero pending migrations. The API release
passed readiness and anonymous-route checks; its code rollback copy is
`/var/backups/import-erp/m012-api-20261002T190614Z`. Commit `26ae538` was
published to `comexeletra/ERP_comex`; Vercel deployment
`dpl_35azfjEXCUmqmBgV9AmHDnHXckx5` reached `READY` and serves the
`fup-comex-eletra.vercel.app` alias.

`M013_request_history_read.sql` exposes a read-only view of native request audit
events to the API role. The request-history handler verifies importer scope before
querying it. On 2026-10-02, M013 passed on a restored copy after a verified
backup, then was applied to the operational database. The ledger records M001–M013
with zero pending migrations. The API code was installed after a controlled
retry of the health check; see `deploy/hostinger/README.md` for evidence.

`M014_outbox_monitor.sql` adds a metadata-only view for the Master outbox
monitor. It grants no access to event payloads or error text. On 2026-10-02,
M014 passed on a restored copy after a verified backup and was applied to the
operational database. The runtime role successfully read the view; the ledger
records M001–M014 with zero pending migrations.

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

`M015_excel_error_columns.sql` restores the Excel calculation-error column
markers in `migration.source_row` from immutable `EXCEL_CELL_ERROR` issue
records without changing preserved raw values. The migration and importer
update passed restored-copy validation before release. The operational verifier
confirmed 15 migrations, 277 marked source rows, and 306 marked cells, matching
the 306 immutable issue records.

`M016_import_batch_snapshot_read.sql` grants the API role access only to the
promoted batch identifier and timestamp used by the PO portfolio snapshot label.
`M017_catalog_entry_history.sql` exposes catalog audit events through a filtered
read-only view; the API checks that the entry is visible in the caller's importer
scope before reading its paginated history. These migrations are versioned in
the checkout. On 2026-10-03, both passed validation on an isolated restored copy
after a verified backup, then were applied to the operational database. The
ledger is M001–M017; the API release preserved the prior code for rollback. The
runtime role was verified to read the history view without direct SELECT on the
audit table.

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

`M025_allocation_factory_ship_date.sql` stores factory departure per PO-item allocation. A PO item split across IPs can have different factory departure dates; existing item-level dates stay unchanged and are never copied automatically to each IP. Apply M025 before deploying the API/UI changes that read and edit this allocation date.

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
`M024_ip_specific_port_departure.sql` stores actual port departure on the IP,
so a PO item split over different IPs can carry independent actual departure,
ETD, ETA, BL, arrival, and delivery dates. Existing PO-item departure values
are retained and are not copied to IPs automatically because one source date
cannot safely identify multiple shipment dates.
M024 passed restored-copy validation and was applied with M022 and M023 to the
operational database on 2026-10-06. The ledger is 24/24; backup, API health and
rollback details are recorded in `deploy/hostinger/README.md`.
