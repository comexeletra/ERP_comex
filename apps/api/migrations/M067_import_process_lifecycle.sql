ALTER TABLE imports.import_process
  DROP CONSTRAINT import_process_record_status_check;

ALTER TABLE imports.import_process
  ADD CONSTRAINT import_process_record_status_check
    CHECK (record_status IN ('DRAFT', 'ACTIVE', 'CANCELLED', 'DELETED')),
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by text,
  ADD COLUMN delete_reason text,
  ADD COLUMN record_status_before_delete varchar(16);

ALTER TABLE imports.import_process
  ADD CONSTRAINT import_process_deleted_metadata_check CHECK (
    (
      record_status = 'DELETED'
      AND deleted_at IS NOT NULL
      AND deleted_by IS NOT NULL
      AND delete_reason IS NOT NULL
      AND char_length(btrim(delete_reason)) >= 3
      AND record_status_before_delete IS NOT NULL
      AND record_status_before_delete IN ('DRAFT', 'ACTIVE', 'CANCELLED')
    )
    OR (
      record_status <> 'DELETED'
      AND deleted_at IS NULL
      AND deleted_by IS NULL
      AND delete_reason IS NULL
      AND record_status_before_delete IS NULL
    )
  );

CREATE OR REPLACE FUNCTION procurement.check_import_process_record_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.record_status = OLD.record_status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.record_status = 'DRAFT' AND NEW.record_status IN ('ACTIVE', 'CANCELLED', 'DELETED'))
    OR (OLD.record_status = 'ACTIVE' AND NEW.record_status IN ('CANCELLED', 'DELETED'))
    OR (OLD.record_status = 'CANCELLED' AND NEW.record_status IN ('ACTIVE', 'DELETED'))
    OR (OLD.record_status = 'DELETED' AND NEW.record_status = OLD.record_status_before_delete)
  ) THEN
    RAISE EXCEPTION 'Invalid import process record status transition' USING ERRCODE = '23514';
  END IF;

  IF NEW.record_status = 'CANCELLED' AND OLD.lifecycle_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Closed IPs cannot be cancelled' USING ERRCODE = '23514';
  END IF;

  IF NEW.record_status = 'DELETED' THEN
    IF OLD.lifecycle_status <> 'OPEN' THEN
      RAISE EXCEPTION 'Closed IPs cannot be deleted' USING ERRCODE = '23514';
    END IF;
    IF NEW.record_status_before_delete IS DISTINCT FROM OLD.record_status THEN
      RAISE EXCEPTION 'Deleted IP must retain its previous record status' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD.record_status = 'CANCELLED' AND NEW.record_status = 'ACTIVE' THEN
    IF NEW.lifecycle_status <> 'OPEN' OR NEW.logistics_status IS NOT NULL THEN
      RAISE EXCEPTION 'Reactivated IPs must be open with no logistics status' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM procurement.process_purchase_order link
      WHERE link.process_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Reactivated IPs cannot retain linked purchase orders' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD.record_status = 'DELETED' AND NEW.record_status <> 'DELETED'
     AND NEW.lifecycle_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Restored IPs must remain open' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM procurement.po_item_allocation allocation
    WHERE allocation.process_id = NEW.id AND allocation.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Cancel active allocations before changing IP record status' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM imports.process_document document
    WHERE document.process_id = NEW.id AND document.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Cancel active documents before changing IP record status' USING ERRCODE = '23514';
  END IF;

  IF NEW.record_status = 'DELETED' AND EXISTS (
    SELECT 1 FROM procurement.process_purchase_order link
    WHERE link.process_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Deleted IPs cannot retain linked purchase orders' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM procurement.po_item_allocation allocation
    JOIN imports.import_process process ON process.id = allocation.process_id
    WHERE allocation.status = 'ACTIVE' AND process.record_status <> 'ACTIVE'
  ) OR EXISTS (
    SELECT 1
    FROM imports.process_document document
    JOIN imports.import_process process ON process.id = document.process_id
    WHERE document.status = 'ACTIVE' AND process.record_status <> 'ACTIVE'
  ) OR EXISTS (
    SELECT 1
    FROM imports.import_process process
    JOIN procurement.process_purchase_order link ON link.process_id = process.id
    WHERE process.record_status = 'DELETED'
  ) THEN
    RAISE EXCEPTION 'Import process lifecycle data violates M067 constraints';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT (deleted_at, deleted_by, delete_reason, record_status_before_delete),
      INSERT (deleted_at, deleted_by, delete_reason, record_status_before_delete),
      UPDATE (deleted_at, deleted_by, delete_reason, record_status_before_delete)
      ON imports.import_process TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT SELECT (deleted_at, deleted_by, delete_reason, record_status_before_delete),
      INSERT (deleted_at, deleted_by, delete_reason, record_status_before_delete),
      UPDATE (deleted_at, deleted_by, delete_reason, record_status_before_delete)
      ON imports.import_process TO import_erp_hml_app;
  END IF;
END;
$$;
