-- Persist resolution evidence and make quality-review commands idempotent.
-- Apply only through the explicit migration runner to an isolated database
-- until this change has been reviewed for release.
ALTER TABLE migration.quality_review
    ADD COLUMN resolution_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN data_issue_id uuid NULL REFERENCES migration.data_issue(id) ON DELETE RESTRICT,
    ADD COLUMN reviewer_user_id uuid NULL REFERENCES identity.erp_user(id) ON DELETE RESTRICT,
    ADD COLUMN idempotency_key varchar(128) NULL,
    ADD COLUMN payload_sha256 char(64) NULL;

ALTER TABLE migration.quality_review
    ADD CONSTRAINT ck_quality_review_idempotency_pair
    CHECK ((reviewer_user_id IS NULL) = (idempotency_key IS NULL)
       AND (idempotency_key IS NULL) = (payload_sha256 IS NULL));

CREATE UNIQUE INDEX uq_quality_review_actor_idempotency
    ON migration.quality_review (reviewer_user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX ix_quality_review_data_issue_recorded
    ON migration.quality_review (data_issue_id, recorded_at DESC, id DESC)
    WHERE data_issue_id IS NOT NULL;
