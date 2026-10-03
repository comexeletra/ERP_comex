-- Expose only native request events to the API runtime role. The handler must
-- first resolve the request within the caller's importer scope.
CREATE OR REPLACE VIEW audit.import_request_history WITH (security_barrier = true) AS
SELECT id, aggregate_id, operation, field_name, old_value, new_value,
       actor_id, occurred_at, reason
FROM audit.audit_log
WHERE aggregate_type = 'IMPORT_REQUEST' AND entity_type = 'IMPORT_REQUEST';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
        GRANT USAGE ON SCHEMA audit TO import_erp_app;
        GRANT SELECT ON audit.import_request_history TO import_erp_app;
    END IF;
END;
$$;
