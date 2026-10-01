-- Native request intake. Request data stays distinct from historical Excel rows.
CREATE SEQUENCE procurement.import_request_number_seq AS bigint START WITH 1;

CREATE TABLE procurement.import_request (
    id uuid PRIMARY KEY,
    request_number varchar(32) NOT NULL UNIQUE,
    importer varchar(120) NOT NULL,
    source_kind varchar(16) NOT NULL DEFAULT 'NATIVE' CHECK (source_kind = 'NATIVE'),
    requester_reference varchar(160) NOT NULL,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 2000),
    notes text NOT NULL DEFAULT '',
    status varchar(24) NOT NULL DEFAULT 'SUBMITTED'
        CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED')),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by uuid NOT NULL REFERENCES identity.erp_user(id),
    updated_by uuid NOT NULL REFERENCES identity.erp_user(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_import_request_scope_created
    ON procurement.import_request (importer, created_at DESC, id);

CREATE TABLE procurement.import_request_item (
    id uuid PRIMARY KEY,
    request_id uuid NOT NULL REFERENCES procurement.import_request(id) ON DELETE RESTRICT,
    line_number integer NOT NULL CHECK (line_number > 0),
    description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 1000),
    source_kind varchar(16) NOT NULL DEFAULT 'NATIVE' CHECK (source_kind = 'NATIVE'),
    purpose_text varchar(500) NULL,
    cost_center_text varchar(160) NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (request_id, line_number)
);

CREATE TABLE procurement.import_request_command_receipt (
    actor_user_id uuid NOT NULL REFERENCES identity.erp_user(id),
    idempotency_key varchar(128) NOT NULL,
    payload_sha256 char(64) NOT NULL,
    request_id uuid NOT NULL REFERENCES procurement.import_request(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_user_id, idempotency_key)
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
        GRANT USAGE ON SCHEMA procurement TO import_erp_app;
        GRANT USAGE, SELECT ON SEQUENCE procurement.import_request_number_seq TO import_erp_app;
        GRANT SELECT, INSERT, UPDATE ON procurement.import_request TO import_erp_app;
        GRANT SELECT, INSERT ON procurement.import_request_item,
            procurement.import_request_command_receipt TO import_erp_app;
    END IF;
END;
$$;
