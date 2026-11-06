-- Clearance estimate of the IP (docs/PLANO_ESTIMATIVA_DESEMBARACO.md): the analyst who clears the IP, the date the
-- DUIMP should be registered and the money the clearance will need. They came from the "Import Clearance
-- Estimations" sheet of the Follow Up workbook. Nothing is updated here: the load fills them and the IP form edits
-- them. The estimate is apart from taxes_paid_brl, which is the amount actually paid.
ALTER TABLE imports.import_process
  ADD COLUMN clearance_analyst varchar(160),
  ADD COLUMN registration_target_date date,
  ADD COLUMN clearance_estimate_brl numeric(18,2),
  ADD CONSTRAINT import_process_clearance_analyst_not_blank
    CHECK (clearance_analyst IS NULL OR length(btrim(clearance_analyst)) > 0),
  ADD CONSTRAINT import_process_clearance_estimate_not_negative
    CHECK (clearance_estimate_brl IS NULL OR clearance_estimate_brl >= 0);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT (clearance_analyst, registration_target_date, clearance_estimate_brl),
      INSERT (clearance_analyst, registration_target_date, clearance_estimate_brl),
      UPDATE (clearance_analyst, registration_target_date, clearance_estimate_brl)
      ON imports.import_process TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT SELECT (clearance_analyst, registration_target_date, clearance_estimate_brl),
      INSERT (clearance_analyst, registration_target_date, clearance_estimate_brl),
      UPDATE (clearance_analyst, registration_target_date, clearance_estimate_brl)
      ON imports.import_process TO import_erp_hml_app;
  END IF;
END;
$$;

COMMENT ON COLUMN imports.import_process.clearance_analyst IS 'Analyst who clears the IP (Analyst of the Import Clearance Estimations sheet), apart from the PO analyst.';
COMMENT ON COLUMN imports.import_process.registration_target_date IS 'Date the DUIMP should be registered (Date to register); the clearance estimates filter the next week by it.';
COMMENT ON COLUMN imports.import_process.clearance_estimate_brl IS 'Estimated money needed for the clearance, in BRL (Value needed for clearance); taxes_paid_brl keeps the amount paid.';
