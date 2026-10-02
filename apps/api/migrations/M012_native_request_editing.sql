-- Editing native request items requires a narrow extension to the API role.
-- Application authorization limits edits to the request's importer scope and
-- SUBMITTED status, with optimistic concurrency on the request version.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
        GRANT UPDATE, DELETE ON procurement.import_request_item TO import_erp_app;
    END IF;
END;
$$;
