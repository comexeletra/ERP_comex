-- Products are shared catalog entities. Promote one existing entry per code;
-- retain older importer-specific duplicates for audit and rollback history.
ALTER TABLE catalog.entry DROP CONSTRAINT catalog_supplier_global_importer_check;

WITH ranked_products AS (
  SELECT id, row_number() OVER (
    PARTITION BY normalized_code
    ORDER BY (status = 'ACTIVE') DESC, updated_at DESC, created_at, id
  ) AS rank
  FROM catalog.entry
  WHERE kind = 'PRODUCT'
)
UPDATE catalog.entry entry
SET importer = NULL
FROM ranked_products ranked
WHERE entry.id = ranked.id AND ranked.rank = 1;

ALTER TABLE catalog.entry
  ADD CONSTRAINT catalog_global_entity_importer_check CHECK (
    (kind = 'SUPPLIER' AND importer IS NULL)
    OR kind = 'PRODUCT'
    OR (kind = 'NCM' AND importer IS NOT NULL)
  );

CREATE UNIQUE INDEX ux_catalog_global_product_code
  ON catalog.entry (normalized_code)
  WHERE kind = 'PRODUCT' AND importer IS NULL;
