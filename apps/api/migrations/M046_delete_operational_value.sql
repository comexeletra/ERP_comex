DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT DELETE ON catalog.operational_value TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT DELETE ON catalog.operational_value TO import_erp_hml_app;
  END IF;
END
$$;
