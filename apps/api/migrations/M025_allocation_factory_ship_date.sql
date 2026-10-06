-- A PO item can be split across IPs that leave the factory on different dates.
-- Keep the shipment date on the allocation. Legacy item dates stay untouched.
ALTER TABLE procurement.po_item_allocation
    ADD COLUMN factory_ship_date date;
