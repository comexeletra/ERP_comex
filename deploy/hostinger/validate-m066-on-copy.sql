\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF current_database() NOT LIKE 'erp_po_hml_m066_copy_%' THEN
    RAISE EXCEPTION 'M066 validation must run only on a disposable HML restore copy';
  END IF;
  IF (SELECT count(*) FROM migration.schema_migration) <> 66
     OR (SELECT max(version) FROM migration.schema_migration) <> 'M066_purchase_request_delete.sql' THEN
    RAISE EXCEPTION 'The restored HML copy must be at M066';
  END IF;
  IF NOT has_table_privilege('import_erp_hml_app', 'procurement.purchase_request', 'DELETE') THEN
    RAISE EXCEPTION 'The HML runtime role cannot delete purchase requests';
  END IF;
END
$$;

-- Use the actual production trigger function on a disposable row shape. CTAS
-- intentionally avoids the business table constraints and foreign keys.
CREATE TEMP TABLE m066_purchase_order_probe
  ON COMMIT DROP AS SELECT * FROM procurement.purchase_order WHERE false;
CREATE TRIGGER m066_purchase_order_probe_immutable
  BEFORE UPDATE ON pg_temp.m066_purchase_order_probe
  FOR EACH ROW EXECUTE FUNCTION procurement.check_purchase_order_business_fields();

INSERT INTO pg_temp.m066_purchase_order_probe (id, lifecycle_status, purchase_request_id, supplier_text)
VALUES ('00000000-0000-4000-8000-000000000066', 'DELETED',
        '00000000-0000-4000-8000-000000000067', 'M066 synthetic supplier');
UPDATE pg_temp.m066_purchase_order_probe
   SET purchase_request_id = NULL
 WHERE id = '00000000-0000-4000-8000-000000000066';
DO $$
BEGIN
  IF (SELECT purchase_request_id IS NOT NULL OR supplier_text <> 'M066 synthetic supplier'
        FROM pg_temp.m066_purchase_order_probe
       WHERE id = '00000000-0000-4000-8000-000000000066') THEN
    RAISE EXCEPTION 'The narrow unlink changed an unexpected PO field';
  END IF;
END
$$;

INSERT INTO pg_temp.m066_purchase_order_probe (id, lifecycle_status, purchase_request_id, supplier_text)
VALUES ('00000000-0000-4000-8000-000000000068', 'DELETED',
        '00000000-0000-4000-8000-000000000069', 'M066 protected supplier');
DO $$
BEGIN
  BEGIN
    UPDATE pg_temp.m066_purchase_order_probe
       SET purchase_request_id = NULL, supplier_text = 'unexpected mutation'
     WHERE id = '00000000-0000-4000-8000-000000000068';
    RAISE EXCEPTION 'The trigger allowed a business-field change with the unlink';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  IF (SELECT purchase_request_id IS NULL OR supplier_text <> 'M066 protected supplier'
        FROM pg_temp.m066_purchase_order_probe
       WHERE id = '00000000-0000-4000-8000-000000000068') THEN
    RAISE EXCEPTION 'A rejected PO update was not rolled back';
  END IF;
END
$$;

INSERT INTO pg_temp.m066_purchase_order_probe (id, lifecycle_status, purchase_request_id, supplier_text)
VALUES ('00000000-0000-4000-8000-000000000070', 'DELETED',
        '00000000-0000-4000-8000-000000000071', 'M066 unchanged link');
DO $$
BEGIN
  BEGIN
    UPDATE pg_temp.m066_purchase_order_probe
       SET supplier_text = 'unexpected mutation'
     WHERE id = '00000000-0000-4000-8000-000000000070';
    RAISE EXCEPTION 'The trigger allowed another business-field change';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  IF (SELECT supplier_text <> 'M066 unchanged link'
        FROM pg_temp.m066_purchase_order_probe
       WHERE id = '00000000-0000-4000-8000-000000000070') THEN
    RAISE EXCEPTION 'A rejected business-field change was not rolled back';
  END IF;
END
$$;

ROLLBACK;

DO $$
BEGIN
  IF current_database() NOT LIKE 'erp_po_hml_m066_copy_%'
     OR to_regclass('pg_temp.m066_purchase_order_probe') IS NOT NULL THEN
    RAISE EXCEPTION 'M066 validation rollback did not clean up its temporary probe';
  END IF;
END
$$;

SELECT 'M066 validation passed; unlink and immutability checks rolled back.' AS result;
