ALTER TABLE imports.import_process
  ADD COLUMN invoice_supplier_divergence boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT import_process_invoice_supplier_divergence_check CHECK (
    NOT invoice_supplier_divergence OR (
      source_kind = 'CHINA_INVOICE'
      AND supplier_entry_id IS NULL
      AND nullif(btrim(supplier_text), '') IS NOT NULL
    )
  );

-- An invoice can name an Exporter that is different from the supplier entity
-- on the selected PO. The API requires an explicit confirmation and persists
-- that exceptional state instead of replacing either business value.
CREATE OR REPLACE FUNCTION catalog.sync_supplier_entity_reference()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  supplier catalog.entry%ROWTYPE;
  match_count integer;
BEGIN
  IF TG_TABLE_NAME = 'purchase_order'
     AND nullif(to_jsonb(NEW)->>'purchase_request_id', '') IS NOT NULL THEN
    SELECT supplier_entry_id, supplier_text INTO NEW.supplier_entry_id, NEW.supplier_text
    FROM procurement.purchase_request
    WHERE id = (to_jsonb(NEW)->>'purchase_request_id')::uuid
      AND importer = (to_jsonb(NEW)->>'importer');
  END IF;

  IF TG_TABLE_NAME = 'import_process'
     AND coalesce((to_jsonb(NEW)->>'invoice_supplier_divergence')::boolean, false) THEN
    IF to_jsonb(NEW)->>'source_kind' <> 'CHINA_INVOICE'
       OR NEW.supplier_entry_id IS NOT NULL
       OR nullif(btrim(NEW.supplier_text), '') IS NULL THEN
      RAISE EXCEPTION 'Invoice supplier divergence requires an Exporter snapshot without a supplier entity'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.supplier_entry_id IS NOT NULL THEN
    SELECT * INTO supplier FROM catalog.entry
    WHERE id = NEW.supplier_entry_id AND kind = 'SUPPLIER' AND importer IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Supplier entity must be selected from the global supplier catalog' USING ERRCODE = '23514';
    END IF;
    NEW.supplier_text := supplier.code;
    RETURN NEW;
  END IF;

  IF nullif(btrim(NEW.supplier_text), '') IS NULL THEN
    NEW.supplier_entry_id := NULL;
    RETURN NEW;
  END IF;

  SELECT count(*)::integer, min(id::text)::uuid INTO match_count, NEW.supplier_entry_id
  FROM catalog.entry
  WHERE importer IS NULL AND kind = 'SUPPLIER'
    AND (normalized_code = upper(btrim(NEW.supplier_text))
      OR upper(btrim(name)) = upper(btrim(NEW.supplier_text)));

  IF match_count = 1 THEN
    SELECT code INTO NEW.supplier_text FROM catalog.entry WHERE id = NEW.supplier_entry_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.supplier_text IS DISTINCT FROM OLD.supplier_text THEN
    RAISE EXCEPTION 'Select a supplier entity from the global catalog' USING ERRCODE = '23514';
  END IF;
  NEW.supplier_entry_id := NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.check_supplier_entity_allocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  po_supplier uuid;
  ip_supplier uuid;
  po_importer varchar(120);
  ip_importer varchar(120);
  ip_source_kind varchar(32);
  ip_supplier_divergence boolean;
BEGIN
  SELECT po.supplier_entry_id, po.importer INTO po_supplier, po_importer
  FROM procurement.purchase_order_item item
  JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
  WHERE item.id = NEW.purchase_order_item_id;
  SELECT supplier_entry_id, importer, source_kind, invoice_supplier_divergence
    INTO ip_supplier, ip_importer, ip_source_kind, ip_supplier_divergence
  FROM imports.import_process WHERE id = NEW.process_id;

  IF po_importer IS DISTINCT FROM ip_importer THEN
    RAISE EXCEPTION 'PO and IP must belong to the same importer' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'ACTIVE'
     AND NOT (ip_source_kind = 'CHINA_INVOICE' AND ip_supplier_divergence)
     AND (po_supplier IS NULL OR ip_supplier IS NULL OR po_supplier IS DISTINCT FROM ip_supplier) THEN
    RAISE EXCEPTION 'PO supplier entity must match IP supplier entity' USING ERRCODE = '23514';
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
    IF NEW.record_status <> 'ACTIVE' AND EXISTS (
      SELECT 1 FROM imports.process_document document
      WHERE document.process_id = NEW.id AND document.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'Cancel active documents before changing IP record status' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM procurement.po_item_allocation allocation
    JOIN imports.import_process process ON process.id = allocation.process_id
    WHERE allocation.status = 'ACTIVE' AND process.record_status <> 'ACTIVE'
  ) OR EXISTS (
    SELECT 1 FROM imports.process_document document
    JOIN imports.import_process process ON process.id = document.process_id
    WHERE document.status = 'ACTIVE' AND process.record_status <> 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Non-active IPs must not retain active allocations or documents';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT (invoice_supplier_divergence), INSERT (invoice_supplier_divergence), UPDATE (invoice_supplier_divergence)
      ON imports.import_process TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT SELECT (invoice_supplier_divergence), INSERT (invoice_supplier_divergence), UPDATE (invoice_supplier_divergence)
      ON imports.import_process TO import_erp_hml_app;
  END IF;
END $$;
