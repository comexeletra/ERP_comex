-- Selectable values are maintained in the catalog area, separate from PO forms.
ALTER TABLE procurement.purchase_order_item
  ADD COLUMN product_group varchar(120);

CREATE TABLE catalog.operational_value (
  id uuid PRIMARY KEY,
  entity_key varchar(40) NOT NULL CHECK (entity_key IN (
    'IMPORTER','INCOTERM','TRANSPORT_MODE','PORT_LOADING','PORT_DISCHARGE','CURRENCY',
    'CATEGORY','PRODUCT_GROUP','PURPOSE','DEMAND','LOGISTICS_STATUS',
    'CUSTOMS_CHANNEL','CONTAINER_TYPE'
  )),
  value text NOT NULL CHECK (length(btrim(value)) BETWEEN 1 AND 240),
  normalized_value text GENERATED ALWAYS AS (upper(btrim(value))) STORED,
  created_by uuid REFERENCES identity.erp_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_value_unique UNIQUE (entity_key, normalized_value)
);
CREATE INDEX ix_operational_value_entity ON catalog.operational_value(entity_key, normalized_value);

-- Values already present in the approved workbook's Tabelas sheet and common
-- currencies used by its data. Teams can add further values in /catalog/values.
INSERT INTO catalog.operational_value (id, entity_key, value, created_by)
SELECT md5(seed.entity_key || '|' || seed.value)::uuid, seed.entity_key, seed.value, NULL::uuid
FROM (VALUES
  ('IMPORTER','ELETRA CWB'),('IMPORTER','ELETRA FOR'),('IMPORTER','ELETRA MATRIZ'),('IMPORTER','ELETRA MAO'),
  ('INCOTERM','EXW'),('INCOTERM','FOB'),('INCOTERM','FCA'),('INCOTERM','FAS'),
  ('INCOTERM','CIF'),('INCOTERM','CFR'),('INCOTERM','CPT'),('INCOTERM','CIP'),
  ('INCOTERM','DAP'),('INCOTERM','DPU'),('INCOTERM','DDP'),
  ('TRANSPORT_MODE','AIR'),('TRANSPORT_MODE','SEA'),('TRANSPORT_MODE','COURIER'),
  ('CURRENCY','USD'),('CURRENCY','CNY'),('CURRENCY','EUR'),('CURRENCY','BRL'),
  ('PORT_LOADING','NGB'),('PORT_LOADING','SGH'),('PORT_LOADING','SHEKOU (CHINA)'),
  ('PORT_LOADING','HKG'),('PORT_LOADING','SH'),('PORT_LOADING','SHA'),('PORT_LOADING','HGH'),
  ('PORT_LOADING','SHG'),('PORT_LOADING','China'),
  ('PORT_DISCHARGE','PEC'),('PORT_DISCHARGE','PNG'),('PORT_DISCHARGE','FOR'),
  ('PORT_DISCHARGE','Pecém'),('PORT_DISCHARGE','Curitiba'),('PORT_DISCHARGE','Paranaguá'),
  ('PORT_DISCHARGE','Fortaleza'),('PORT_DISCHARGE','Pecem - CE'),
  ('PORT_DISCHARGE','Fortaleza - CE'),('PORT_DISCHARGE','SSZ'),('PORT_DISCHARGE','VCP'),
  ('CATEGORY','BESS'),('CATEGORY','Inverter'),('CATEGORY','Baterias'),
  ('CATEGORY','EV Charger'),('CATEGORY','Acessórios'),('CATEGORY','Outros'),
  ('CATEGORY','Mobilidade'),('CATEGORY','Solar'),
  ('PURPOSE','Consumo'),('PURPOSE','Imobilizado'),('PURPOSE','Insumo'),
  ('PURPOSE','Revenda'),('PURPOSE','Estoque Consumo'),('PURPOSE','Estoque Revenda'),
  ('PURPOSE','Estoque Insumos (Componente)'),('PURPOSE','Despesa'),
  ('PURPOSE','Imob. Andamento'),('PURPOSE','Amostra'),
  ('LOGISTICS_STATUS','WAITING PRODUCTION'),('LOGISTICS_STATUS','WAITING SHIPMENT'),
  ('LOGISTICS_STATUS','WAITING ARRIVAL'),('LOGISTICS_STATUS','CUSTOMS CLEARANCE'),
  ('LOGISTICS_STATUS','DELIVERED'),
  ('CUSTOMS_CHANNEL','GREEN'),('CUSTOMS_CHANNEL','YELLOW'),('CUSTOMS_CHANNEL','RED'),('CUSTOMS_CHANNEL','GRAY'),
  ('CONTAINER_TYPE', E'20''GP'),('CONTAINER_TYPE', E'40''HQ'),('CONTAINER_TYPE', E'40''HC')
) AS seed(entity_key, value)
ON CONFLICT (entity_key, normalized_value) DO NOTHING;

-- Build the first selectable values from the exact source spellings already
-- loaded for each workbook column; subsequent additions use the catalog page.
WITH source_fields(entity_key, sheet_name, source_column) AS (VALUES
  ('IMPORTER','Pré Embarque','F'),('INCOTERM','Pré Embarque','AE'),
  ('TRANSPORT_MODE','Pré Embarque','AD'),('PORT_LOADING','Pré Embarque','AG'),
  ('PORT_DISCHARGE','Pré Embarque','AH'),('CURRENCY','Pré Embarque','Z'),
  ('CATEGORY','Pré Embarque','S'),('PURPOSE','Pré Embarque','K'),
  ('DEMAND','Pré Embarque','G'),('LOGISTICS_STATUS','Pré Embarque','E'),
  ('INCOTERM','Pós Embarque','L'),('TRANSPORT_MODE','Pós Embarque','K'),
  ('PORT_LOADING','Pós Embarque','M'),('PORT_DISCHARGE','Pós Embarque','N'),
  ('CURRENCY','Pós Embarque','I'),('LOGISTICS_STATUS','Pós Embarque','E'),
  ('CUSTOMS_CHANNEL','Pós Embarque','AH'),('CONTAINER_TYPE','Pós Embarque','Y')
), source_values AS (
  SELECT field.entity_key, nullif(btrim(source.raw_values ->> field.source_column), '') AS value
  FROM source_fields field JOIN migration.source_row source ON source.sheet_name = field.sheet_name
  WHERE nullif(btrim(source.raw_values ->> field.source_column), '') IS NOT NULL
)
INSERT INTO catalog.operational_value (id, entity_key, value, created_by)
SELECT md5(entity_key || '|' || upper(btrim(value)))::uuid, entity_key, value, NULL::uuid
FROM source_values
WHERE upper(btrim(value)) NOT IN ('#N/A','#REF!','#VALUE!','#DIV/0!')
  AND NOT (entity_key = 'CURRENCY' AND value ILIKE 'Recuperando dados.%')
ON CONFLICT (entity_key, normalized_value) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT, INSERT ON catalog.operational_value TO import_erp_app;
  END IF;
END $$;
