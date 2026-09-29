-- Local credentials extend the existing identity and server-side session model.
-- A later OIDC integration can link an external identity to the same user id.
CREATE TABLE IF NOT EXISTS identity.local_credential (
    user_id uuid PRIMARY KEY REFERENCES identity.erp_user(id) ON DELETE CASCADE,
    email text NOT NULL,
    password_hash text NOT NULL,
    must_change_password boolean NOT NULL DEFAULT true,
    failed_attempts integer NOT NULL DEFAULT 0,
    locked_until timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_local_email_length CHECK (char_length(email) BETWEEN 3 AND 254),
    CONSTRAINT ck_local_failed_attempts CHECK (failed_attempts >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_local_credential_email
    ON identity.local_credential (lower(email));

CREATE TABLE IF NOT EXISTS identity.external_identity (
    issuer text NOT NULL,
    subject text NOT NULL,
    user_id uuid NOT NULL REFERENCES identity.erp_user(id) ON DELETE CASCADE,
    PRIMARY KEY (issuer, subject)
);

CREATE INDEX IF NOT EXISTS ix_external_identity_user
    ON identity.external_identity (user_id);

CREATE TABLE IF NOT EXISTS identity.user_admin_event (
    id uuid PRIMARY KEY,
    actor_user_id uuid NULL REFERENCES identity.erp_user(id) ON DELETE SET NULL,
    target_user_id uuid NOT NULL REFERENCES identity.erp_user(id) ON DELETE RESTRICT,
    action varchar(40) NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_user_admin_event_target_created
    ON identity.user_admin_event (target_user_id, created_at DESC);
