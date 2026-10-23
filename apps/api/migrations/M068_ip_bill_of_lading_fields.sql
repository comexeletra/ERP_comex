-- One IP is one shipment: BL number and date are typed on the IP beside ETD/ETA,
-- and every PO item allocated to the IP reads them from there. Existing BL
-- documents seed the new fields and remain untouched as history.
ALTER TABLE imports.import_process
  ADD COLUMN bl_number varchar(120),
  ADD COLUMN bl_date date,
  ADD CONSTRAINT import_process_bl_number_not_blank
    CHECK (bl_number IS NULL OR length(btrim(bl_number)) > 0);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM imports.process_document
    WHERE kind = 'BL' AND status = 'ACTIVE'
    GROUP BY process_id
    HAVING count(DISTINCT upper(btrim(number))) > 1 OR count(DISTINCT issue_date) > 1
  ) THEN
    RAISE EXCEPTION 'Resolve IPs with more than one active BL before M068';
  END IF;
END;
$$;

WITH bl AS (
  SELECT process_id, min(btrim(number)) AS number, max(issue_date) AS issue_date
  FROM imports.process_document
  WHERE kind = 'BL' AND status = 'ACTIVE'
  GROUP BY process_id
), updated AS (
  UPDATE imports.import_process AS process
     SET bl_number = coalesce(process.bl_number, bl.number),
         bl_date = coalesce(process.bl_date, bl.issue_date)
    FROM bl
   WHERE bl.process_id = process.id
     AND (process.bl_number IS NULL OR process.bl_date IS NULL AND bl.issue_date IS NOT NULL)
  RETURNING process.id, process.bl_number, process.bl_date
)
INSERT INTO audit.audit_log
  (id, aggregate_type, aggregate_id, entity_type, entity_id, operation, field_name,
   old_value, new_value, actor_id, occurred_at, reason, correlation_id)
SELECT gen_random_uuid(), 'IMPORT_PROCESS', updated.id, 'IMPORT_PROCESS', updated.id,
       'HISTORICAL_BACKFILL', NULL, jsonb_build_object('blNumber', NULL, 'blDate', NULL),
       jsonb_build_object('blNumber', updated.bl_number, 'blDate', updated.bl_date),
       'migration:M068', now(), 'BL number and date copied from the active BL document to the IP.',
       gen_random_uuid()
  FROM updated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT (bl_number, bl_date),
      INSERT (bl_number, bl_date),
      UPDATE (bl_number, bl_date)
      ON imports.import_process TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT SELECT (bl_number, bl_date),
      INSERT (bl_number, bl_date),
      UPDATE (bl_number, bl_date)
      ON imports.import_process TO import_erp_hml_app;
  END IF;
END;
$$;
