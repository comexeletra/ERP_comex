-- Explicit IP closure is a lifecycle action, independent from logistics status.
ALTER TABLE imports.import_process
  ADD COLUMN lifecycle_status varchar(16) NOT NULL DEFAULT 'OPEN'
    CHECK (lifecycle_status IN ('OPEN', 'CLOSED')),
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_by text,
  ADD COLUMN close_reason text,
  ADD CONSTRAINT import_process_closure_fields CHECK (
    (lifecycle_status = 'OPEN' AND closed_at IS NULL AND closed_by IS NULL AND close_reason IS NULL)
    OR (lifecycle_status = 'CLOSED' AND closed_at IS NOT NULL AND closed_by IS NOT NULL
      AND length(btrim(close_reason)) >= 3)
  );

CREATE INDEX ix_process_importer_lifecycle
  ON imports.import_process (importer, lifecycle_status, ip_number);
