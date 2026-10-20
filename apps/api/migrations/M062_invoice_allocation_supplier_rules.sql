-- M040 still checks the supplier snapshot when an invoice allocation is
-- inserted. Explicitly confirmed invoice divergences must keep the Exporter
-- snapshot and the PO supplier without pretending that the entities match.
CREATE OR REPLACE FUNCTION procurement.check_ip_po_supplier()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  po_supplier varchar(240);
  ip_supplier varchar(240);
  ip_importer varchar(120);
  po_importer varchar(120);
  ip_source_kind varchar(32);
  ip_supplier_divergence boolean;
  supplier_matches boolean;
BEGIN
  SELECT po.supplier_text, po.importer
    INTO po_supplier, po_importer
    FROM procurement.purchase_order_item item
    JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
   WHERE item.id = NEW.purchase_order_item_id;
  SELECT supplier_text, importer, source_kind, invoice_supplier_divergence
    INTO ip_supplier, ip_importer, ip_source_kind, ip_supplier_divergence
    FROM imports.import_process WHERE id = NEW.process_id;

  IF po_importer IS DISTINCT FROM ip_importer THEN
    RAISE EXCEPTION 'PO and IP must belong to the same importer' USING ERRCODE = '23514';
  END IF;
  IF nullif(btrim(po_supplier), '') IS NULL OR nullif(btrim(ip_supplier), '') IS NULL THEN
    RAISE EXCEPTION 'PO and IP must have a supplier before allocation' USING ERRCODE = '23514';
  END IF;
  IF ip_source_kind = 'CHINA_INVOICE' AND ip_supplier_divergence THEN
    RETURN NEW;
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

-- Keep the M041 entity requirement on the PO. Only the invoice IP is allowed
-- to omit its supplier entity when the explicit divergence flag is set.
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
  IF NEW.status = 'ACTIVE' AND po_supplier IS NULL THEN
    RAISE EXCEPTION 'PO must reference a supplier entity before allocation' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'ACTIVE'
     AND NOT (ip_source_kind = 'CHINA_INVOICE' AND ip_supplier_divergence)
     AND (ip_supplier IS NULL OR po_supplier IS DISTINCT FROM ip_supplier) THEN
    RAISE EXCEPTION 'PO supplier entity must match IP supplier entity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
