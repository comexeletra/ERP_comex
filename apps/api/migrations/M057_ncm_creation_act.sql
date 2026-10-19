-- Keep the official act that introduced each NCM with the existing Siscomex data.
-- Existing rows remain available; the next normal refresh fills these nullable fields.
ALTER TABLE catalog.ncm_official_item
  ADD COLUMN creation_act jsonb NULL CHECK (creation_act IS NULL OR jsonb_typeof(creation_act) = 'object');

ALTER TABLE catalog.ncm_last_siscomex_item
  ADD COLUMN creation_act jsonb NULL CHECK (creation_act IS NULL OR jsonb_typeof(creation_act) = 'object');

ALTER TABLE catalog.ncm_siscomex_data
  ADD COLUMN creation_act jsonb NULL CHECK (creation_act IS NULL OR jsonb_typeof(creation_act) = 'object');
