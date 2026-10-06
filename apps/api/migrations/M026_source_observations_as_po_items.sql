-- Make each verified PO line an actual balance-bearing PO item, with its
-- existing IP and quantity represented as an allocation when present.
DO $$
DECLARE
  incomplete_items bigint;
BEGIN
  SELECT count(*) INTO incomplete_items
    FROM procurement.po_line_observation
   WHERE quantity IS NULL OR quantity <= 0
      OR nullif(btrim(product_code_snapshot), '') IS NULL;
  IF incomplete_items > 0 THEN
    RAISE EXCEPTION 'Cannot promote % PO lines without a product code and positive quantity', incomplete_items;
  END IF;

END $$;

ALTER TABLE procurement.purchase_order_item
  ALTER COLUMN unit DROP NOT NULL,
  ADD COLUMN source_status text NULL,
  ADD COLUMN source_observation_id uuid NULL
    REFERENCES procurement.po_line_observation(source_row_id) ON DELETE RESTRICT,
  ADD CONSTRAINT uq_purchase_order_item_source_observation UNIQUE (source_observation_id);

ALTER TABLE procurement.purchase_order_item
  DROP CONSTRAINT purchase_order_item_source_kind_check,
  ADD CONSTRAINT purchase_order_item_source_kind_check
    CHECK (source_kind IN ('MANUAL_TOTVS_TRANSCRIPTION', 'IMPORTED_SOURCE_ITEM'));

WITH source_lines AS (
  SELECT observation.*,
         row_number() OVER (
           PARTITION BY observation.purchase_order_id
           ORDER BY observation.source_row_number, observation.source_row_id
         )::integer AS sequence_number,
         coalesce((SELECT max(existing.line_number)
                     FROM procurement.purchase_order_item existing
                    WHERE existing.purchase_order_id = observation.purchase_order_id), 0) AS existing_max_line
    FROM procurement.po_line_observation observation
)
INSERT INTO procurement.purchase_order_item (
  id, purchase_order_id, line_number, external_line_reference, product_code,
  description, ordered_quantity, unit, unit_price, currency_code, necessity_date,
  source_kind, source_status, source_observation_id
)
SELECT source_row_id, purchase_order_id, existing_max_line + sequence_number,
       NULL, product_code_snapshot, coalesce(nullif(btrim(description_snapshot), ''), product_code_snapshot),
       quantity, NULL,
       CASE WHEN unit_price IS NOT NULL AND currency_code IS NOT NULL THEN unit_price ELSE NULL END,
       CASE WHEN unit_price IS NOT NULL AND currency_code IS NOT NULL THEN currency_code ELSE NULL END,
       necessity_date, 'IMPORTED_SOURCE_ITEM', historical_status, source_row_id
  FROM source_lines;

INSERT INTO procurement.po_item_allocation (id, purchase_order_item_id, process_id, quantity, notes)
SELECT gen_random_uuid(), item.id, process.id, item.ordered_quantity, ''
  FROM procurement.purchase_order_item item
  JOIN procurement.po_line_observation observation
    ON observation.source_row_id = item.source_observation_id
  JOIN procurement.process_purchase_order link
    ON link.purchase_order_id = observation.purchase_order_id
  JOIN imports.import_process process
    ON process.id = link.process_id
   AND process.importer = (SELECT po.importer FROM procurement.purchase_order po
                            WHERE po.id = observation.purchase_order_id)
   AND upper(btrim(process.ip_number)) = upper(btrim(observation.source_ip_text))
 WHERE nullif(btrim(observation.source_ip_text), '') IS NOT NULL
   AND upper(coalesce(observation.historical_status, '')) NOT IN ('CANCELLED', 'CANCELED');
