import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const deploy = name => fileURLToPath(new URL(`../../../deploy/hostinger/${name}`, import.meta.url));

test("HML export worker unit is isolated and keeps the production worker hardening", async () => {
  const [unit, productionUnit] = await Promise.all([
    readFile(deploy("import-erp-hml-export-worker.service"), "utf8"),
    readFile(deploy("import-erp-export-worker.service"), "utf8"),
  ]);

  assert.match(unit, /^Description=ERP Comex Homologation export worker$/mu);
  assert.match(unit, /^EnvironmentFile=\/etc\/import-erp\/homologation-db[.]env$/mu);
  assert.doesNotMatch(unit, /^EnvironmentFile=\/etc\/import-erp\/api[.]env$/mu);
  assert.match(unit, /^ExecStartPre=\/opt\/node-v24\/bin\/node \/opt\/import-erp\/apps\/api\/check-hml-database[.]mjs$/mu);
  assert.match(unit, /^ExecStart=\/usr\/bin\/false$/mu,
    "the base unit must not start production code when the release drop-in is absent");

  for (const directive of ["User=import-erp", "Group=import-erp", "WorkingDirectory=/opt/import-erp/apps/api",
    "Environment=NODE_ENV=production", "Restart=always", "RestartSec=5", "TimeoutStopSec=30", "KillSignal=SIGTERM",
    "NoNewPrivileges=true", "PrivateTmp=true", "ProtectSystem=strict", "ProtectHome=true",
    "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6", "UMask=0027"]) {
    assert.match(productionUnit, new RegExp(`^${directive}$`, "mu"));
    assert.match(unit, new RegExp(`^${directive}$`, "mu"));
  }
});

test("database guard accepts only the HML database path", async () => {
  const { assertHmlDatabase } = await import(new URL("../../../deploy/hostinger/check-hml-database.mjs", import.meta.url));
  assert.doesNotThrow(() => assertHmlDatabase(
    "postgresql://worker:secret@127.0.0.1:5432/erp_po_totvs_hml",
  ));
  for (const databaseUrl of [
    "postgresql://worker:secret@127.0.0.1:5432/erp_po_totvs_test",
    "postgresql://worker:secret@127.0.0.1:5432/another_database",
    undefined,
  ]) {
    assert.throws(() => assertHmlDatabase(databaseUrl), error => {
      assert.match(error.message, /Refusing to start: DATABASE_URL must target \/erp_po_totvs_hml[.]/u);
      assert.doesNotMatch(error.message, /secret/u, "the guard must not print credentials");
      return true;
    });
  }
});

test("enable script pins a checked HML release before enabling the service", async () => {
  const script = await readFile(deploy("enable-homologation-export-worker.sh"), "utf8");

  assert.match(script, /\[\[ \$EUID -eq 0 \]\]/u);
  assert.match(script, /release_sha=\$\{1:-\}/u);
  assert.match(script, /\^\[0-9a-f\]\{7,40\}\$/u);
  assert.match(script, /hml-release-\$\{release_sha\}\/dist\/worker[.]js/u);
  assert.match(script, /systemctl show[\s\S]+import-erp-hml-api/u);
  assert.match(script, /hml-release-\$\{release_sha\}\/dist\/server[.]js/u);
  assert.match(script, /check-hml-database[.]mjs/u);
  assert.match(script, /release-\$\{release_sha\}[.]conf/u);
  assert.match(script, /systemd-analyze verify/u);
  assert.match(script, /systemctl daemon-reload/u);
  assert.match(script, /systemctl enable --now import-erp-hml-export-worker/u);
  assert.match(script, /systemctl is-active --quiet import-erp-hml-export-worker/u);
  assert.match(script, /journalctl[\s\S]+export_worker_started/u);

  const databaseCheck = script.indexOf("check-hml-database.mjs");
  const enable = script.indexOf("systemctl enable --now");
  assert.ok(databaseCheck >= 0 && databaseCheck < enable, "the HML database must be checked before enabling the unit");
});
