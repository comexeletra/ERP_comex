-- Decisions that a record flagged by a data quality rule is correct as it is
-- (for example, customs cleared before arrival under early clearance). The
-- rules run on read over current data; a waiver only hides a finding while the
-- checked values keep the same hash. A revoked waiver stays as history.
CREATE TABLE migration.quality_rule_waiver (
  id uuid PRIMARY KEY,
  rule_code varchar(64) NOT NULL CHECK (rule_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  entity_type varchar(32) NOT NULL
    CHECK (entity_type IN ('PURCHASE_ORDER', 'PURCHASE_ORDER_ITEM', 'IMPORT_PROCESS', 'PURCHASE_REQUEST')),
  entity_id uuid NOT NULL,
  importer varchar(120) NULL,
  checked_values jsonb NOT NULL CHECK (jsonb_typeof(checked_values) = 'object'),
  values_sha256 char(64) NOT NULL CHECK (values_sha256 ~ '^[0-9a-f]{64}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 2000),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  revoked_at timestamptz NULL,
  revoked_by text NULL,
  revoke_reason text NULL,
  CONSTRAINT quality_rule_waiver_revocation CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL
    AND revoked_by IS NOT NULL AND length(btrim(coalesce(revoke_reason, ''))) >= 8))
);
CREATE UNIQUE INDEX ux_quality_rule_waiver_active
  ON migration.quality_rule_waiver (rule_code, entity_id)
  WHERE status = 'ACTIVE';

CREATE FUNCTION migration.check_quality_rule_waiver() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rule_code <> OLD.rule_code OR NEW.entity_type <> OLD.entity_type OR NEW.entity_id <> OLD.entity_id
     OR NEW.values_sha256 <> OLD.values_sha256 OR NEW.checked_values <> OLD.checked_values
     OR NEW.reason <> OLD.reason OR OLD.status = 'REVOKED' THEN
    RAISE EXCEPTION 'Waiver identity or revoked waiver cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER quality_rule_waiver_check
  BEFORE UPDATE ON migration.quality_rule_waiver
  FOR EACH ROW EXECUTE FUNCTION migration.check_quality_rule_waiver();

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['import_erp_app', 'import_erp_hml_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA migration TO %I', role_name);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON migration.quality_rule_waiver TO %I', role_name);
    END IF;
  END LOOP;
END;
$$;
