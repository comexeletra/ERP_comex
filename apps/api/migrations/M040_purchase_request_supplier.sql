ALTER TABLE procurement.purchase_request
  ADD COLUMN supplier_text varchar(240);

ALTER TABLE imports.import_process
  ADD COLUMN supplier_text varchar(240);

-- Recover a supplier only when every linked PO agrees on one non-empty value.
WITH unambiguous AS (
  SELECT po.purchase_request_id, min(po.supplier_text) AS supplier_text
  FROM procurement.purchase_order po
  WHERE po.purchase_request_id IS NOT NULL
    AND nullif(btrim(po.supplier_text), '') IS NOT NULL
  GROUP BY po.purchase_request_id
  HAVING count(DISTINCT upper(btrim(po.supplier_text))) = 1
)
UPDATE procurement.purchase_request sc
SET supplier_text = unambiguous.supplier_text
FROM unambiguous
WHERE sc.id = unambiguous.purchase_request_id;

-- Keep existing POs' hand-entered supplier values. New SC links are made
-- authoritative by the API and the trigger below.
CREATE OR REPLACE FUNCTION procurement.sync_purchase_order_supplier_from_sc()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sc_supplier varchar(240);
BEGIN
  IF NEW.purchase_request_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT supplier_text INTO sc_supplier
  FROM procurement.purchase_request
  WHERE id = NEW.purchase_request_id AND importer = NEW.importer;
  IF sc_supplier IS NULL OR btrim(sc_supplier) = '' THEN
    RAISE EXCEPTION 'Linked SC must have a supplier' USING ERRCODE = '23514';
  END IF;
  NEW.supplier_text := sc_supplier;
  RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_order_supplier_from_sc
  BEFORE INSERT OR UPDATE OF purchase_request_id ON procurement.purchase_order
  FOR EACH ROW EXECUTE FUNCTION procurement.sync_purchase_order_supplier_from_sc();

CREATE OR REPLACE FUNCTION procurement.protect_allocated_po_supplier()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.supplier_text IS DISTINCT FROM OLD.supplier_text AND EXISTS (
    SELECT 1
    FROM procurement.purchase_order_item item
    JOIN procurement.po_item_allocation allocation ON allocation.purchase_order_item_id = item.id
      AND allocation.status = 'ACTIVE'
    JOIN imports.import_process process ON process.id = allocation.process_id
    WHERE item.purchase_order_id = OLD.id
      AND (NEW.supplier_text IS NULL OR NOT (
        upper(btrim(process.supplier_text)) = upper(btrim(NEW.supplier_text)) OR EXISTS (
          SELECT 1 FROM catalog.entry supplier
          WHERE supplier.importer = NEW.importer AND supplier.kind = 'SUPPLIER'
            AND upper(btrim(supplier.code)) = upper(btrim(NEW.supplier_text))
            AND upper(btrim(supplier.name)) = upper(btrim(process.supplier_text))
        )
      ))
  ) THEN
    RAISE EXCEPTION 'PO supplier cannot change while an active IP allocation has another supplier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_order_supplier_in_use
  BEFORE UPDATE OF supplier_text ON procurement.purchase_order
  FOR EACH ROW EXECUTE FUNCTION procurement.protect_allocated_po_supplier();

CREATE OR REPLACE FUNCTION procurement.check_ip_po_supplier()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  po_supplier varchar(240);
  ip_supplier varchar(240);
  ip_importer varchar(120);
  po_importer varchar(120);
  supplier_matches boolean;
BEGIN
  SELECT po.supplier_text, po.importer
    INTO po_supplier, po_importer
    FROM procurement.purchase_order_item item
    JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
   WHERE item.id = NEW.purchase_order_item_id;
  SELECT supplier_text, importer INTO ip_supplier, ip_importer
    FROM imports.import_process WHERE id = NEW.process_id;

  IF po_importer IS DISTINCT FROM ip_importer THEN
    RAISE EXCEPTION 'PO and IP must belong to the same importer' USING ERRCODE = '23514';
  END IF;
  IF nullif(btrim(po_supplier), '') IS NULL OR nullif(btrim(ip_supplier), '') IS NULL THEN
    RAISE EXCEPTION 'PO and IP must have a supplier before allocation' USING ERRCODE = '23514';
  END IF;

  SELECT upper(btrim(ip_supplier)) = upper(btrim(po_supplier)) OR EXISTS (
    SELECT 1 FROM catalog.entry supplier
    WHERE supplier.importer = ip_importer AND supplier.kind = 'SUPPLIER'
      AND upper(btrim(supplier.code)) = upper(btrim(po_supplier))
      AND upper(btrim(supplier.name)) = upper(btrim(ip_supplier))
  ) INTO supplier_matches;
  IF NOT supplier_matches THEN
    RAISE EXCEPTION 'PO supplier does not match IP exporter/supplier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS po_item_allocation_supplier_check ON procurement.po_item_allocation;
CREATE TRIGGER po_item_allocation_supplier_check
  BEFORE INSERT OR UPDATE OF purchase_order_item_id, process_id
  ON procurement.po_item_allocation FOR EACH ROW
  EXECUTE FUNCTION procurement.check_ip_po_supplier();

CREATE OR REPLACE FUNCTION procurement.protect_allocated_ip_supplier()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.supplier_text IS DISTINCT FROM OLD.supplier_text AND EXISTS (
    SELECT 1
    FROM procurement.po_item_allocation allocation
    JOIN procurement.purchase_order_item item ON item.id = allocation.purchase_order_item_id
    JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
    WHERE allocation.process_id = OLD.id AND allocation.status = 'ACTIVE'
      AND (NEW.supplier_text IS NULL OR NOT (
        upper(btrim(po.supplier_text)) = upper(btrim(NEW.supplier_text)) OR EXISTS (
          SELECT 1 FROM catalog.entry supplier
          WHERE supplier.importer = NEW.importer AND supplier.kind = 'SUPPLIER'
            AND upper(btrim(supplier.code)) = upper(btrim(po.supplier_text))
            AND upper(btrim(supplier.name)) = upper(btrim(NEW.supplier_text))
        )
      ))
  ) THEN
    RAISE EXCEPTION 'IP supplier cannot change while an active PO allocation has another supplier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER import_process_supplier_in_use
  BEFORE UPDATE OF supplier_text ON imports.import_process
  FOR EACH ROW EXECUTE FUNCTION procurement.protect_allocated_ip_supplier();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT, INSERT, UPDATE ON procurement.purchase_request TO import_erp_app;
    GRANT INSERT (supplier_text) ON imports.import_process TO import_erp_app;
    GRANT UPDATE (supplier_text) ON imports.import_process TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT SELECT, INSERT, UPDATE ON procurement.purchase_request TO import_erp_hml_app;
    GRANT INSERT (supplier_text) ON imports.import_process TO import_erp_hml_app;
    GRANT UPDATE (supplier_text) ON imports.import_process TO import_erp_hml_app;
  END IF;
END $$;
