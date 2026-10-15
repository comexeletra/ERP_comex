ALTER TABLE jobs.export_job
    ADD COLUMN IF NOT EXISTS result_binary bytea NULL;
