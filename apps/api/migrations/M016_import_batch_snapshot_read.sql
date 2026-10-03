-- Let the API read only the promoted snapshot identifier and timestamp.
-- The import batch's file and mapping metadata remain private to migration jobs.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA migration TO import_erp_app';
        EXECUTE 'GRANT SELECT (id, promoted_at) ON migration.import_batch TO import_erp_app';
    END IF;
END;
$$;
