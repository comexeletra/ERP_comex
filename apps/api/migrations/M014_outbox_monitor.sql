-- Expose queue metadata to the runtime API without granting access to payloads
-- or error text. Only Master routes may query this view.
CREATE OR REPLACE VIEW audit.outbox_monitor WITH (security_barrier = true) AS
SELECT event_id, event_type, aggregate_type, occurred_at, published_at,
       attempt_count, next_attempt_at, lease_expires_at, dead_lettered_at
FROM audit.outbox_message;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
        GRANT USAGE ON SCHEMA audit TO import_erp_app;
        GRANT SELECT ON audit.outbox_monitor TO import_erp_app;
    END IF;
END;
$$;
