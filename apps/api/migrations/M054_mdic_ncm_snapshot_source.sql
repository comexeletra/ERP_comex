-- Allow a current official NCM list to be cached when its source does not
-- publish individual validity dates. Keep the source and its reference explicit.
ALTER TABLE catalog.ncm_official_item
  ALTER COLUMN valid_from DROP NOT NULL;

ALTER TABLE catalog.ncm_official_snapshot
  ADD COLUMN catalog_source varchar(40) NOT NULL DEFAULT 'SISCOMEX'
    CHECK (catalog_source IN ('SISCOMEX', 'MDIC_GECEX')),
  ADD COLUMN source_reference text NOT NULL DEFAULT 'Portal Único Siscomex / Classif';

ALTER TABLE catalog.entry
  DROP CONSTRAINT entry_provenance_check;

ALTER TABLE catalog.entry
  ADD CONSTRAINT entry_provenance_check
    CHECK (provenance IN ('MANUAL_REVIEW', 'OFFICIAL_SISCOMEX', 'OFFICIAL_MDIC'));
