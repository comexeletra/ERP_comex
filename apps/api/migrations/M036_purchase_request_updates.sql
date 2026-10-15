DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT UPDATE (importer, sc_number, normalized_sc_number, sc_date,
      commercial_plan_received_date, requester, approval_date, version, updated_at)
      ON procurement.purchase_request TO import_erp_app;
  END IF;
END $$;
