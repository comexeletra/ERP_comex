ALTER TABLE catalog.operational_value
  ADD COLUMN code varchar(120);

ALTER TABLE catalog.operational_value
  ADD CONSTRAINT operational_value_group_code_check
  CHECK (entity_key = 'GROUP' OR code IS NULL);

CREATE UNIQUE INDEX ux_operational_group_code
  ON catalog.operational_value (upper(btrim(code)))
  WHERE entity_key = 'GROUP' AND code IS NOT NULL;
