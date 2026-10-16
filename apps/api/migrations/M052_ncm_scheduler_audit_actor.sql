-- Scheduled NCM synchronization has no human identity; keep creation actors
-- mandatory while allowing updated_by to be null for the auditable system job.
ALTER TABLE catalog.entry
  ALTER COLUMN updated_by DROP NOT NULL;
