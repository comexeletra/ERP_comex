-- Allow SC deletion through the audited API, and permit only its unlink from a
-- DELETED PO. All other business fields on non-active POs remain immutable.
CREATE OR REPLACE FUNCTION procurement.check_purchase_order_business_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable_fields text[] := ARRAY['lifecycle_status', 'lifecycle_changed_at', 'lifecycle_changed_by',
    'lifecycle_reason', 'version', 'updated_at'];
BEGIN
  IF OLD.lifecycle_status = 'DELETED' AND NEW.lifecycle_status = 'DELETED'
    AND OLD.purchase_request_id IS NOT NULL AND NEW.purchase_request_id IS NULL
    AND (to_jsonb(NEW) - mutable_fields - 'purchase_request_id')
      IS NOT DISTINCT FROM (to_jsonb(OLD) - mutable_fields - 'purchase_request_id') THEN
    RETURN NEW;
  END IF;

  IF OLD.lifecycle_status <> 'ACTIVE'
    AND (to_jsonb(NEW) - mutable_fields) IS DISTINCT FROM (to_jsonb(OLD) - mutable_fields) THEN
    RAISE EXCEPTION 'Only active POs allow business field changes' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT DELETE ON procurement.purchase_request TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT DELETE ON procurement.purchase_request TO import_erp_hml_app;
  END IF;
END;
$$;
