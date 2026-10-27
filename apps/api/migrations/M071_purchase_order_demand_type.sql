-- The demand type (MTS or Não MTS) belongs to the PO: the HQ plans the whole order either from
-- stock or to order, and every product of the PO inherits it. M069 kept it per product; this
-- moves it to the PO and removes the product column, so the products of a PO can never disagree.
ALTER TABLE procurement.purchase_order
  ADD COLUMN demand_type varchar(40),
  ADD CONSTRAINT purchase_order_demand_type_not_blank
    CHECK (demand_type IS NULL OR length(btrim(demand_type)) > 0);

-- A PO keeps the type its typed products agree on; a PO with mixed types stays without one.
-- Only active POs are updated: the business fields of cancelled or deleted POs are frozen (M063).
UPDATE procurement.purchase_order AS po
SET demand_type = typed.demand_type
FROM (
  SELECT item.purchase_order_id, min(item.demand_type) AS demand_type
  FROM procurement.purchase_order_item AS item
  WHERE item.demand_type IS NOT NULL
  GROUP BY item.purchase_order_id
  HAVING count(DISTINCT item.demand_type) = 1
) AS typed
WHERE po.id = typed.purchase_order_id AND po.lifecycle_status = 'ACTIVE';

ALTER TABLE procurement.purchase_order_item DROP COLUMN demand_type;

COMMENT ON COLUMN procurement.purchase_order.demand_type IS
  'Demand type (MTS or Não MTS) chosen from the DEMAND_TYPE list; every product of the PO inherits it and it drives the planned HQ production lead time.';
