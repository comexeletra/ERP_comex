-- End to End target days kept by the administrator. A set applies to the product lines whose
-- necessity date is on or after valid_from, until the next set starts (lines without a
-- necessity date use the set in force today). T3 depends on the demand type and T4 on the
-- transport mode. Changes are audited by the API; sets are never deleted.
CREATE TABLE catalog.e2e_target_set (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valid_from date NOT NULL,
  t0_days integer NOT NULL,
  t1_days integer NOT NULL,
  t2_days integer NOT NULL,
  t3_mts_days integer NOT NULL,
  t3_not_mts_days integer NOT NULL,
  t4_sea_days integer NOT NULL,
  t4_air_days integer NOT NULL,
  t5_days integer NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT e2e_target_set_valid_from_unique UNIQUE (valid_from),
  CONSTRAINT e2e_target_set_days_range CHECK (
    t0_days BETWEEN 0 AND 365 AND t1_days BETWEEN 0 AND 365 AND t2_days BETWEEN 0 AND 365
    AND t3_mts_days BETWEEN 0 AND 365 AND t3_not_mts_days BETWEEN 0 AND 365
    AND t4_sea_days BETWEEN 0 AND 365 AND t4_air_days BETWEEN 0 AND 365 AND t5_days BETWEEN 0 AND 365)
);

-- Initial targets of the End to End process: T0 8, T1 8, T2 7, T3 MTS 30 / Não MTS 45,
-- T4 SEA 55 / AIR 10, T5 10, in force for every necessity date.
INSERT INTO catalog.e2e_target_set
  (id, valid_from, t0_days, t1_days, t2_days, t3_mts_days, t3_not_mts_days, t4_sea_days, t4_air_days, t5_days, created_by)
VALUES (md5('E2E_TARGET_SET|2000-01-01')::uuid, DATE '2000-01-01', 8, 8, 7, 30, 45, 55, 10, 10, 'migration:M070')
ON CONFLICT (valid_from) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') THEN
    GRANT USAGE ON SCHEMA catalog TO import_erp_app;
    GRANT SELECT, INSERT, UPDATE ON catalog.e2e_target_set TO import_erp_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_hml_app') THEN
    GRANT USAGE ON SCHEMA catalog TO import_erp_hml_app;
    GRANT SELECT, INSERT, UPDATE ON catalog.e2e_target_set TO import_erp_hml_app;
  END IF;
END;
$$;
