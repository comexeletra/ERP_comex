# PostgreSQL migrations

Every ERP database must receive the migrations required by the code deployed to
it. As of 2026-10-21, `erp_po_totvs_test` and
`erp_po_totvs_gatewayflow_20261010_test` are at M001–M034, while
`erp_po_totvs_hml` is at M001–M070 (2026-10-26). HML contains business data and is no longer
empty; the 2026-10-15 setup below records its initial state. See
`deploy/hostinger/README.md` for M063 backup and validation evidence.

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
`M028_operational_reference_values.sql` extends the selectable catalog with
priority, unit of measure, requester, cost center, broker, and forwarder. It
seeds distinct values already recorded on PO items and import processes, while
keeping those operational fields unchanged. Validate it on a restored database
copy before applying it to an operational database.
`M029_pcm_purchase_requests.sql` adds the PCM SC register and an optional,
importer-matched SC link on each PO. Plan receipt date, requester, and approval
date are stored in the corresponding operational PO-item fields when the SC is
selected; legacy item-level SC values remain untouched. Apply M029 before
deploying the PCM and PO form changes.
`M030_purchase_request_date.sql` adds the SC issue date to the PCM record and
the corresponding PO-item operation field. Apply M030 before deploying the
updated API and PCM/PO forms.
`M031_group_operational_value.sql` adds `Group` as an independent selectable
value entity in `/catalog/values`, seeded with Energy, Livoltek, Recloser and
Water. Apply M031 before deploying the API change that accepts values for this entity.
`M032_export_jobs.sql` adds a durable queue for purchase-order exports.
Jobs are private to the requesting user and importer scopes, expire after
completion or terminal failure, and are claimed by the separate export worker.
Apply M032 before deploying the API and worker that use `jobs.export_job`.
`M033_open_data_issue_source.sql` indexes open data issues by source row for the
historical-sheet audit query. It supports fast existence checks across the
filtered dataset and loads issue evidence only for the current page.
`M034_export_jobs_xlsx.sql` adds binary storage for generated Excel workbooks.
Apply M034 before deploying the API and worker that generate `.xlsx` exports.
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

`M025_allocation_factory_ship_date.sql` stores factory departure per PO-item allocation. A PO item split across IPs can have different factory departure dates; existing item-level dates stay unchanged and are never copied automatically to each IP. The migration must precede any API/UI version that reads and edits this allocation date.
M025 passed restored-copy validation and was applied to the operational VPS database on 2026-10-06. Source-row counts and active allocation count/quantity were unchanged; operations and follow-up PostgreSQL integration tests passed. The ledger is 25/25. Release validation and API health evidence are recorded in `deploy/hostinger/README.md`.

`M026_source_observations_as_po_items.sql` promotes each PO line to an item, retaining its quantity and source status. It assigns quantity only to a matching linked IP; canceled lines and lines without a linked IP remain unallocated, and canceled items cannot be distributed. Imported items keep a link to their original immutable record. Validate M026 on a restored copy before deploying the matching API/UI.

`M027_operationalize_historical_workbook.sql` promotes unambiguous historical Pre/Post values into empty operational PO, item, and IP fields and creates active IP-level invoice, BL, and NF records. Post logistics values stay on their matching IP; Pre item fields stay with the source PO line. A PO item split over IPs does not copy or share IP dates. Existing operational values win. Conflicting repeated values are left unfilled and recorded as `IP_SOURCE_CONFLICT` or `PO_SOURCE_CONFLICT` issues. Invoice total and currency are retained in the document notes because the current document model has no total-amount field. Validate M027 on a restored copy before deployment.

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

`M040_purchase_request_supplier.sql` adds supplier to the SC and IP records.
Selecting an SC makes its supplier authoritative on the linked PO. Invoice
imports set the IP supplier from the invoice Exporter and validate it against
the supplier code/name on every allocated PO. Active allocations prevent later
supplier changes that would break the match. Validate M040 on an isolated
restored database before deploying the matching API/UI.

`M063_purchase_order_lifecycle.sql` adds the PO states ACTIVE, CANCELLED,
CLOSED, and DELETED. Cancellation and logical deletion require active
allocations to be resolved first. Closing preserves the existing allocations
and remaining balance while freezing PO, item, and allocation changes; a
closed PO can be reopened with a reason. DELETED POs remain in history and are
excluded from the active portfolio and its export. Validate this migration on
an isolated restored database and apply it to HML before deploying the matching
API/UI.

`M064_purchase_order_lifecycle_restore.sql` permits only the planned transitions from CANCELLED or DELETED back to ACTIVE and clears lifecycle metadata on return to ACTIVE. On 2026-10-21, it passed a restored-copy transaction/rollback check and was applied only to `erp_po_totvs_hml`; the ledger is M001–M064. The Cycle 2 API workflow was exercised against the existing HML test PO with audit/outbox verification and unchanged PO counts. Production was not changed; release, backup, and rollback evidence is in `deploy/hostinger/README.md`.

`M066_purchase_request_delete.sql` grants `DELETE` on `procurement.purchase_request` to the application roles when present. It also updates the PO business-field trigger to allow exactly one exception on a `DELETED` PO: clearing a non-null `purchase_request_id` while every other business field remains unchanged. The M063 immutability rule remains in force for all other edits. On 2026-10-21, M066 passed `deploy/hostinger/validate-m066-on-copy.sql` on restored copy `erp_po_hml_m066_copy_20261022001454` and was applied only to `erp_po_totvs_hml`. The ledger is M001–M066; the SHA-256 is `17300c5eb50f6a6e5bc3388f3e0d6182a67cc7be343dad641c60eeea8160c433`. The pre-migration backup and release checks are in `deploy/hostinger/README.md`. Production was not changed.

`M067_import_process_lifecycle.sql` adds the IP `DELETED` state and its four soft-delete metadata fields. Its metadata constraint requires the full snapshot only while the IP is deleted; the status trigger allows only the specified draft, active, cancelled, delete, and restore transitions, and prevents deletion while active allocations, documents, or linked POs remain. Reactivation requires an open IP with no logistics status and no linked POs. Validate M067 on a restored copy and apply it only to HML after backup, before releasing the matching API.

`M068_ip_bill_of_lading_fields.sql` adds `bl_number` and `bl_date` to the IP. An IP is one shipment, so the BL is typed on the IP beside ETD/ETA and every PO item allocated to it reads the same values. The migration refuses to run while any IP has more than one active BL with different numbers or dates; otherwise it copies the active BL number and date only into empty IP fields and records a `HISTORICAL_BACKFILL` audit row per IP. BL documents are not changed and remain as history; the API stops creating or editing BL documents. On 2026-10-22, the operational database had 190 active BLs, none sharing an IP. On 2026-10-23, M068 passed restored-copy checks and was applied only to `erp_po_totvs_hml`; the ledger is M001–M068 and the SHA-256 is `e254213045a7af05748afda34b9e1adecc4954e0e9d3503a9499387ff9aabbf5`. Backup and release evidence is in `deploy/hostinger/README.md`. Production was not changed.

`M069_purchase_order_item_demand_type.sql` adds the `DEMAND_TYPE` operational list, seeded with `MTS` and `Não MTS`, and the PO item column `demand_type`. The demand type sets the HQ production lead time planned by the end-to-end analysis (MTS 30 days, Não MTS 45 days). It is separate from `DEMAND`, which keeps recording where the demand came from (commercial plan, after sales, projects); no existing value is changed. Apply M069 only to HML, after backup, before releasing the API that reads and writes `demandType`. On 2026-10-26, M069 passed a restored-copy check and was applied only to `erp_po_totvs_hml` with SHA-256 `dfb58f9bfe5142e31981863ac69d58e97a05045f316dcef0a33253d738c8a05f`; the ledger is M001–M069. Evidence is in `deploy/hostinger/README.md`. Production was not changed.

`M070_e2e_target_sets.sql` creates `catalog.e2e_target_set`, the End to End target days kept by the administrator (T0, T1, T2, T3 MTS / Não MTS, T4 SEA / AIR, T5). Each set applies to the product lines whose necessity date is on or after `valid_from` until the next set starts; lines without a necessity date use the set in force today. It is seeded with one set valid from 2000-01-01: 8, 8, 7, 30/45, 55/10, 10. Sets are created and edited only through the API (`e2e-targets.manage`, Master and Administrador), with a reason, audit and outbox; they are never deleted. Apply M070 only to HML, after backup, before releasing the API that reads the sets.

`M071_purchase_order_demand_type.sql` moves the demand type (MTS / Não MTS) from the PO item to the PO: the HQ plans a whole order from stock or to order, so `procurement.purchase_order.demand_type` is the only place it is kept and every product of the PO inherits it in the follow-up, the product lines, the End to End and the exports. Before dropping `purchase_order_item.demand_type`, it copies to each active PO the type its typed products agree on; a PO with mixed types stays without a type (cancelled and deleted POs are frozen by M063 and are not updated). The `DEMAND_TYPE` list and the demand origin (`DEMAND`) do not change. Apply M071 only to HML, after backup, together with the API that reads and writes the PO `demandType`; the previous API still reads the product column and fails after M071.

`M072_ncm_tax_rates.sql` creates the II, IPI and PIS/COFINS rate tables, apart from the NCM nomenclature tables and the TTCE cache: `catalog.ncm_rate_version` (one retained version per downloaded official file, with SHA-256; one current version per source), `ncm_ii_rate` (TEC, Annex I, and Brazilian rate, Annex II, of Gecex Resolution 272/2021), `ncm_ii_exception` (Annexes III–X with Ex, quota and validity), `ncm_ipi_rate` (TIPI, with NT kept apart from zero), `ncm_rate_source_state`, `pis_cofins_general_rate` (seeded with 2.10% / 9.65% from 2015-05-01, Law 10,865/2004 art. 8 as amended by Law 13,137/2015) and `ncm_pis_cofins_exception` (kept by Master, Administrador and Fiscal through the API, with audit and outbox; overlapping periods are refused by the API). It only creates tables. On 2026-10-28 it was rehearsed with ROLLBACK and applied only to `erp_po_totvs_hml` with SHA-256 `75772b63dd1249f148bdeefe8517c737cb683b4f23e730e6ae4d53be15f2ba80`; the ledger is M001–M072. Evidence is in `deploy/hostinger/README.md`. Production was not changed.

`M073_icms_import_rates.sql` creates the ICMS on imports for the states of the Eletra importers (CE, AM, PR): `catalog.icms_import_state` (expenses included in the base and review flag), `icms_import_rate` (internal rate and FCP per period, seeded unreviewed with PR 19.5%, CE 20% and AM 20%), `icms_import_benefit` (base reduction or deferral per state, for one NCM or all) and `icms_importer_state` (state of each importer, matched to the registered importers regardless of case; seeded ELETRA CWB → PR, ELETRA FOR and ELETRA MATRIZ → CE, ELETRA MAO → AM). Master and Administrador keep them through the API (`icms-rates.manage`) with audit and outbox; overlapping periods are refused by the API. It only creates tables. On 2026-10-28 it was rehearsed with ROLLBACK and applied only to `erp_po_totvs_hml` with SHA-256 `1cb89d74e573de3ae06855fa225cfc6e9370e3ce60b4d7a4cefb5f149f235a5d`; the ledger is M001–M073. Evidence is in `deploy/hostinger/README.md`. Production was not changed.
