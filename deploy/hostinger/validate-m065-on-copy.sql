\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  po_id uuid;
  po_number varchar(80);
  next_line integer;
  test_product_id uuid;
  product_code varchar(120);
  test_item_id uuid := gen_random_uuid();
  test_actor text := 'm065-copy-validation';
BEGIN
  IF current_database() NOT LIKE 'erp_po_hml_m065_copy_%' THEN
    RAISE EXCEPTION 'M065 trigger validation must run only on the disposable HML restore copy';
  END IF;
  IF (SELECT count(*) FROM migration.schema_migration) <> 65
     OR (SELECT max(version) FROM migration.schema_migration) <> 'M065_product_price_observations.sql'
     OR (SELECT count(*) FROM catalog.product_price_observation) <> 0
     OR (SELECT count(*) FROM catalog.product_totvs_description_observation) <> 0 THEN
    RAISE EXCEPTION 'The restored copy must be at M065 with empty observation tables';
  END IF;

  SELECT purchase_order.id, purchase_order.external_number,
         coalesce(max(item.line_number), 0) + 1
    INTO po_id, po_number, next_line
    FROM procurement.purchase_order AS purchase_order
    LEFT JOIN procurement.purchase_order_item AS item
      ON item.purchase_order_id = purchase_order.id
   WHERE purchase_order.lifecycle_status = 'ACTIVE'
   GROUP BY purchase_order.id, purchase_order.external_number
   ORDER BY purchase_order.external_number
   LIMIT 1;
  IF po_id IS NULL THEN
    RAISE EXCEPTION 'Restored HML copy must contain an active PO for trigger validation';
  END IF;

  SELECT entry.id, entry.code
    INTO test_product_id, product_code
    FROM catalog.entry AS entry
   WHERE entry.kind = 'PRODUCT' AND entry.importer IS NULL
   ORDER BY entry.normalized_code
   LIMIT 1;
  IF product_code IS NULL THEN
    RAISE EXCEPTION 'Restored HML copy must contain a global product';
  END IF;

  PERFORM set_config('app.actor_id', test_actor, true);
  INSERT INTO procurement.purchase_order_item (
    id, purchase_order_id, line_number, external_line_reference, product_code,
    description, ordered_quantity, unit, unit_price, currency_code,
    source_kind, source_status
  ) VALUES (
    test_item_id, po_id, next_line, 'M065-COPY-VALIDATION', product_code,
    'M065 synthetic TOTVS description', 1, 'UN', 12.34567890, 'CNY',
    'MANUAL_TOTVS_TRANSCRIPTION', NULL
  );

  IF (SELECT count(*) FROM catalog.product_price_observation
       WHERE purchase_order_item_id = test_item_id AND currency_code = 'CNY'
         AND unit_price = 12.34567890 AND purchase_order_number = po_number
         AND actor_id = test_actor) <> 1 THEN
    RAISE EXCEPTION 'Positive price INSERT did not create the expected CNY observation';
  END IF;
  IF (SELECT count(*) FROM catalog.product_totvs_description_observation
       WHERE purchase_order_item_id = test_item_id
         AND description = 'M065 synthetic TOTVS description'
         AND purchase_order_number = po_number AND actor_id = test_actor) <> 1 THEN
    RAISE EXCEPTION 'INSERT did not capture the TOTVS description and actor';
  END IF;

  UPDATE procurement.purchase_order_item
     SET description = 'M065 updated TOTVS description'
   WHERE id = test_item_id;
  IF (SELECT count(*) FROM catalog.product_totvs_description_observation
       WHERE purchase_order_item_id = test_item_id) <> 2 THEN
    RAISE EXCEPTION 'Description UPDATE did not create a new observation';
  END IF;

  UPDATE procurement.purchase_order_item
     SET unit_price = 0, currency_code = 'CNY'
   WHERE id = test_item_id;
  IF (SELECT count(*) FROM catalog.product_price_observation
       WHERE purchase_order_item_id = test_item_id) <> 1 THEN
    RAISE EXCEPTION 'Zero price must not create a price observation';
  END IF;

  UPDATE procurement.purchase_order_item
     SET unit_price = 4.321, currency_code = 'USD'
   WHERE id = test_item_id;
  IF (SELECT count(*) FROM catalog.product_price_observation
       WHERE purchase_order_item_id = test_item_id AND currency_code = 'USD'
         AND unit_price = 4.321) <> 1
     OR (SELECT count(*) FROM catalog.product_price_reference
          WHERE product_id = test_product_id) <> 2 THEN
    RAISE EXCEPTION 'Price UPDATE did not retain separate CNY and USD references';
  END IF;

  UPDATE procurement.purchase_order_item
     SET product_code = 'M065-UNKNOWN-' || replace(test_item_id::text, '-', ''),
         description = 'M065 uncatalogued item', unit_price = 8, currency_code = 'EUR'
   WHERE id = test_item_id;
  IF (SELECT count(*) FROM catalog.product_price_observation
       WHERE purchase_order_item_id = test_item_id) <> 2
     OR (SELECT count(*) FROM catalog.product_totvs_description_observation
          WHERE purchase_order_item_id = test_item_id) <> 2 THEN
    RAISE EXCEPTION 'An item without a global catalog product must not create observations';
  END IF;
END
$$;

ROLLBACK;

DO $$
BEGIN
  IF current_database() NOT LIKE 'erp_po_hml_m065_copy_%'
     OR (SELECT count(*) FROM catalog.product_price_observation) <> 0
     OR (SELECT count(*) FROM catalog.product_totvs_description_observation) <> 0
     OR (SELECT count(*) FROM procurement.purchase_order_item) <> 215 THEN
    RAISE EXCEPTION 'M065 validation rollback did not restore the copy to its baseline';
  END IF;
END
$$;

SELECT 'M065 trigger validation passed; transaction rolled back.' AS result;
