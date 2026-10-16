-- NCM is a shared fiscal reference, independent of importer ownership.
-- Refuse an ambiguous legacy state rather than silently retaining importer
-- dependencies or discarding duplicate entries and their audit history.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM catalog.entry
    WHERE kind = 'NCM'
    GROUP BY normalized_code
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot globalize NCM catalog: duplicate codes need explicit reconciliation';
  END IF;
END
$migration$;

ALTER TABLE catalog.entry
  DROP CONSTRAINT catalog_global_entity_importer_check;

UPDATE catalog.entry SET importer = NULL WHERE kind = 'NCM';

-- Unverified legacy codes can be carried for review without claiming a legal
-- validity period; they must remain inactive until that period is confirmed.
ALTER TABLE catalog.entry DROP CONSTRAINT catalog_ncm_code;
ALTER TABLE catalog.entry
  ADD CONSTRAINT catalog_ncm_code CHECK (
    kind <> 'NCM'
    OR (code ~ '^[0-9]{8}$' AND (valid_from IS NOT NULL OR status = 'INACTIVE'))
  );

ALTER TABLE catalog.entry
  ADD CONSTRAINT catalog_global_entity_importer_check CHECK (
    kind IN ('SUPPLIER', 'PRODUCT', 'NCM') AND importer IS NULL
  );

CREATE UNIQUE INDEX ux_catalog_global_ncm_code
  ON catalog.entry (normalized_code)
  WHERE kind = 'NCM' AND importer IS NULL;
