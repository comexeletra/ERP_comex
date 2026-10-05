-- Expose only operational PO/IP events. API handlers must resolve the PO and
-- its importer scope before querying these read-only views.
CREATE OR REPLACE VIEW audit.purchase_order_operational_history WITH (security_barrier = true) AS
SELECT id, aggregate_id, entity_type, entity_id, operation, old_value, new_value,
       actor_id, occurred_at, reason
FROM audit.audit_log
WHERE aggregate_type = 'PURCHASE_ORDER'
  AND entity_type IN ('PURCHASE_ORDER', 'PURCHASE_ORDER_ITEM', 'PO_ITEM_ALLOCATION');

CREATE OR REPLACE VIEW audit.import_process_operational_history WITH (security_barrier = true) AS
SELECT id, aggregate_id, entity_type, entity_id, operation, old_value, new_value,
       actor_id, occurred_at, reason
FROM audit.audit_log
WHERE aggregate_type = 'IMPORT_PROCESS'
  AND entity_type IN ('IMPORT_PROCESS', 'PROCESS_DOCUMENT');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT USAGE ON SCHEMA audit TO import_erp_app;
    GRANT SELECT ON audit.purchase_order_operational_history,
      audit.import_process_operational_history TO import_erp_app;
  END IF;
END $$;
