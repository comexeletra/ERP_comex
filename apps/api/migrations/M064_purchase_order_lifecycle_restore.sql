CREATE OR REPLACE FUNCTION procurement.check_purchase_order_lifecycle_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lifecycle_status = OLD.lifecycle_status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.lifecycle_status = 'ACTIVE' AND NEW.lifecycle_status IN ('CANCELLED', 'CLOSED', 'DELETED'))
    OR (OLD.lifecycle_status = 'CLOSED' AND NEW.lifecycle_status IN ('ACTIVE', 'DELETED'))
    OR (OLD.lifecycle_status = 'CANCELLED' AND NEW.lifecycle_status IN ('ACTIVE', 'DELETED'))
    OR (OLD.lifecycle_status = 'DELETED' AND NEW.lifecycle_status = 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'Invalid PO lifecycle transition' USING ERRCODE = '23514';
  END IF;

  IF NEW.lifecycle_status = 'ACTIVE' THEN
    NEW.lifecycle_changed_at := NULL;
    NEW.lifecycle_changed_by := NULL;
    NEW.lifecycle_reason := NULL;
  END IF;

  IF NEW.lifecycle_status IN ('CANCELLED', 'DELETED') AND EXISTS (
    SELECT 1
    FROM procurement.purchase_order_item item
    JOIN procurement.po_item_allocation allocation ON allocation.purchase_order_item_id = item.id
    WHERE item.purchase_order_id = OLD.id AND allocation.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'PO with active allocations cannot be cancelled or deleted' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
