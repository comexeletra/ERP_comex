BEGIN TRANSACTION READ ONLY;
SELECT (SELECT count(*) FROM migration.source_row) AS source_rows,
       (SELECT count(*) FROM procurement.purchase_order) AS purchase_orders,
       (SELECT count(*) FROM procurement.po_line_observation) AS historical_observations,
       (SELECT count(*) FROM imports.import_process) AS processes,
       (SELECT count(*) FROM procurement.process_purchase_order) AS po_ip_links,
       (SELECT count(*) FROM costs.process_cost) AS historical_costs,
       (SELECT count(*) FROM migration.data_issue) AS quality_issues,
       (SELECT count(*) FROM procurement.import_request) AS native_requests;
SELECT count(*) AS applied_migrations,
       bool_or(version = 'M011_native_requests.sql') AS m011_applied
FROM migration.schema_migration;
SELECT has_schema_privilege('import_erp_app', 'procurement', 'USAGE') AS schema_usage,
       (has_table_privilege('import_erp_app', 'procurement.import_request', 'SELECT')
        AND has_table_privilege('import_erp_app', 'procurement.import_request', 'INSERT')
        AND has_table_privilege('import_erp_app', 'procurement.import_request', 'UPDATE')) AS request_permissions,
       (has_table_privilege('import_erp_app', 'procurement.import_request_item', 'SELECT')
        AND has_table_privilege('import_erp_app', 'procurement.import_request_item', 'INSERT')) AS item_permissions,
       has_sequence_privilege('import_erp_app', 'procurement.import_request_number_seq', 'USAGE') AS number_sequence_usage;
COMMIT;
