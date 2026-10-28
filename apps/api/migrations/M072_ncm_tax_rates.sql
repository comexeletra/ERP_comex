-- II, IPI and PIS/COFINS rates per NCM, kept apart from the NCM nomenclature
-- tables (ncm_official_*, ncm_siscomex_data, ncm_sync_state) and from the TTCE
-- cache. Every downloaded official file is retained as a version; exactly one
-- version per source is current. Rates are percentages.
CREATE TABLE catalog.ncm_rate_version (
  id uuid PRIMARY KEY,
  source varchar(20) NOT NULL CHECK (source IN ('GECEX_272', 'TIPI')),
  source_url text NOT NULL CHECK (source_url LIKE 'https://www.gov.br/%'),
  source_reference text NOT NULL CHECK (length(btrim(source_reference)) > 0),
  source_updated_at date NULL,
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  item_count integer NOT NULL CHECK (item_count > 0),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  CONSTRAINT ncm_rate_version_file_unique UNIQUE (source, sha256)
);
CREATE UNIQUE INDEX ux_ncm_rate_version_current ON catalog.ncm_rate_version (source) WHERE is_current;

-- Annex I (TEC) and Annex II (Brazilian rate) of Gecex Resolution 272/2021.
CREATE TABLE catalog.ncm_ii_rate (
  version_id uuid NOT NULL REFERENCES catalog.ncm_rate_version(id),
  code char(8) NOT NULL CHECK (code ~ '^[0-9]{8}$'),
  tec_rate numeric(9,4) NULL CHECK (tec_rate >= 0),
  tec_marker varchar(3) NULL CHECK (tec_marker IN ('BK', 'BIT')),
  brazil_rate numeric(9,4) NULL CHECK (brazil_rate >= 0),
  brazil_basis text NULL,
  PRIMARY KEY (version_id, code),
  CHECK (tec_rate IS NOT NULL OR brazil_rate IS NOT NULL)
);

-- Annexes III to X. The aeronautical annex (III) lists 4- or 6-digit headings without a rate.
CREATE TABLE catalog.ncm_ii_exception (
  version_id uuid NOT NULL REFERENCES catalog.ncm_rate_version(id),
  position integer NOT NULL CHECK (position >= 0),
  annex varchar(4) NOT NULL CHECK (annex IN ('III', 'IV', 'V', 'VI', 'VIII', 'IX', 'X')),
  ncm varchar(8) NOT NULL CHECK (ncm ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
  ex_number varchar(3) NULL CHECK (ex_number ~ '^[0-9]{3}$'),
  rate numeric(9,4) NULL CHECK (rate >= 0),
  quota text NULL,
  valid_from date NULL,
  valid_to date NULL,
  act text NULL,
  description text NULL,
  PRIMARY KEY (version_id, position),
  CHECK ((annex = 'III') = (rate IS NULL)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE INDEX ix_ncm_ii_exception_ncm ON catalog.ncm_ii_exception (version_id, ncm);

-- TIPI rows; ex_number '' is the NCM line itself. NT (não tributado) has no rate.
CREATE TABLE catalog.ncm_ipi_rate (
  version_id uuid NOT NULL REFERENCES catalog.ncm_rate_version(id),
  code char(8) NOT NULL CHECK (code ~ '^[0-9]{8}$'),
  ex_number varchar(3) NOT NULL CHECK (ex_number ~ '^([0-9]{2,3})?$'),
  description text NOT NULL,
  rate numeric(9,4) NULL CHECK (rate >= 0),
  not_taxed boolean NOT NULL,
  PRIMARY KEY (version_id, code, ex_number),
  CHECK ((rate IS NULL) = not_taxed)
);

-- Download state of each source, independent from catalog.ncm_sync_state.
CREATE TABLE catalog.ncm_rate_source_state (
  source varchar(20) PRIMARY KEY CHECK (source IN ('GECEX_272', 'TIPI')),
  last_attempt_at timestamptz NULL,
  last_success_at timestamptz NULL,
  last_error text NULL
);
INSERT INTO catalog.ncm_rate_source_state (source) VALUES ('GECEX_272'), ('TIPI')
ON CONFLICT (source) DO NOTHING;

-- PIS/COFINS-Importação have no official table per NCM: a dated general rule
-- and NCM exceptions kept by the fiscal team with their legal basis.
CREATE TABLE catalog.pis_cofins_general_rate (
  id uuid PRIMARY KEY,
  pis_rate numeric(9,4) NOT NULL CHECK (pis_rate BETWEEN 0 AND 100),
  cofins_rate numeric(9,4) NOT NULL CHECK (cofins_rate BETWEEN 0 AND 100),
  legal_basis text NOT NULL CHECK (length(btrim(legal_basis)) > 0),
  valid_from date NOT NULL UNIQUE,
  valid_to date NULL CHECK (valid_to IS NULL OR valid_to >= valid_from),
  created_by text NOT NULL
);
INSERT INTO catalog.pis_cofins_general_rate (id, pis_rate, cofins_rate, legal_basis, valid_from, created_by)
VALUES (md5('PIS_COFINS_GENERAL|2015-05-01')::uuid, 2.10, 9.65,
  'Lei nº 10.865/2004, art. 8º, I e II, com a redação da Lei nº 13.137/2015', DATE '2015-05-01', 'migration:M072')
ON CONFLICT (valid_from) DO NOTHING;

-- Overlapping periods for the same NCM are refused by the API, under a lock per NCM.
CREATE TABLE catalog.ncm_pis_cofins_exception (
  id uuid PRIMARY KEY,
  code char(8) NOT NULL CHECK (code ~ '^[0-9]{8}$'),
  pis_rate numeric(9,4) NOT NULL CHECK (pis_rate BETWEEN 0 AND 100),
  cofins_rate numeric(9,4) NOT NULL CHECK (cofins_rate BETWEEN 0 AND 100),
  legal_basis text NOT NULL CHECK (length(btrim(legal_basis)) BETWEEN 3 AND 500),
  valid_from date NOT NULL,
  valid_to date NULL CHECK (valid_to IS NULL OR valid_to >= valid_from),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);
CREATE INDEX ix_ncm_pis_cofins_exception_code ON catalog.ncm_pis_cofins_exception (code, valid_from);

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['import_erp_app', 'import_erp_hml_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA catalog TO %I', role_name);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON catalog.ncm_rate_version, catalog.ncm_rate_source_state, '
        'catalog.ncm_pis_cofins_exception TO %I', role_name);
      EXECUTE format('GRANT SELECT, INSERT ON catalog.ncm_ii_rate, catalog.ncm_ii_exception, catalog.ncm_ipi_rate TO %I',
        role_name);
      EXECUTE format('GRANT SELECT ON catalog.pis_cofins_general_rate TO %I', role_name);
    END IF;
  END LOOP;
END;
$$;
