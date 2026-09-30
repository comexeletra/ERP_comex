\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- Execute only against the selected ERP database or a restored copy.
DO $$
DECLARE
  counts integer[];
BEGIN
  SELECT ARRAY[
    (SELECT count(*)::int FROM migration.source_row),
    (SELECT count(*)::int FROM procurement.purchase_order),
    (SELECT count(*)::int FROM procurement.po_line_observation),
    (SELECT count(*)::int FROM imports.import_process),
    (SELECT count(*)::int FROM procurement.process_purchase_order),
    (SELECT count(*)::int FROM costs.process_cost),
    (SELECT count(*)::int FROM migration.data_issue)
  ] INTO counts;
  IF counts <> ARRAY[7130, 336, 6796, 200, 449, 422, 451] THEN
    RAISE EXCEPTION 'RF06 source counts differ: %', counts;
  END IF;

  IF (SELECT count(*) FROM procurement.po_line_observation AS obs
      JOIN procurement.purchase_order AS po ON po.id = obs.purchase_order_id
      WHERE po.importer = 'ELETRA MATRIZ' AND po.normalized_number = '18751') <> 8 THEN
    RAISE EXCEPTION 'PO 18751 observations differ';
  END IF;
  IF (SELECT count(*) FROM procurement.po_line_observation AS obs
      JOIN procurement.purchase_order AS po ON po.id = obs.purchase_order_id
      WHERE po.importer = 'ELETRA MATRIZ' AND po.normalized_number = '18223') <> 2 THEN
    RAISE EXCEPTION 'PO 18223 observations differ';
  END IF;
  IF (SELECT count(*) FROM procurement.process_purchase_order AS link
      JOIN imports.import_process AS process ON process.id = link.process_id
      WHERE process.normalized_ip_number = 'NH-017/2025') <> 4 THEN
    RAISE EXCEPTION 'Shared IP links differ';
  END IF;
  IF (SELECT count(*) FROM costs.process_cost AS cost
      JOIN imports.import_process AS process ON process.id = cost.process_id
      WHERE process.normalized_ip_number = 'NH-017/2025'
        AND cost.source_column = 'W' AND cost.amount = 17520) <> 1 THEN
    RAISE EXCEPTION 'Shared IP freight is missing or duplicated';
  END IF;
END $$;

SELECT po.external_number AS po, po.importer,
       count(DISTINCT obs.id) AS historical_lines,
       count(DISTINCT link.process_id) AS linked_ips,
       count(DISTINCT obs.raw_values ->> 'R') AS source_supplier_values,
       min(source.sheet_name) AS source_sheet,
       min(source.row_number) AS first_source_row
FROM procurement.purchase_order AS po
JOIN procurement.po_line_observation AS obs ON obs.purchase_order_id = po.id
JOIN migration.source_row AS source ON source.id = obs.source_row_id
LEFT JOIN procurement.process_purchase_order AS link ON link.purchase_order_id = po.id
WHERE po.importer = 'ELETRA MATRIZ' AND po.normalized_number IN ('18751', '18223', '6817')
GROUP BY po.id, po.external_number, po.importer
ORDER BY po.external_number;

SELECT process.ip_number, count(DISTINCT link.purchase_order_id) AS linked_pos,
       count(DISTINCT cost.id) AS cost_records,
       max(cost.amount) FILTER (WHERE cost.source_column = 'W') AS freight_amount,
       max(cost.amount) FILTER (WHERE cost.source_column = 'AQ') AS storage_amount
FROM imports.import_process AS process
JOIN procurement.process_purchase_order AS link ON link.process_id = process.id
LEFT JOIN costs.process_cost AS cost ON cost.process_id = process.id
WHERE process.normalized_ip_number = 'NH-017/2025'
GROUP BY process.id, process.ip_number;

ROLLBACK;
