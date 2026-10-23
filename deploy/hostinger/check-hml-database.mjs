import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedPath = "/erp_po_totvs_hml";
const refusal = `Refusing to start: DATABASE_URL must target ${expectedPath}.`;

export function assertHmlDatabase(databaseUrl = process.env.DATABASE_URL) {
  let database;
  try {
    database = new URL(databaseUrl ?? "");
  } catch {
    throw new Error(refusal);
  }
  if (database.pathname !== expectedPath) throw new Error(refusal);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    assertHmlDatabase();
  } catch (error) {
    console.error(error instanceof Error ? error.message : refusal);
    process.exitCode = 1;
  }
}
