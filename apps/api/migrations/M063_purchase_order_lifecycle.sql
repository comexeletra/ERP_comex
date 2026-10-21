ALTER TABLE procurement.purchase_order
  ADD COLUMN lifecycle_status varchar(16) NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN ('ACTIVE', 'CANCELLED', 'CLOSED', 'DELETED')),
  ADD COLUMN lifecycle_changed_at timestamptz,
  ADD COLUMN lifecycle_changed_by text,
  ADD COLUMN lifecycle_reason text,
  ADD CONSTRAINT purchase_order_lifecycle_metadata CHECK (
    (lifecycle_status = 'ACTIVE' AND lifecycle_changed_at IS NULL
      AND lifecycle_changed_by IS NULL AND lifecycle_reason IS NULL)
    OR (lifecycle_changed_at IS NOT NULL AND nullif(btrim(lifecycle_changed_by), '') IS NOT NULL
      AND lifecycle_reason IS NOT NULL AND length(btrim(lifecycle_reason)) >= 3)
  );

CREATE INDEX ix_purchase_order_importer_lifecycle
  ON procurement.purchase_order (importer, lifecycle_status, normalized_number);

CREATE OR REPLACE FUNCTION procurement.check_purchase_order_lifecycle_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lifecycle_status = OLD.lifecycle_status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.lifecycle_status = 'ACTIVE' AND NEW.lifecycle_status IN ('CANCELLED', 'CLOSED', 'DELETED'))
    OR (OLD.lifecycle_status = 'CLOSED' AND NEW.lifecycle_status IN ('ACTIVE', 'DELETED'))
    OR (OLD.lifecycle_status = 'CANCELLED' AND NEW.lifecycle_status = 'DELETED')
  ) THEN
    RAISE EXCEPTION 'Invalid PO lifecycle transition' USING ERRCODE = '23514';
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

CREATE TRIGGER purchase_order_lifecycle_transition
  BEFORE UPDATE OF lifecycle_status ON procurement.purchase_order
  FOR EACH ROW EXECUTE FUNCTION procurement.check_purchase_order_lifecycle_transition();

CREATE OR REPLACE FUNCTION procurement.check_purchase_order_business_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable_fields text[] := ARRAY['lifecycle_status', 'lifecycle_changed_at', 'lifecycle_changed_by',
    'lifecycle_reason', 'version', 'updated_at'];
BEGIN
  IF OLD.lifecycle_status <> 'ACTIVE'
    AND (to_jsonb(NEW) - mutable_fields) IS DISTINCT FROM (to_jsonb(OLD) - mutable_fields) THEN
    RAISE EXCEPTION 'Only active POs allow business field changes' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_order_business_fields_immutable
  BEFORE UPDATE ON procurement.purchase_order
  FOR EACH ROW EXECUTE FUNCTION procurement.check_purchase_order_business_fields();

CREATE OR REPLACE FUNCTION procurement.check_po_item_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_id uuid;
  parent_status varchar(16);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id THEN
    RAISE EXCEPTION 'PO items cannot change parent PO' USING ERRCODE = '23514';
  END IF;
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.purchase_order_id ELSE NEW.purchase_order_id END;
  SELECT lifecycle_status INTO parent_status
  FROM procurement.purchase_order WHERE id = parent_id FOR UPDATE;

  IF parent_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'Only active POs allow item changes' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_order_item_lifecycle_check
  BEFORE INSERT OR UPDATE OR DELETE ON procurement.purchase_order_item
  FOR EACH ROW EXECUTE FUNCTION procurement.check_po_item_lifecycle();

CREATE OR REPLACE FUNCTION procurement.check_po_item_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    item_quantity numeric(24,8);
    po_importer varchar(120);
    po_lifecycle_status varchar(16);
    ip_importer varchar(120);
    ip_record_status varchar(16);
    allocated numeric(24,8);
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.purchase_order_item_id <> OLD.purchase_order_item_id
        OR NEW.process_id <> OLD.process_id OR OLD.status = 'CANCELLED') THEN
        RAISE EXCEPTION 'Allocation identity or cancelled allocation cannot be changed' USING ERRCODE = '23514';
    END IF;

    SELECT item.ordered_quantity, po.importer, po.lifecycle_status
      INTO item_quantity, po_importer, po_lifecycle_status
      FROM procurement.purchase_order_item item
      JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
      WHERE item.id = NEW.purchase_order_item_id FOR UPDATE OF item, po;
    IF po_lifecycle_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'Only active POs allow allocation changes' USING ERRCODE = '23514';
    END IF;
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
