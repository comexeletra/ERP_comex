-- Manually reviewed operational catalog. Historical observations remain immutable.
CREATE SCHEMA IF NOT EXISTS catalog;

CREATE TABLE catalog.entry (
    id uuid PRIMARY KEY,
    importer varchar(120) NOT NULL,
    kind varchar(16) NOT NULL CHECK (kind IN ('SUPPLIER', 'PRODUCT', 'NCM')),
    code text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 120),
    normalized_code text GENERATED ALWAYS AS (upper(btrim(code))) STORED,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 240),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    provenance varchar(32) NOT NULL DEFAULT 'MANUAL_REVIEW' CHECK (provenance = 'MANUAL_REVIEW'),
    evidence text NOT NULL CHECK (length(btrim(evidence)) >= 8),
    valid_from date NULL,
    valid_to date NULL,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by uuid NOT NULL REFERENCES identity.erp_user(id),
    updated_by uuid NOT NULL REFERENCES identity.erp_user(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT catalog_entry_validity CHECK (valid_to IS NULL OR (valid_from IS NOT NULL AND valid_to >= valid_from)),
    CONSTRAINT catalog_ncm_code CHECK (kind <> 'NCM' OR (code ~ '^[0-9]{8}$' AND valid_from IS NOT NULL)),
    CONSTRAINT catalog_entry_unique UNIQUE (importer, kind, normalized_code)
);

-- An alias preserves the literal source spelling; it never assigns a historical
-- PO line to an operational product without a separate reviewed decision.
CREATE TABLE catalog.entry_alias (
    id uuid PRIMARY KEY,
    entry_id uuid NOT NULL REFERENCES catalog.entry(id) ON DELETE RESTRICT,
    raw_code text NOT NULL CHECK (length(btrim(raw_code)) BETWEEN 1 AND 120),
    normalized_code text GENERATED ALWAYS AS (upper(btrim(raw_code))) STORED,
    source_kind varchar(24) NOT NULL CHECK (source_kind IN ('MANUAL_ENTRY', 'HISTORICAL_REVIEW')),
    source_row_id uuid NULL REFERENCES migration.source_row(id) ON DELETE RESTRICT,
    created_by uuid NOT NULL REFERENCES identity.erp_user(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT catalog_alias_source CHECK ((source_kind = 'MANUAL_ENTRY') = (source_row_id IS NULL)),
    UNIQUE (entry_id, raw_code)
);
CREATE INDEX ix_catalog_alias_normalized ON catalog.entry_alias (normalized_code);

CREATE TABLE catalog.command_receipt (
    actor_user_id uuid NOT NULL REFERENCES identity.erp_user(id),
    idempotency_key varchar(128) NOT NULL,
    payload_sha256 char(64) NOT NULL,
    entry_id uuid NOT NULL REFERENCES catalog.entry(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_user_id, idempotency_key)
);

CREATE INDEX ix_catalog_entry_importer_kind ON catalog.entry (importer, kind, status, normalized_code);

-- The deployment provisions this least-privilege role separately. CI's empty
-- database can apply the schema before that role exists.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
        GRANT USAGE ON SCHEMA catalog TO import_erp_app;
        GRANT SELECT, INSERT, UPDATE ON catalog.entry TO import_erp_app;
        GRANT SELECT, INSERT ON catalog.entry_alias, catalog.command_receipt TO import_erp_app;
    END IF;
END;
$$;
