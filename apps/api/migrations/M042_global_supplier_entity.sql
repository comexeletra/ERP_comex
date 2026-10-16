-- Supplier is shared across importers. PO/IP importer fields remain independent;
-- allocations still require the PO and IP importers to match.
DROP TRIGGER IF EXISTS purchase_request_supplier_entity_sync ON procurement.purchase_request;
DROP TRIGGER IF EXISTS purchase_order_supplier_entity_sync ON procurement.purchase_order;
DROP TRIGGER IF EXISTS import_process_supplier_entity_sync ON imports.import_process;

ALTER TABLE catalog.entry ALTER COLUMN importer DROP NOT NULL;

WITH duplicates AS (
  SELECT id, first_value(id) OVER (
    PARTITION BY normalized_code, upper(btrim(name)) ORDER BY id
  ) AS canonical_id
  FROM catalog.entry
  WHERE kind = 'SUPPLIER'
), mapped AS (
  SELECT id, canonical_id FROM duplicates WHERE id <> canonical_id
)
UPDATE procurement.purchase_request record
SET supplier_entry_id = mapped.canonical_id
FROM mapped WHERE record.supplier_entry_id = mapped.id;

WITH duplicates AS (
  SELECT id, first_value(id) OVER (
    PARTITION BY normalized_code, upper(btrim(name)) ORDER BY id
  ) AS canonical_id
  FROM catalog.entry WHERE kind = 'SUPPLIER'
), mapped AS (SELECT id, canonical_id FROM duplicates WHERE id <> canonical_id)
UPDATE procurement.purchase_order record
SET supplier_entry_id = mapped.canonical_id
FROM mapped WHERE record.supplier_entry_id = mapped.id;

WITH duplicates AS (
  SELECT id, first_value(id) OVER (
    PARTITION BY normalized_code, upper(btrim(name)) ORDER BY id
  ) AS canonical_id
  FROM catalog.entry WHERE kind = 'SUPPLIER'
), mapped AS (SELECT id, canonical_id FROM duplicates WHERE id <> canonical_id)
UPDATE imports.import_process record
SET supplier_entry_id = mapped.canonical_id
FROM mapped WHERE record.supplier_entry_id = mapped.id;

WITH duplicates AS (
  SELECT id, first_value(id) OVER (
    PARTITION BY normalized_code, upper(btrim(name)) ORDER BY id
  ) AS canonical_id
  FROM catalog.entry WHERE kind = 'SUPPLIER'
), aliases AS (
  SELECT alias.id, row_number() OVER (
    PARTITION BY coalesce(duplicates.canonical_id, alias.entry_id), alias.raw_code
    ORDER BY alias.id
  ) AS occurrence
  FROM catalog.entry_alias alias
  LEFT JOIN duplicates ON duplicates.id = alias.entry_id
  WHERE duplicates.id IS NOT NULL
)
DELETE FROM catalog.entry_alias alias USING aliases
WHERE alias.id = aliases.id AND aliases.occurrence > 1;

WITH duplicates AS (
  SELECT id, first_value(id) OVER (
    PARTITION BY normalized_code, upper(btrim(name)) ORDER BY id
  ) AS canonical_id
  FROM catalog.entry WHERE kind = 'SUPPLIER'
), mapped AS (SELECT id, canonical_id FROM duplicates WHERE id <> canonical_id)
UPDATE catalog.entry_alias alias SET entry_id = mapped.canonical_id
FROM mapped WHERE alias.entry_id = mapped.id;

WITH duplicates AS (
  SELECT id, first_value(id) OVER (
    PARTITION BY normalized_code, upper(btrim(name)) ORDER BY id
  ) AS canonical_id
  FROM catalog.entry WHERE kind = 'SUPPLIER'
), mapped AS (SELECT id, canonical_id FROM duplicates WHERE id <> canonical_id)
UPDATE catalog.command_receipt receipt SET entry_id = mapped.canonical_id
FROM mapped WHERE receipt.entry_id = mapped.id;

WITH supplier_status AS (
  SELECT normalized_code, upper(btrim(name)) AS normalized_name, bool_or(status = 'ACTIVE') AS any_active
  FROM catalog.entry WHERE kind = 'SUPPLIER' GROUP BY normalized_code, upper(btrim(name))
), canonical AS (
  SELECT DISTINCT ON (normalized_code, upper(btrim(name))) id, normalized_code,
         upper(btrim(name)) AS normalized_name
  FROM catalog.entry WHERE kind = 'SUPPLIER' ORDER BY normalized_code, upper(btrim(name)), id
)
UPDATE catalog.entry entry SET status = CASE WHEN supplier_status.any_active THEN 'ACTIVE' ELSE 'INACTIVE' END
FROM canonical JOIN supplier_status USING (normalized_code, normalized_name)
WHERE entry.id = canonical.id;

WITH duplicates AS (
  SELECT id, first_value(id) OVER (
    PARTITION BY normalized_code, upper(btrim(name)) ORDER BY id
  ) AS canonical_id
  FROM catalog.entry WHERE kind = 'SUPPLIER'
), mapped AS (SELECT id, canonical_id FROM duplicates WHERE id <> canonical_id)
UPDATE audit.audit_log event
SET aggregate_id = mapped.canonical_id, entity_id = mapped.canonical_id
FROM mapped
WHERE event.aggregate_type = 'CATALOG_ENTRY' AND event.entity_type = 'CATALOG_ENTRY'
  AND (event.aggregate_id = mapped.id OR event.entity_id = mapped.id);

UPDATE catalog.entry SET importer = NULL WHERE kind = 'SUPPLIER';

WITH duplicates AS (
  SELECT id, first_value(id) OVER (
    PARTITION BY normalized_code, upper(btrim(name)) ORDER BY id
  ) AS canonical_id
  FROM catalog.entry WHERE kind = 'SUPPLIER'
)
DELETE FROM catalog.entry entry USING duplicates
WHERE entry.id = duplicates.id AND duplicates.id <> duplicates.canonical_id;

ALTER TABLE catalog.entry ADD CONSTRAINT catalog_supplier_global_importer_check
  CHECK ((kind = 'SUPPLIER' AND importer IS NULL)
      OR (kind <> 'SUPPLIER' AND importer IS NOT NULL));
CREATE UNIQUE INDEX ux_catalog_global_supplier_name_code
  ON catalog.entry (normalized_code, upper(btrim(name))) WHERE kind = 'SUPPLIER';

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

CREATE TRIGGER purchase_request_supplier_entity_sync
  BEFORE INSERT OR UPDATE OF importer, supplier_text, supplier_entry_id ON procurement.purchase_request
  FOR EACH ROW EXECUTE FUNCTION catalog.sync_supplier_entity_reference();
CREATE TRIGGER purchase_order_supplier_entity_sync
  BEFORE INSERT OR UPDATE OF importer, purchase_request_id, supplier_text, supplier_entry_id ON procurement.purchase_order
  FOR EACH ROW EXECUTE FUNCTION catalog.sync_supplier_entity_reference();
CREATE TRIGGER import_process_supplier_entity_sync
  BEFORE INSERT OR UPDATE OF importer, supplier_text, supplier_entry_id ON imports.import_process
  FOR EACH ROW EXECUTE FUNCTION catalog.sync_supplier_entity_reference();

CREATE OR REPLACE FUNCTION procurement.protect_allocated_po_supplier()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.supplier_text IS DISTINCT FROM OLD.supplier_text AND EXISTS (
    SELECT 1 FROM procurement.purchase_order_item item
    JOIN procurement.po_item_allocation allocation
      ON allocation.purchase_order_item_id = item.id AND allocation.status = 'ACTIVE'
    JOIN imports.import_process process ON process.id = allocation.process_id
    WHERE item.purchase_order_id = OLD.id
      AND NEW.supplier_entry_id IS DISTINCT FROM process.supplier_entry_id
  ) THEN
    RAISE EXCEPTION 'PO supplier cannot change while an active IP allocation has another supplier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.protect_allocated_ip_supplier()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.supplier_text IS DISTINCT FROM OLD.supplier_text AND EXISTS (
    SELECT 1 FROM procurement.po_item_allocation allocation
    JOIN procurement.purchase_order_item item ON item.id = allocation.purchase_order_item_id
    JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
    WHERE allocation.process_id = OLD.id AND allocation.status = 'ACTIVE'
      AND NEW.supplier_entry_id IS DISTINCT FROM po.supplier_entry_id
  ) THEN
    RAISE EXCEPTION 'IP supplier cannot change while an active PO allocation has another supplier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
