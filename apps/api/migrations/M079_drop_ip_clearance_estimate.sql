-- Removes the clearance estimate fields of M078. The user decided that the clearance estimates use only the
-- post-shipment data of the IP (DUIMP or ETA, taxes paid and the analysts of the POs), with no typed estimate and no
-- load of the workbook sheet (docs/PLANO_ESTIMATIVA_DESEMBARACO.md). The columns were never filled; the migration
-- stops instead of dropping a value someone typed.
DO $empty$
BEGIN
  IF EXISTS (SELECT 1 FROM imports.import_process
              WHERE clearance_analyst IS NOT NULL OR registration_target_date IS NOT NULL
                 OR clearance_estimate_brl IS NOT NULL) THEN
    RAISE EXCEPTION 'An IP has a clearance estimate field filled; M079 does not drop typed values';
  END IF;
END $empty$;

ALTER TABLE imports.import_process
  DROP COLUMN clearance_analyst,
  DROP COLUMN registration_target_date,
  DROP COLUMN clearance_estimate_brl;
