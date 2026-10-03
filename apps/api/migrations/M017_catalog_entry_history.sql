-- Give the API read access only to catalog change events, never to the full audit log.
CREATE OR REPLACE VIEW audit.catalog_entry_history WITH (security_barrier = true) AS
SELECT id, aggregate_id, operation, field_name, old_value, new_value,
       actor_id, occurred_at, reason
FROM audit.audit_log
WHERE aggregate_type = 'CATALOG_ENTRY' AND entity_type = 'CATALOG_ENTRY';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
        GRANT USAGE ON SCHEMA audit TO import_erp_app;
        GRANT SELECT ON audit.catalog_entry_history TO import_erp_app;
    END IF;
END;
$$;
