ALTER TABLE procurement.purchase_order_item
  ADD COLUMN item_group varchar(120);

COMMENT ON COLUMN procurement.purchase_order_item.item_group IS
  'Selectable Group value maintained independently from product_group.';
