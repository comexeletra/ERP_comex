ALTER TABLE procurement.purchase_request
  ADD COLUMN sc_date date NULL;

ALTER TABLE procurement.purchase_order_item
  ADD COLUMN sc_date date NULL;
