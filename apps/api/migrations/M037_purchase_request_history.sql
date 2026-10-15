-- Expose only SC events to the API runtime role. The route checks importer scope first.
CREATE OR REPLACE VIEW audit.purchase_request_history WITH (security_barrier = true) AS
SELECT id, aggregate_id, operation, old_value, new_value, actor_id, occurred_at, reason
FROM audit.audit_log
WHERE aggregate_type = 'PURCHASE_REQUEST' AND entity_type = 'PURCHASE_REQUEST';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT USAGE ON SCHEMA audit TO import_erp_app;
    GRANT SELECT ON audit.purchase_request_history TO import_erp_app;
  END IF;
END;
$$;
