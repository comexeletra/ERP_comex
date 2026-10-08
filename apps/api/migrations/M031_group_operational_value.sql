ALTER TABLE catalog.operational_value
  DROP CONSTRAINT operational_value_entity_key_check;

ALTER TABLE catalog.operational_value
  ADD CONSTRAINT operational_value_entity_key_check CHECK (entity_key IN (
    'IMPORTER','INCOTERM','TRANSPORT_MODE','PORT_LOADING','PORT_DISCHARGE','CURRENCY',
    'CATEGORY','PRODUCT_GROUP','GROUP','PURPOSE','DEMAND','LOGISTICS_STATUS',
    'CUSTOMS_CHANNEL','CONTAINER_TYPE','PRIORITY','UNIT_OF_MEASURE','REQUESTER','COST_CENTER',
    'BROKER','FORWARDER'
  ));

INSERT INTO catalog.operational_value (id, entity_key, value, created_by)
SELECT md5('GROUP|' || upper(btrim(seed.value)))::uuid,
       'GROUP', seed.value, NULL::uuid
FROM (VALUES ('Energy'), ('Livoltek'), ('Recloser'), ('Water')) AS seed(value)
ON CONFLICT (entity_key, normalized_value) DO NOTHING;
