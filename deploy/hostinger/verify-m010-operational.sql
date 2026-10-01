BEGIN TRANSACTION READ ONLY;
SELECT (SELECT count(*) FROM migration.source_row) AS source_rows,
       (SELECT count(*) FROM procurement.purchase_order) AS purchase_orders,
       (SELECT count(*) FROM procurement.po_line_observation) AS historical_observations,
       (SELECT count(*) FROM imports.import_process) AS processes,
       (SELECT count(*) FROM procurement.process_purchase_order) AS po_ip_links,
       (SELECT count(*) FROM costs.process_cost) AS historical_costs,
       (SELECT count(*) FROM migration.data_issue) AS quality_issues,
       (SELECT count(*) FROM catalog.entry) AS reviewed_entries;
SELECT count(*) AS applied_migrations,
       bool_or(version = 'M010_catalog_review.sql') AS m010_applied
FROM migration.schema_migration;
SELECT has_schema_privilege('import_erp_app', 'catalog', 'USAGE') AS schema_usage,
       (has_table_privilege('import_erp_app', 'catalog.entry', 'SELECT')
        AND has_table_privilege('import_erp_app', 'catalog.entry', 'INSERT')
        AND has_table_privilege('import_erp_app', 'catalog.entry', 'UPDATE')) AS entry_permissions,
       (has_table_privilege('import_erp_app', 'catalog.entry_alias', 'SELECT')
        AND has_table_privilege('import_erp_app', 'catalog.entry_alias', 'INSERT')) AS alias_permissions,
       (has_table_privilege('import_erp_app', 'catalog.command_receipt', 'SELECT')
        AND has_table_privilege('import_erp_app', 'catalog.command_receipt', 'INSERT')) AS receipt_permissions;
COMMIT;
