ALTER TABLE catalog.operational_value
  ADD COLUMN import_cons varchar(40),
  ADD COLUMN cnpj varchar(18),
  ADD COLUMN short_name varchar(240);

ALTER TABLE catalog.operational_value
  DROP CONSTRAINT operational_value_group_code_check;

ALTER TABLE catalog.operational_value
  ADD CONSTRAINT operational_value_code_entity_check
  CHECK (entity_key IN ('GROUP', 'IMPORTER') OR code IS NULL),
  ADD CONSTRAINT operational_value_import_cons_entity_check
  CHECK (entity_key = 'IMPORTER' OR import_cons IS NULL),
  ADD CONSTRAINT operational_value_cnpj_entity_check
  CHECK (entity_key = 'IMPORTER' OR cnpj IS NULL),
  ADD CONSTRAINT operational_value_short_name_entity_check
  CHECK (entity_key = 'IMPORTER' OR short_name IS NULL),
  ADD CONSTRAINT operational_value_importer_cnpj_format_check
  CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{2}[.][0-9]{3}[.][0-9]{3}/[0-9]{4}-[0-9]{2}$');

CREATE UNIQUE INDEX ux_operational_importer_code
  ON catalog.operational_value (upper(btrim(code)))
  WHERE entity_key = 'IMPORTER' AND code IS NOT NULL;
