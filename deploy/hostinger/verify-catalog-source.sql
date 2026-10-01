BEGIN TRANSACTION READ ONLY;
SELECT po.importer,
       count(DISTINCT nullif(btrim(obs.raw_values->>'R'), '')) AS supplier_names_trimmed,
       count(DISTINCT nullif(btrim(obs.raw_values->>'T'), '')) AS product_codes_trimmed,
       count(DISTINCT nullif(btrim(obs.raw_values->>'V'), '')) AS ncm_values_trimmed,
       count(*) FILTER (WHERE nullif(btrim(obs.raw_values->>'V'), '') IS NOT NULL
                           AND btrim(obs.raw_values->>'V') !~ '^[0-9]{8}$') AS ncm_observations_invalid_format,
       count(*) AS po_observations
FROM procurement.po_line_observation AS obs
JOIN procurement.purchase_order AS po ON po.id = obs.purchase_order_id
GROUP BY po.importer
ORDER BY po.importer;
SELECT to_regclass('catalog.entry') IS NOT NULL AS m010_table_exists;
COMMIT;
