-- ICMS on imports for the states of the Eletra importers (CE, AM, PR), kept by
-- Master and Administrador through the API with audit. Used only by the import
-- tax estimate; nothing here is written by the NCM or rate downloads.
CREATE TABLE catalog.icms_import_state (
  uf char(2) PRIMARY KEY CHECK (uf IN ('AM', 'CE', 'PR')),
  include_siscomex_fee boolean NOT NULL DEFAULT true,
  include_afrmm boolean NOT NULL DEFAULT true,
  include_other_expenses boolean NOT NULL DEFAULT true,
  reviewed boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);
INSERT INTO catalog.icms_import_state (uf, updated_by)
VALUES ('AM', 'migration:M073'), ('CE', 'migration:M073'), ('PR', 'migration:M073')
ON CONFLICT (uf) DO NOTHING;

-- Internal rate plus the poverty fund (FCP/FECOP) per period. Overlaps are refused by the API.
CREATE TABLE catalog.icms_import_rate (
  id uuid PRIMARY KEY,
  uf char(2) NOT NULL REFERENCES catalog.icms_import_state(uf),
  rate numeric(9,4) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  fcp_rate numeric(9,4) NOT NULL DEFAULT 0 CHECK (fcp_rate BETWEEN 0 AND 100),
  legal_basis text NOT NULL CHECK (length(btrim(legal_basis)) BETWEEN 3 AND 500),
  valid_from date NOT NULL,
  valid_to date NULL CHECK (valid_to IS NULL OR valid_to >= valid_from),
  reviewed boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  CHECK (rate + fcp_rate < 100)
);
CREATE INDEX ix_icms_import_rate_uf ON catalog.icms_import_rate (uf, valid_from);

-- Starting values from public rate tables, to be confirmed against the state laws.
INSERT INTO catalog.icms_import_rate (id, uf, rate, fcp_rate, legal_basis, valid_from, created_by, updated_by)
VALUES
  (md5('ICMS_IMPORT_RATE|PR|2024-03-12')::uuid, 'PR', 19.5, 0,
    'Alíquota interna geral do Paraná desde 12/03/2024 (a confirmar na lei estadual e no RICMS-PR, inclusive a parcela do FECOP)',
    DATE '2024-03-12', 'migration:M073', 'migration:M073'),
  (md5('ICMS_IMPORT_RATE|CE|2024-01-01')::uuid, 'CE', 20, 0,
    'Lei nº 18.305/2023 do Ceará, vigência 01/01/2024 (a confirmar)',
    DATE '2024-01-01', 'migration:M073', 'migration:M073'),
  (md5('ICMS_IMPORT_RATE|AM|2026-01-01')::uuid, 'AM', 20, 0,
    'Lei Complementar nº 19/1997 do Amazonas, art. 12, I, "b" (início da vigência a confirmar; cadastrada a partir de 01/01/2026)',
    DATE '2026-01-01', 'migration:M073', 'migration:M073')
ON CONFLICT (id) DO NOTHING;

-- Base reduction or deferral per state, for one NCM or for all (ncm NULL).
CREATE TABLE catalog.icms_import_benefit (
  id uuid PRIMARY KEY,
  uf char(2) NOT NULL REFERENCES catalog.icms_import_state(uf),
  ncm char(8) NULL CHECK (ncm ~ '^[0-9]{8}$'),
  kind varchar(20) NOT NULL CHECK (kind IN ('BASE_REDUCTION', 'DEFERRAL')),
  percent numeric(9,4) NOT NULL CHECK (percent > 0 AND percent <= 100),
  legal_basis text NOT NULL CHECK (length(btrim(legal_basis)) BETWEEN 3 AND 500),
  valid_from date NOT NULL,
  valid_to date NULL CHECK (valid_to IS NULL OR valid_to >= valid_from),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);
CREATE INDEX ix_icms_import_benefit_uf ON catalog.icms_import_benefit (uf, kind, valid_from);

-- State of each importer establishment; the estimate suggests it and the user may change it.
CREATE TABLE catalog.icms_importer_state (
  importer varchar(240) PRIMARY KEY CHECK (length(btrim(importer)) > 0),
  uf char(2) NOT NULL REFERENCES catalog.icms_import_state(uf),
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);
INSERT INTO catalog.icms_importer_state (importer, uf, updated_by)
VALUES ('ELETRA CWB', 'PR', 'migration:M073'), ('ELETRA FOR', 'CE', 'migration:M073'),
  ('ELETRA MATRIZ', 'CE', 'migration:M073'), ('ELETRA MAO', 'AM', 'migration:M073')
ON CONFLICT (importer) DO NOTHING;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['import_erp_app', 'import_erp_hml_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA catalog TO %I', role_name);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON catalog.icms_import_state, catalog.icms_import_rate, '
        'catalog.icms_import_benefit, catalog.icms_importer_state TO %I', role_name);
    END IF;
  END LOOP;
END;
$$;
