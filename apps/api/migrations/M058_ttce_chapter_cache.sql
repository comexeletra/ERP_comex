-- TTCE is independent from the nomenclature and attribute snapshots.
-- Retain every downloaded hash for reproducible historical consultation.
CREATE TABLE catalog.ttce_chapter_cache (
    reference_date date NOT NULL,
    chapter char(2) NOT NULL CHECK (chapter ~ '^[0-9]{2}$'),
    source_hash char(64) NOT NULL CHECK (source_hash ~ '^[0-9A-Fa-f]{64}$'),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    fetched_at timestamptz NOT NULL DEFAULT now(),
    checked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (reference_date, chapter, source_hash)
);

CREATE INDEX ix_ttce_chapter_latest
  ON catalog.ttce_chapter_cache (reference_date, chapter, fetched_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT SELECT, INSERT, UPDATE ON catalog.ttce_chapter_cache TO import_erp_hml_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT SELECT, INSERT, UPDATE ON catalog.ttce_chapter_cache TO import_erp_app;
  END IF;
END $$;
