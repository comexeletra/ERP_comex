-- OIDC transient state and server-side sessions for DEV03.
CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.oidc_login_transaction (
    state_hash char(64) PRIMARY KEY,
    nonce text NOT NULL,
    code_verifier text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_oidc_login_transaction_expires_at
    ON identity.oidc_login_transaction (expires_at);

CREATE TABLE IF NOT EXISTS identity.auth_session (
    token_hash char(64) PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES identity.erp_user(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS ix_auth_session_user_active
    ON identity.auth_session (user_id, expires_at)
    WHERE revoked_at IS NULL;
