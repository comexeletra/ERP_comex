-- Store official Siscomex import attributes alongside the global NCM catalog.
-- NCMs are added individually; this table does not prepopulate the 10k+ codes.
ALTER TABLE catalog.entry
  DROP CONSTRAINT entry_provenance_check;

ALTER TABLE catalog.entry
  ADD CONSTRAINT entry_provenance_check
    CHECK (provenance IN ('MANUAL_REVIEW', 'OFFICIAL_SISCOMEX'));

CREATE TABLE catalog.ncm_siscomex_data (
    ncm_entry_id uuid PRIMARY KEY REFERENCES catalog.entry(id) ON DELETE RESTRICT,
    source_updated_at date NULL,
    attributes_source_version varchar(40) NOT NULL,
    mandatory_import_attributes jsonb NOT NULL DEFAULT '[]'::jsonb
      CHECK (jsonb_typeof(mandatory_import_attributes) = 'array'),
    attributes_sha256 char(64) NOT NULL CHECK (attributes_sha256 ~ '^[0-9a-f]{64}$'),
    synced_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
        GRANT SELECT, INSERT, UPDATE ON catalog.ncm_siscomex_data TO import_erp_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
        GRANT SELECT, INSERT, UPDATE ON catalog.ncm_siscomex_data TO import_erp_hml_app;
    END IF;
END;
$$;
