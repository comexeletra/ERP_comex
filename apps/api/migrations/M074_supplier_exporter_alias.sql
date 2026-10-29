-- Short names under which a global supplier appears in the Exporter field of
-- the China invoices, where the name is followed by the address. The invoice
-- load matches the Exporter to the supplier of the selected PO when the
-- Exporter starts with one of that supplier's active aliases. Aliases are kept
-- through the API with audit and outbox; a removed alias stays as history.
CREATE TABLE catalog.supplier_exporter_alias (
  id uuid PRIMARY KEY,
  supplier_entry_id uuid NOT NULL REFERENCES catalog.entry(id) ON DELETE RESTRICT,
  alias varchar(240) NOT NULL CHECK (length(btrim(alias)) > 0),
  normalized_alias text GENERATED ALWAYS AS (upper(regexp_replace(alias, '[^A-Za-z0-9]', '', 'g'))) STORED,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REMOVED')),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  removed_at timestamptz NULL,
  removed_by text NULL,
  remove_reason text NULL,
  CONSTRAINT supplier_exporter_alias_length CHECK (length(normalized_alias) >= 8),
  CONSTRAINT supplier_exporter_alias_removal CHECK ((status = 'REMOVED') = (removed_at IS NOT NULL
    AND removed_by IS NOT NULL AND length(btrim(coalesce(remove_reason, ''))) >= 3))
);
CREATE UNIQUE INDEX ux_supplier_exporter_alias_active
  ON catalog.supplier_exporter_alias (supplier_entry_id, normalized_alias)
  WHERE status = 'ACTIVE';

CREATE FUNCTION catalog.check_supplier_exporter_alias() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.supplier_entry_id <> OLD.supplier_entry_id OR NEW.alias <> OLD.alias OR OLD.status = 'REMOVED' THEN
      RAISE EXCEPTION 'Exporter alias identity or removed alias cannot be changed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM catalog.entry
                 WHERE id = NEW.supplier_entry_id AND kind = 'SUPPLIER' AND importer IS NULL) THEN
    RAISE EXCEPTION 'Exporter alias must belong to a global supplier' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER supplier_exporter_alias_check
  BEFORE INSERT OR UPDATE ON catalog.supplier_exporter_alias
  FOR EACH ROW EXECUTE FUNCTION catalog.check_supplier_exporter_alias();

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['import_erp_app', 'import_erp_hml_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA catalog TO %I', role_name);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON catalog.supplier_exporter_alias TO %I', role_name);
    END IF;
  END LOOP;
END;
$$;
