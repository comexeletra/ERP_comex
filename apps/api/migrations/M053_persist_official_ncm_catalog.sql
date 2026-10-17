-- Keep a durable copy of the full official catalog outside the entity's NCM list.
CREATE TABLE catalog.ncm_official_snapshot (
    snapshot_id smallint PRIMARY KEY DEFAULT 1 CHECK (snapshot_id = 1),
    source_updated_at date NULL,
    attributes_source_version varchar(40) NOT NULL,
    item_count integer NOT NULL CHECK (item_count > 0),
    synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog.ncm_official_item (
    code varchar(8) PRIMARY KEY CHECK (code ~ '^[0-9]{8}$'),
    name varchar(2000) NOT NULL,
    valid_from date NOT NULL,
    valid_to date NULL,
    mandatory_import_attributes jsonb NOT NULL DEFAULT '[]'::jsonb
      CHECK (jsonb_typeof(mandatory_import_attributes) = 'array'),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX ncm_official_item_name_lower_idx ON catalog.ncm_official_item (lower(name));

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.ncm_official_snapshot TO import_erp_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.ncm_official_item TO import_erp_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.ncm_official_snapshot TO import_erp_hml_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.ncm_official_item TO import_erp_hml_app;
    END IF;
END;
$$;
