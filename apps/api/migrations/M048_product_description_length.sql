ALTER TABLE catalog.entry DROP CONSTRAINT entry_name_check;

ALTER TABLE catalog.entry
  ADD CONSTRAINT catalog_entry_name_length CHECK (
    length(btrim(name)) BETWEEN 1 AND
      CASE WHEN kind = 'PRODUCT' THEN 2000 ELSE 240 END
  );
