-- Preserve the last complete Siscomex load when MDIC becomes the active search source.
CREATE TABLE catalog.ncm_last_siscomex_snapshot (
  snapshot_id smallint PRIMARY KEY DEFAULT 1 CHECK (snapshot_id = 1),
  source_updated_at date NULL,
  attributes_source_version varchar(40) NOT NULL,
  item_count integer NOT NULL CHECK (item_count > 0),
  synced_at timestamptz NOT NULL
);

CREATE TABLE catalog.ncm_last_siscomex_item
  (LIKE catalog.ncm_official_item INCLUDING ALL);

INSERT INTO catalog.ncm_last_siscomex_snapshot
  (snapshot_id,source_updated_at,attributes_source_version,item_count,synced_at)
SELECT snapshot_id,source_updated_at,attributes_source_version,item_count,synced_at
FROM catalog.ncm_official_snapshot WHERE catalog_source='SISCOMEX';

INSERT INTO catalog.ncm_last_siscomex_item
SELECT item.* FROM catalog.ncm_official_item AS item
WHERE EXISTS (SELECT 1 FROM catalog.ncm_official_snapshot WHERE catalog_source='SISCOMEX');

CREATE TABLE catalog.ncm_sync_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  last_attempt_at timestamptz NULL,
  last_success_at timestamptz NULL,
  last_source varchar(40) NULL CHECK (last_source IN ('SISCOMEX','MDIC_GECEX')),
  last_siscomex_success_at timestamptz NULL,
  last_error text NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  retry_mode boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO catalog.ncm_sync_state (id,last_success_at,last_source,last_siscomex_success_at)
SELECT 1,synced_at,catalog_source,
  CASE WHEN catalog_source='SISCOMEX' THEN synced_at ELSE NULL END
FROM catalog.ncm_official_snapshot;

INSERT INTO catalog.ncm_sync_state (id) VALUES (1) ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='import_erp_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON catalog.ncm_last_siscomex_snapshot,
      catalog.ncm_last_siscomex_item,catalog.ncm_sync_state TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='import_erp_hml_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON catalog.ncm_last_siscomex_snapshot,
      catalog.ncm_last_siscomex_item,catalog.ncm_sync_state TO import_erp_hml_app;
  END IF;
END $$;
