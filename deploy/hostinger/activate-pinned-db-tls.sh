#!/usr/bin/env bash
# Change the migration connection from plaintext to pinned certificate TLS.
set -euo pipefail
env_file=/etc/import-erp/migration-release.env
cert_file=/etc/import-erp/postgres-root.crt
test -f "$env_file"
test -f "$cert_file"
python3 - <<'PY'
from pathlib import Path
p = Path('/etc/import-erp/migration-release.env')
old = '?sslmode=disable\n'
new = '?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=/etc/import-erp/postgres-root.crt\n'
data = p.read_text()
if data.count(old) != 1:
    raise SystemExit('Unexpected migration URL; no changes made.')
p.write_text(data.replace(old, new))
PY
chmod 0600 "$env_file"
cd /opt/import-erp/apps/api
/opt/node-v24/bin/node --env-file="$env_file" --input-type=module -e 'import pg from "pg"; const pool = new pg.Pool({connectionString: process.env.MIGRATION_DATABASE_URL, max: 1}); try { const result = await pool.query("SELECT current_user, current_database()"); console.log(result.rows[0]); } finally { await pool.end(); }'
echo 'Pinned TLS connection succeeded.'
exit 0
