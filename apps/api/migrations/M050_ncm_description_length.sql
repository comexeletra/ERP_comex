ALTER TABLE catalog.entry DROP CONSTRAINT catalog_entry_name_length;

ALTER TABLE catalog.entry
  ADD CONSTRAINT catalog_entry_name_length CHECK (
    length(btrim(name)) BETWEEN 1 AND
      CASE WHEN kind IN ('PRODUCT', 'NCM') THEN 2000 ELSE 240 END
  );
