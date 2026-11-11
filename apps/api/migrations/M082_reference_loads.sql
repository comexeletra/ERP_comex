-- Loads of the product DATABASE and of the manufacturer list (stage 1f of the
-- invoice audit). One load does two separate things:
--   * it keeps the rows of the spreadsheet, as the web reader returns them, in
--     reference tables that only the invoice audit reads (the audit never reads
--     the catalog, so manual catalog edits do not change it);
--   * it enriches the catalog: product description and NCM, supplier address
--     and country, recorded field by field in the audit log.
-- Loads and their rows are never changed or deleted; the audit uses the latest
-- load of each kind.
CREATE TABLE catalog.reference_load (
  id uuid PRIMARY KEY,
  kind varchar(24) NOT NULL CHECK (kind IN ('PRODUCT_DATABASE', 'MANUFACTURER_LIST')),
  file_name varchar(255) NOT NULL CHECK (length(btrim(file_name)) > 0),
  file_sha256 char(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer NOT NULL CHECK (row_count > 0),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  loaded_by uuid NOT NULL REFERENCES identity.erp_user(id),
  loaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_reference_load_latest ON catalog.reference_load (kind, loaded_at DESC, id DESC);

CREATE TABLE catalog.reference_product_row (
  load_id uuid NOT NULL REFERENCES catalog.reference_load(id) ON DELETE RESTRICT,
  source_row integer NOT NULL CHECK (source_row > 0),
  product_code varchar(120) NOT NULL CHECK (length(btrim(product_code)) > 0),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 2000),
  ncm varchar(8) NOT NULL CHECK (ncm ~ '^[0-9]{8}$'),
  PRIMARY KEY (load_id, source_row)
);
CREATE UNIQUE INDEX ux_reference_product_row_code ON catalog.reference_product_row (load_id, upper(btrim(product_code)));

CREATE TABLE catalog.reference_manufacturer_row (
  load_id uuid NOT NULL REFERENCES catalog.reference_load(id) ON DELETE RESTRICT,
  source_row integer NOT NULL CHECK (source_row > 0),
  name varchar(240) NOT NULL,
  address varchar(500) NOT NULL,
  country varchar(120) NOT NULL,
  code varchar(120) NOT NULL,
  PRIMARY KEY (load_id, source_row),
  CONSTRAINT reference_manufacturer_row_content CHECK (length(btrim(name)) > 0 OR length(btrim(address)) > 0)
);

-- The rows of a load come only with the load, inside the same transaction.
CREATE FUNCTION catalog.refuse_reference_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Reference load rows cannot be changed or deleted' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER reference_load_immutable BEFORE UPDATE OR DELETE ON catalog.reference_load
  FOR EACH ROW EXECUTE FUNCTION catalog.refuse_reference_row_change();
CREATE TRIGGER reference_product_row_immutable BEFORE UPDATE OR DELETE ON catalog.reference_product_row
  FOR EACH ROW EXECUTE FUNCTION catalog.refuse_reference_row_change();
CREATE TRIGGER reference_manufacturer_row_immutable BEFORE UPDATE OR DELETE ON catalog.reference_manufacturer_row
  FOR EACH ROW EXECUTE FUNCTION catalog.refuse_reference_row_change();

-- Supplier address and country, filled by the manufacturer list load.
ALTER TABLE catalog.entry
  ADD COLUMN supplier_address varchar(500),
  ADD COLUMN supplier_country varchar(120),
  ADD CONSTRAINT catalog_supplier_address_attributes CHECK (
    kind = 'SUPPLIER' OR (supplier_address IS NULL AND supplier_country IS NULL)
  );

-- Catalog entries created by a load.
ALTER TABLE catalog.entry DROP CONSTRAINT entry_provenance_check;
ALTER TABLE catalog.entry
  ADD CONSTRAINT entry_provenance_check
    CHECK (provenance IN ('MANUAL_REVIEW', 'OFFICIAL_SISCOMEX', 'OFFICIAL_MDIC', 'REFERENCE_LOAD'));

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['import_erp_app', 'import_erp_hml_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA catalog TO %I', role_name);
      EXECUTE format('GRANT SELECT, INSERT ON catalog.reference_load, catalog.reference_product_row, '
        'catalog.reference_manufacturer_row TO %I', role_name);
    END IF;
  END LOOP;
END;
$$;
