ALTER TABLE imports.import_process
  ADD COLUMN record_status varchar(16) NOT NULL DEFAULT 'ACTIVE'
    CHECK (record_status IN ('DRAFT', 'ACTIVE', 'CANCELLED'));

UPDATE imports.import_process
SET record_status = 'CANCELLED'
WHERE upper(coalesce(logistics_status, '')) IN ('CANCELLED', 'CANCELED');

ALTER TABLE imports.import_process
  ADD CONSTRAINT import_process_active_logistics_status_check
    CHECK (record_status <> 'ACTIVE' OR upper(coalesce(logistics_status, '')) NOT IN ('CANCELLED', 'CANCELED'));

CREATE INDEX ix_import_process_record_status
  ON imports.import_process (importer, record_status, ip_number);

CREATE OR REPLACE FUNCTION procurement.check_po_item_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    item_quantity numeric(24,8);
    po_importer varchar(120);
    ip_importer varchar(120);
    ip_record_status varchar(16);
    allocated numeric(24,8);
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.purchase_order_item_id <> OLD.purchase_order_item_id
        OR NEW.process_id <> OLD.process_id OR OLD.status = 'CANCELLED') THEN
        RAISE EXCEPTION 'Allocation identity or cancelled allocation cannot be changed' USING ERRCODE = '23514';
    END IF;
    SELECT item.ordered_quantity, po.importer INTO item_quantity, po_importer
      FROM procurement.purchase_order_item item
      JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
      WHERE item.id = NEW.purchase_order_item_id FOR UPDATE OF item;
    SELECT importer, record_status INTO ip_importer, ip_record_status
      FROM imports.import_process WHERE id = NEW.process_id FOR UPDATE;
    IF po_importer IS DISTINCT FROM ip_importer THEN
        RAISE EXCEPTION 'PO and IP must belong to the same importer' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'ACTIVE' AND ip_record_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Only active IPs can consume PO quantity' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'ACTIVE' THEN
        SELECT coalesce(sum(allocation.quantity), 0) INTO allocated
          FROM procurement.po_item_allocation allocation
          JOIN imports.import_process process ON process.id = allocation.process_id
          WHERE allocation.purchase_order_item_id = NEW.purchase_order_item_id
            AND allocation.status = 'ACTIVE' AND process.record_status = 'ACTIVE'
            AND allocation.id <> NEW.id;
        IF allocated + NEW.quantity > item_quantity THEN
            RAISE EXCEPTION 'Allocated quantity exceeds ordered quantity' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.check_po_item_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    allocated numeric(24,8);
BEGIN
    SELECT coalesce(sum(allocation.quantity), 0) INTO allocated
      FROM procurement.po_item_allocation allocation
      JOIN imports.import_process process ON process.id = allocation.process_id
      WHERE allocation.purchase_order_item_id = NEW.id AND allocation.status = 'ACTIVE'
        AND process.record_status = 'ACTIVE';
    IF NEW.ordered_quantity < allocated THEN
        RAISE EXCEPTION 'Ordered quantity is below active allocations' USING ERRCODE = '23514';
    END IF;
    IF NEW.unit IS DISTINCT FROM OLD.unit AND allocated > 0 THEN
        RAISE EXCEPTION 'Cannot change unit when the item is actively allocated' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.check_import_process_record_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.record_status = 'CANCELLED' AND NEW.record_status <> 'CANCELLED' THEN
      RAISE EXCEPTION 'Cancelled IPs cannot be reactivated' USING ERRCODE = '23514';
    END IF;
    IF NEW.record_status <> 'ACTIVE' AND EXISTS (
      SELECT 1 FROM procurement.po_item_allocation allocation
      WHERE allocation.process_id = NEW.id AND allocation.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'Cancel active allocations before changing IP record status' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER import_process_record_status_check
  BEFORE UPDATE OF record_status ON imports.import_process
  FOR EACH ROW EXECUTE FUNCTION procurement.check_import_process_record_status();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT, UPDATE ON imports.import_process TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT SELECT, UPDATE ON imports.import_process TO import_erp_hml_app;
  END IF;
END $$;
