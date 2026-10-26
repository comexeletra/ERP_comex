-- Demand type tells whether the HQ makes the item to stock (MTS) or to order, which
-- sets the production lead time the end-to-end analysis plans for it (MTS 30 days,
-- Não MTS 45 days).
-- It is a list of its own: DEMAND keeps recording where the demand came from.
ALTER TABLE catalog.operational_value
  DROP CONSTRAINT operational_value_entity_key_check;

ALTER TABLE catalog.operational_value
  ADD CONSTRAINT operational_value_entity_key_check CHECK (entity_key IN (
    'IMPORTER','INCOTERM','TRANSPORT_MODE','PORT_LOADING','PORT_DISCHARGE','CURRENCY',
    'CATEGORY','PRODUCT_GROUP','GROUP','PURPOSE','DEMAND','DEMAND_TYPE','LOGISTICS_STATUS',
    'CUSTOMS_CHANNEL','CONTAINER_TYPE','PRIORITY','UNIT_OF_MEASURE','REQUESTER','COST_CENTER',
    'BROKER','FORWARDER','PRODUCT','NCM'
  ));

INSERT INTO catalog.operational_value (id, entity_key, value, created_by)
SELECT md5('DEMAND_TYPE|' || upper(btrim(seed.value)))::uuid,
       'DEMAND_TYPE', seed.value, NULL::uuid
FROM (VALUES ('MTS'), ('Não MTS')) AS seed(value)
ON CONFLICT (entity_key, normalized_value) DO NOTHING;

ALTER TABLE procurement.purchase_order_item
  ADD COLUMN demand_type varchar(40),
  ADD CONSTRAINT purchase_order_item_demand_type_not_blank
    CHECK (demand_type IS NULL OR length(btrim(demand_type)) > 0);

COMMENT ON COLUMN procurement.purchase_order_item.demand_type IS
  'Demand type (MTS or Não MTS) chosen from the DEMAND_TYPE list; drives the planned HQ production lead time.';
