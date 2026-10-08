ALTER TABLE catalog.operational_value
  DROP CONSTRAINT operational_value_entity_key_check;

ALTER TABLE catalog.operational_value
  ADD CONSTRAINT operational_value_entity_key_check CHECK (entity_key IN (
    'IMPORTER','INCOTERM','TRANSPORT_MODE','PORT_LOADING','PORT_DISCHARGE','CURRENCY',
    'CATEGORY','PRODUCT_GROUP','PURPOSE','DEMAND','LOGISTICS_STATUS',
    'CUSTOMS_CHANNEL','CONTAINER_TYPE','PRIORITY','UNIT_OF_MEASURE','REQUESTER','COST_CENTER',
    'BROKER','FORWARDER'
  ));

INSERT INTO catalog.operational_value (id, entity_key, value, created_by)
SELECT md5(seed.entity_key || '|' || upper(btrim(seed.value)))::uuid,
       seed.entity_key, btrim(seed.value), NULL::uuid
FROM (
  SELECT 'UNIT_OF_MEASURE'::text AS entity_key, unit AS value
  FROM procurement.purchase_order_item
  UNION ALL
  SELECT 'REQUESTER', requester FROM procurement.purchase_order_item
  UNION ALL
  SELECT 'COST_CENTER', cost_center FROM procurement.purchase_order_item
  UNION ALL
  SELECT 'BROKER', broker FROM imports.import_process
  UNION ALL
  SELECT 'FORWARDER', forwarder FROM imports.import_process
  UNION ALL
  SELECT 'PRIORITY', priority FROM procurement.purchase_order_item
  UNION ALL
  SELECT 'PRIORITY', priority FROM imports.import_process
) AS seed
WHERE nullif(btrim(seed.value), '') IS NOT NULL
ON CONFLICT (entity_key, normalized_value) DO NOTHING;
