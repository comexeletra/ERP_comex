ALTER TABLE imports.process_document
  ADD COLUMN amount numeric(24,8) CHECK (amount >= 0),
  ADD CONSTRAINT process_document_amount_kind CHECK (kind = 'INVOICE' OR amount IS NULL);

-- The row lock serializes document insertion with cancellation of its allocation.
CREATE OR REPLACE FUNCTION imports.check_process_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item_importer text;
  process_importer text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.process_id <> OLD.process_id OR
      NEW.purchase_order_item_id IS DISTINCT FROM OLD.purchase_order_item_id OR
      NEW.kind <> OLD.kind OR OLD.status = 'CANCELLED') THEN
    RAISE EXCEPTION 'Document identity or cancelled document cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF NEW.purchase_order_item_id IS NOT NULL THEN
    SELECT po.importer INTO item_importer FROM procurement.purchase_order_item item
      JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
      WHERE item.id = NEW.purchase_order_item_id;
    SELECT importer INTO process_importer FROM imports.import_process WHERE id = NEW.process_id;
    IF item_importer IS DISTINCT FROM process_importer THEN
      RAISE EXCEPTION 'Document and item importers differ' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM procurement.po_item_allocation a
      WHERE a.process_id = NEW.process_id AND a.purchase_order_item_id = NEW.purchase_order_item_id
        AND a.status = 'ACTIVE' FOR UPDATE OF a;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Document item must be actively allocated to the IP' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
