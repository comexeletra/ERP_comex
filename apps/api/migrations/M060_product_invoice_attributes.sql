ALTER TABLE catalog.entry
  ADD COLUMN manufacturer varchar(240),
  ADD COLUMN manufacturer_address varchar(500),
  ADD COLUMN manufacturer_country varchar(120),
  ADD COLUMN product_ncm_code varchar(8),
  ADD CONSTRAINT catalog_product_invoice_attributes CHECK (
    kind = 'PRODUCT' OR (manufacturer IS NULL AND manufacturer_address IS NULL
      AND manufacturer_country IS NULL AND product_ncm_code IS NULL)
  ),
  ADD CONSTRAINT catalog_product_ncm_format CHECK (
    product_ncm_code IS NULL OR product_ncm_code ~ '^[0-9]{8}$'
  );

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT, UPDATE ON catalog.entry TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT SELECT, UPDATE ON catalog.entry TO import_erp_hml_app;
  END IF;
END $$;
