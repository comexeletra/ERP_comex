-- Estimated taxes of the clearance of the IP (docs/PLANO_ESTIMATIVA_DESEMBARACO.md). The taxes paid exist only after
-- the DUIMP is registered, so the clearance estimates of next week need the amount expected before it. It is typed in
-- the IP post-shipment form by whoever prepares the registration and stays apart from taxes_paid_brl (the amount
-- paid). Nothing is filled here: the workbook sheet is not loaded.
ALTER TABLE imports.import_process
  ADD COLUMN clearance_estimate_brl numeric(18,2),
  ADD CONSTRAINT import_process_clearance_estimate_not_negative
    CHECK (clearance_estimate_brl IS NULL OR clearance_estimate_brl >= 0);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT (clearance_estimate_brl), INSERT (clearance_estimate_brl), UPDATE (clearance_estimate_brl)
      ON imports.import_process TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT SELECT (clearance_estimate_brl), INSERT (clearance_estimate_brl), UPDATE (clearance_estimate_brl)
      ON imports.import_process TO import_erp_hml_app;
  END IF;
END;
$$;

COMMENT ON COLUMN imports.import_process.clearance_estimate_brl IS 'Estimated taxes of the clearance, in BRL, typed before the registration; taxes_paid_brl keeps the amount paid.';
