-- Supplier is a catalog entity. Operational records keep a restrictive FK to
-- that entity; supplier_text remains a compatibility/display snapshot.
ALTER TABLE procurement.purchase_request
  ADD COLUMN supplier_entry_id uuid NULL REFERENCES catalog.entry(id) ON DELETE RESTRICT;
ALTER TABLE procurement.purchase_order
  ADD COLUMN supplier_entry_id uuid NULL REFERENCES catalog.entry(id) ON DELETE RESTRICT;
ALTER TABLE imports.import_process
  ADD COLUMN supplier_entry_id uuid NULL REFERENCES catalog.entry(id) ON DELETE RESTRICT;

CREATE INDEX ix_purchase_request_supplier_entity
  ON procurement.purchase_request (supplier_entry_id) WHERE supplier_entry_id IS NOT NULL;
CREATE INDEX ix_purchase_order_supplier_entity
  ON procurement.purchase_order (supplier_entry_id) WHERE supplier_entry_id IS NOT NULL;
CREATE INDEX ix_import_process_supplier_entity
  ON imports.import_process (supplier_entry_id) WHERE supplier_entry_id IS NOT NULL;

-- Attach existing values only when exactly one supplier entity matches by code
-- or name in the same importer. Ambiguous and unmatched legacy values stay
-- visible as text and can be reconciled by selecting the correct entity.
WITH matches AS (
  SELECT sc.id AS record_id, min(supplier.id::text)::uuid AS supplier_entry_id
  FROM procurement.purchase_request sc
  JOIN catalog.entry supplier ON supplier.importer = sc.importer AND supplier.kind = 'SUPPLIER'
    AND (supplier.normalized_code = upper(btrim(sc.supplier_text))
      OR upper(btrim(supplier.name)) = upper(btrim(sc.supplier_text)))
  WHERE nullif(btrim(sc.supplier_text), '') IS NOT NULL
  GROUP BY sc.id HAVING count(DISTINCT supplier.id) = 1
)
UPDATE procurement.purchase_request sc SET supplier_entry_id = matches.supplier_entry_id
FROM matches WHERE sc.id = matches.record_id;

WITH matches AS (
  SELECT po.id AS record_id, min(supplier.id::text)::uuid AS supplier_entry_id
  FROM procurement.purchase_order po
  JOIN catalog.entry supplier ON supplier.importer = po.importer AND supplier.kind = 'SUPPLIER'
    AND (supplier.normalized_code = upper(btrim(po.supplier_text))
      OR upper(btrim(supplier.name)) = upper(btrim(po.supplier_text)))
  WHERE nullif(btrim(po.supplier_text), '') IS NOT NULL
  GROUP BY po.id HAVING count(DISTINCT supplier.id) = 1
)
UPDATE procurement.purchase_order po SET supplier_entry_id = matches.supplier_entry_id
FROM matches WHERE po.id = matches.record_id;

WITH matches AS (
  SELECT process.id AS record_id, min(supplier.id::text)::uuid AS supplier_entry_id
  FROM imports.import_process process
  JOIN catalog.entry supplier ON supplier.importer = process.importer AND supplier.kind = 'SUPPLIER'
    AND (supplier.normalized_code = upper(btrim(process.supplier_text))
      OR upper(btrim(supplier.name)) = upper(btrim(process.supplier_text)))
  WHERE nullif(btrim(process.supplier_text), '') IS NOT NULL
  GROUP BY process.id HAVING count(DISTINCT supplier.id) = 1
)
UPDATE imports.import_process process SET supplier_entry_id = matches.supplier_entry_id
FROM matches WHERE process.id = matches.record_id;

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

  IF NEW.supplier_entry_id IS NOT NULL THEN
    SELECT * INTO supplier FROM catalog.entry WHERE id = NEW.supplier_entry_id;
    IF NOT FOUND OR supplier.importer <> NEW.importer OR supplier.kind <> 'SUPPLIER' THEN
      RAISE EXCEPTION 'Supplier entity must belong to the record importer' USING ERRCODE = '23514';
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
  WHERE importer = NEW.importer AND kind = 'SUPPLIER'
    AND (normalized_code = upper(btrim(NEW.supplier_text))
      OR upper(btrim(name)) = upper(btrim(NEW.supplier_text)));

  IF match_count = 1 THEN
    SELECT code INTO NEW.supplier_text FROM catalog.entry WHERE id = NEW.supplier_entry_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.supplier_text IS DISTINCT FROM OLD.supplier_text THEN
    RAISE EXCEPTION 'Select a supplier entity from the importer catalog' USING ERRCODE = '23514';
  END IF;
  NEW.supplier_entry_id := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_request_supplier_entity_sync
  BEFORE INSERT OR UPDATE OF importer, supplier_text, supplier_entry_id ON procurement.purchase_request
  FOR EACH ROW EXECUTE FUNCTION catalog.sync_supplier_entity_reference();
CREATE TRIGGER purchase_order_supplier_entity_sync
  BEFORE INSERT OR UPDATE OF importer, purchase_request_id, supplier_text, supplier_entry_id ON procurement.purchase_order
  FOR EACH ROW EXECUTE FUNCTION catalog.sync_supplier_entity_reference();
CREATE TRIGGER import_process_supplier_entity_sync
  BEFORE INSERT OR UPDATE OF importer, supplier_text, supplier_entry_id ON imports.import_process
  FOR EACH ROW EXECUTE FUNCTION catalog.sync_supplier_entity_reference();

CREATE OR REPLACE FUNCTION procurement.check_supplier_entity_allocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  po_supplier uuid;
  ip_supplier uuid;
  po_importer varchar(120);
  ip_importer varchar(120);
BEGIN
  SELECT po.supplier_entry_id, po.importer INTO po_supplier, po_importer
  FROM procurement.purchase_order_item item
  JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
  WHERE item.id = NEW.purchase_order_item_id;
  SELECT supplier_entry_id, importer INTO ip_supplier, ip_importer
  FROM imports.import_process WHERE id = NEW.process_id;

  IF po_importer IS DISTINCT FROM ip_importer THEN
    RAISE EXCEPTION 'PO and IP must belong to the same importer' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'ACTIVE' AND (po_supplier IS NULL OR ip_supplier IS NULL) THEN
    RAISE EXCEPTION 'PO and IP must reference supplier entities before allocation' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'ACTIVE' AND po_supplier IS DISTINCT FROM ip_supplier THEN
    RAISE EXCEPTION 'PO supplier entity must match IP supplier entity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER po_item_allocation_supplier_entity_check
  BEFORE INSERT OR UPDATE OF purchase_order_item_id, process_id, status ON procurement.po_item_allocation
  FOR EACH ROW EXECUTE FUNCTION procurement.check_supplier_entity_allocation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT (supplier_entry_id), INSERT (supplier_entry_id), UPDATE (supplier_entry_id)
      ON procurement.purchase_request TO import_erp_app;
    GRANT SELECT (supplier_entry_id), INSERT (supplier_entry_id), UPDATE (supplier_entry_id)
      ON procurement.purchase_order TO import_erp_app;
    GRANT SELECT (supplier_entry_id), INSERT (supplier_entry_id), UPDATE (supplier_entry_id)
      ON imports.import_process TO import_erp_app;
    GRANT SELECT ON catalog.entry TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT SELECT (supplier_entry_id), INSERT (supplier_entry_id), UPDATE (supplier_entry_id)
      ON procurement.purchase_request TO import_erp_hml_app;
    GRANT SELECT (supplier_entry_id), INSERT (supplier_entry_id), UPDATE (supplier_entry_id)
      ON procurement.purchase_order TO import_erp_hml_app;
    GRANT SELECT (supplier_entry_id), INSERT (supplier_entry_id), UPDATE (supplier_entry_id)
      ON imports.import_process TO import_erp_hml_app;
    GRANT SELECT ON catalog.entry TO import_erp_hml_app;
  END IF;
END;
$$;
