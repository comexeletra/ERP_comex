#!/usr/bin/env bash
# Read-only export of the HML catalog that import-follow-up-workbook.py takes as --catalog:
#   VALUE<TAB>entity<TAB>value     selector values (catalog.operational_value)
#   SUPPLIER<TAB>code or name      global suppliers, by code and by name, as catalog.sync_supplier_entity_reference
#                                  finds them (IRAPTOR, LDA is EX000799, registered by the list of manufacturers)
# Usage on the VPS: bash export-follow-up-catalog.sh > catalog.tsv < /dev/null
set -euo pipefail
container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
[[ -n $container ]] || { echo 'PostgreSQL container not found.' >&2; exit 1; }
docker exec -i "$container" psql -U postgres -d erp_po_totvs_hml -v ON_ERROR_STOP=1 -At -F $'\t' <<'SQL'
BEGIN TRANSACTION READ ONLY;
\o /dev/null
DO $$ BEGIN
  IF current_database() <> 'erp_po_totvs_hml' THEN RAISE EXCEPTION 'Only erp_po_totvs_hml is exported'; END IF;
END $$;
\o
SELECT 'VALUE', entity_key, value FROM catalog.operational_value ORDER BY 2, 3;
SELECT DISTINCT 'SUPPLIER', supplier FROM (
  SELECT upper(btrim(code)) AS supplier FROM catalog.entry WHERE kind = 'SUPPLIER' AND importer IS NULL
  UNION SELECT upper(btrim(name)) FROM catalog.entry WHERE kind = 'SUPPLIER' AND importer IS NULL AND btrim(name) <> ''
) suppliers ORDER BY 2;
ROLLBACK;
SQL
