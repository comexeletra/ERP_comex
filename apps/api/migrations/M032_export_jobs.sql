CREATE SCHEMA IF NOT EXISTS jobs;

CREATE TABLE IF NOT EXISTS jobs.export_job (
    id uuid PRIMARY KEY,
    job_type varchar(80) NOT NULL,
    requested_by uuid NOT NULL REFERENCES identity.erp_user(id) ON DELETE CASCADE,
    importer_scopes text[] NOT NULL,
    requested_as_master boolean NOT NULL DEFAULT false,
    parameters jsonb NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text NULL,
    lease_expires_at timestamptz NULL,
    result_text text NULL,
    error_code varchar(80) NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz NULL,
    completed_at timestamptz NULL,
    expires_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS ix_export_job_queue
    ON jobs.export_job (available_at, created_at)
    WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS ix_export_job_owner_created
    ON jobs.export_job (requested_by, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_export_job_expiry
    ON jobs.export_job (expires_at)
    WHERE expires_at IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
        GRANT USAGE ON SCHEMA jobs TO import_erp_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON jobs.export_job TO import_erp_app;
    END IF;
END;
$$;
