import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";
import { BusinessError, problem, record, transaction } from "./operations.js";

// Loads of the product DATABASE and of the manufacturer list (stage 1f of
// docs/PLANO_AUDITORIA_INVOICE_AVULSA.md). The browser reads the spreadsheet and
// sends its rows. One load keeps the rows, unchanged, as the reference of the
// invoice audit (which never reads the catalog) and enriches the catalog:
// product description and NCM, supplier address and country.

export type ReferenceLoadKind = "PRODUCT_DATABASE" | "MANUFACTURER_LIST";
export type ProductRow = { sourceRow: number; productCode: string; description: string; ncm: string };
export type ManufacturerRow = { sourceRow: number; name: string; address: string; country: string; code: string };

const fileFields = {
  fileName: z.string().trim().min(1).max(255),
  fileSha256: z.string().regex(/^[0-9a-f]{64}$/u),
};
const sourceRow = z.number().int().positive().max(1_048_576);
const productRow = z.object({ sourceRow, productCode: z.string().max(120), description: z.string().max(2000),
  ncm: z.string().max(20) }).strict();
const manufacturerRow = z.object({ sourceRow, name: z.string().max(240), address: z.string().max(500),
  country: z.string().max(120), code: z.string().max(120) }).strict();
export const referenceLoadBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PRODUCT_DATABASE"), ...fileFields, duplicated: z.number().int().min(0),
    rows: z.array(productRow).min(1).max(5000) }).strict(),
  z.object({ kind: z.literal("MANUFACTURER_LIST"), ...fileFields,
    rows: z.array(manufacturerRow).min(1).max(5000) }).strict(),
]);
export type ReferenceLoadBody = z.infer<typeof referenceLoadBody>;

export type RefusedRow = { sourceRow: number; reason: "CODE_MISSING" | "DESCRIPTION_MISSING" | "NCM_INVALID"
  | "CODE_REPEATED" | "ROW_REPEATED" | "CONTENT_MISSING" };

const codeKey = (value: string) => value.trim().toLocaleUpperCase("en-US");
const lettersKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/gu, "")
  .toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "");
/** TOTVS supplier code of a manufacturer: only these rows enrich the catalog (user decision, 2026-11-11). */
export const isTotvsSupplierCode = (code: string) => /^EX[0-9]+$/iu.test(code.trim());

/** Rows the load refuses: nothing is written while any is left. */
export function refusedRows(body: ReferenceLoadBody): RefusedRow[] {
  const refused: RefusedRow[] = [];
  const rows = new Set<number>(), codes = new Set<string>();
  for (const row of body.rows) {
    if (rows.has(row.sourceRow)) { refused.push({ sourceRow: row.sourceRow, reason: "ROW_REPEATED" }); continue; }
    rows.add(row.sourceRow);
    if (body.kind === "PRODUCT_DATABASE") {
      const product = row as ProductRow;
      const code = codeKey(product.productCode);
      if (!code) refused.push({ sourceRow: row.sourceRow, reason: "CODE_MISSING" });
      else if (codes.has(code)) refused.push({ sourceRow: row.sourceRow, reason: "CODE_REPEATED" });
      else if (!product.description.trim()) refused.push({ sourceRow: row.sourceRow, reason: "DESCRIPTION_MISSING" });
      else if (!/^[0-9]{8}$/u.test(product.ncm)) refused.push({ sourceRow: row.sourceRow, reason: "NCM_INVALID" });
      codes.add(code);
    } else {
      const manufacturer = row as ManufacturerRow;
      if (!manufacturer.name.trim() && !manufacturer.address.trim()) {
        refused.push({ sourceRow: row.sourceRow, reason: "CONTENT_MISSING" });
      }
    }
  }
  return refused;
}

type FieldChange = { field: string; from: string | null; to: string };
export type CatalogProduct = { id: string; code: string; name: string; ncm: string | null };
export type ProductPlan = {
  created: ProductRow[];
  updated: { id: string; code: string; name: string; ncm: string; changes: FieldChange[] }[];
  unchanged: number; descriptionChanged: number; ncmFilled: number;
  ncmChanged: { productCode: string; from: string; to: string }[];
};

/** What the DATABASE changes in the products: description and NCM, by code; a missing product is created. */
export function planProductLoad(rows: readonly ProductRow[], catalog: readonly CatalogProduct[]): ProductPlan {
  const byCode = new Map(catalog.map(product => [codeKey(product.code), product]));
  const plan: ProductPlan = { created: [], updated: [], unchanged: 0, descriptionChanged: 0, ncmFilled: 0, ncmChanged: [] };
  for (const row of rows) {
    const product = byCode.get(codeKey(row.productCode));
    if (!product) { plan.created.push(row); continue; }
    const changes: FieldChange[] = [];
    if (product.name !== row.description) {
      changes.push({ field: "name", from: product.name, to: row.description });
      plan.descriptionChanged += 1;
    }
    if (product.ncm !== row.ncm) {
      changes.push({ field: "product_ncm_code", from: product.ncm, to: row.ncm });
      if (product.ncm) plan.ncmChanged.push({ productCode: product.code, from: product.ncm, to: row.ncm });
      else plan.ncmFilled += 1;
    }
    if (changes.length) plan.updated.push({ id: product.id, code: product.code, name: row.description, ncm: row.ncm, changes });
    else plan.unchanged += 1;
  }
  return plan;
}

export type CatalogSupplier = { id: string; code: string; name: string; address: string | null; country: string | null };
export type ManufacturerPlan = {
  created: ManufacturerRow[];
  updated: { id: string; code: string; address: string; country: string; changes: FieldChange[] }[];
  unchanged: number;
  withoutTotvsCode: { sourceRow: number; code: string; name: string }[];
  repeatedCodes: { sourceRow: number; code: string }[];
  ambiguousCodes: string[];
  nameDifferences: { code: string; listName: string; catalogName: string }[];
};

/**
 * What the manufacturer list changes in the global suppliers, by TOTVS code: address and country (the supplier
 * name is kept). A code missing from the catalog becomes a supplier; a row without an EX code stays out of the
 * catalog (it still is part of the audit reference); a repeated code counts by its first row.
 */
export function planManufacturerLoad(rows: readonly ManufacturerRow[], catalog: readonly CatalogSupplier[]): ManufacturerPlan {
  const byCode = new Map<string, CatalogSupplier[]>();
  for (const supplier of catalog) byCode.set(codeKey(supplier.code), [...byCode.get(codeKey(supplier.code)) ?? [], supplier]);
  const plan: ManufacturerPlan = { created: [], updated: [], unchanged: 0, withoutTotvsCode: [], repeatedCodes: [],
    ambiguousCodes: [], nameDifferences: [] };
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isTotvsSupplierCode(row.code)) {
      plan.withoutTotvsCode.push({ sourceRow: row.sourceRow, code: row.code, name: row.name });
      continue;
    }
    const code = codeKey(row.code);
    if (seen.has(code)) { plan.repeatedCodes.push({ sourceRow: row.sourceRow, code: row.code.trim() }); continue; }
    seen.add(code);
    const suppliers = byCode.get(code) ?? [];
    if (suppliers.length > 1) { plan.ambiguousCodes.push(row.code.trim()); continue; }
    const supplier = suppliers[0];
    const address = row.address.trim(), country = row.country.trim();
    if (!supplier) { plan.created.push({ ...row, code: row.code.trim() }); continue; }
    if (lettersKey(supplier.name) !== lettersKey(row.name)) {
      plan.nameDifferences.push({ code: supplier.code, listName: row.name, catalogName: supplier.name });
    }
    const changes: FieldChange[] = [];
    if (address && supplier.address !== address) changes.push({ field: "supplier_address", from: supplier.address, to: address });
    if (country && supplier.country !== country) changes.push({ field: "supplier_country", from: supplier.country, to: country });
    if (changes.length) {
      plan.updated.push({ id: supplier.id, code: supplier.code, address: address || supplier.address || "",
        country: country || supplier.country || "", changes });
    } else plan.unchanged += 1;
  }
  return plan;
}

export type NcmStatus = { code: string; status: "OFFICIAL_VALID" | "OFFICIAL_NOT_VALID" | "NOT_IN_OFFICIAL";
  officialName: string | null; products: number };

/** The NCMs of the DATABASE missing from the NCM catalog, classified by the persisted official catalog. */
export async function unregisteredNcms(db: Pick<PoolClient, "query">, rows: readonly { ncm: string }[], today: string):
  Promise<NcmStatus[]> {
  const counts = new Map<string, number>();
  for (const row of rows) if (/^[0-9]{8}$/u.test(row.ncm)) counts.set(row.ncm, (counts.get(row.ncm) ?? 0) + 1);
  const codes = [...counts.keys()];
  if (!codes.length) return [];
  const registered = await db.query<{ code: string }>(
    `SELECT normalized_code AS code FROM catalog.entry WHERE kind = 'NCM' AND normalized_code = ANY($1::text[])`, [codes]);
  const known = new Set(registered.rows.map(row => row.code));
  const missing = codes.filter(code => !known.has(code)).sort();
  if (!missing.length) return [];
  // Only the codes needed, never the whole official catalog (AGENTS.md: VPS memory).
  const official = await db.query<{ code: string; name: string; validFrom: string; validTo: string | null }>(
    `SELECT code, name, valid_from::text AS "validFrom", valid_to::text AS "validTo"
     FROM catalog.ncm_official_item WHERE code = ANY($1::text[])`, [missing]);
  const byCode = new Map(official.rows.map(row => [row.code, row]));
  return missing.map(code => {
    const item = byCode.get(code);
    const valid = item && item.validFrom <= today && (item.validTo === null || item.validTo >= today);
    return { code, status: !item ? "NOT_IN_OFFICIAL" : valid ? "OFFICIAL_VALID" : "OFFICIAL_NOT_VALID",
      officialName: item?.name ?? null, products: counts.get(code) ?? 0 };
  });
}

function brasiliaToday(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

type LoadMeta = { id: string; kind: ReferenceLoadKind; fileName: string; fileSha256: string; rowCount: number;
  summary: Record<string, unknown>; loadedAt: string; loadedBy: string };
const loadColumns = `load.id, load.kind, load.file_name AS "fileName", load.file_sha256 AS "fileSha256",
  load.row_count AS "rowCount", load.summary, load.loaded_at AS "loadedAt",
  coalesce(nullif(btrim(person.display_name), ''), person.subject) AS "loadedBy"`;
async function latestLoad(db: Pick<PoolClient, "query">, kind: ReferenceLoadKind): Promise<LoadMeta | null> {
  const result = await db.query<LoadMeta>(`SELECT ${loadColumns} FROM catalog.reference_load AS load
    JOIN identity.erp_user AS person ON person.id = load.loaded_by
    WHERE load.kind = $1 ORDER BY load.loaded_at DESC, load.id DESC LIMIT 1`, [kind]);
  return result.rows[0] ?? null;
}

async function readProducts(db: Pick<PoolClient, "query">, rows: readonly ProductRow[], lock: boolean) {
  const result = await db.query<CatalogProduct>(
    `SELECT id, code, name, product_ncm_code AS ncm FROM catalog.entry
     WHERE kind = 'PRODUCT' AND importer IS NULL AND normalized_code = ANY($1::text[])${lock ? " FOR UPDATE" : ""}`,
    [rows.map(row => codeKey(row.productCode))]);
  return result.rows;
}
async function readSuppliers(db: Pick<PoolClient, "query">, rows: readonly ManufacturerRow[], lock: boolean) {
  const result = await db.query<CatalogSupplier>(
    `SELECT id, code, name, supplier_address AS address, supplier_country AS country FROM catalog.entry
     WHERE kind = 'SUPPLIER' AND importer IS NULL AND normalized_code = ANY($1::text[])${lock ? " FOR UPDATE" : ""}`,
    [rows.filter(row => isTotvsSupplierCode(row.code)).map(row => codeKey(row.code))]);
  return result.rows;
}

/** Counts and lists the screen shows before the confirmation and keeps in the load summary. */
function summarize(body: ReferenceLoadBody, plan: ProductPlan | ManufacturerPlan) {
  if (body.kind === "PRODUCT_DATABASE") {
    const products = plan as ProductPlan;
    return { rows: body.rows.length, duplicated: body.duplicated, created: products.created.length,
      createdCodes: products.created.map(row => row.productCode), updated: products.updated.length,
      unchanged: products.unchanged, descriptionChanged: products.descriptionChanged, ncmFilled: products.ncmFilled,
      ncmChanged: products.ncmChanged };
  }
  const suppliers = plan as ManufacturerPlan;
  return { rows: body.rows.length, created: suppliers.created.length, createdCodes: suppliers.created.map(row => row.code),
    updated: suppliers.updated.length, unchanged: suppliers.unchanged, withoutTotvsCode: suppliers.withoutTotvsCode,
    repeatedCodes: suppliers.repeatedCodes, ambiguousCodes: suppliers.ambiguousCodes,
    nameDifferences: suppliers.nameDifferences };
}

const invalidBody = "Envie o tipo da carga, o arquivo (nome e SHA-256) e de 1 a 5.000 linhas lidas da planilha.";
const kindLabel: Record<ReferenceLoadKind, string> = { PRODUCT_DATABASE: "DATABASE de produtos", // i18n-ignore: API text
  MANUFACTURER_LIST: "lista de fabricantes" }; // i18n-ignore: API text

export async function registerReferenceLoadRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/reference-loads", { config: permissionConfig("catalog.read", "global") }, async (_request, reply) => {
    const [products, manufacturers] = await Promise.all([latestLoad(pool, "PRODUCT_DATABASE"), latestLoad(pool, "MANUFACTURER_LIST")]);
    reply.header("cache-control", "no-store");
    return { productDatabase: products, manufacturerList: manufacturers };
  });

  // The invoice audit reference: the rows of the latest load of each kind, in the shape of the spreadsheet reader.
  app.get("/api/v1/reference-loads/audit-reference", { config: permissionConfig("catalog.read", "global") },
    async (_request, reply) => {
      const [products, manufacturers] = await Promise.all([latestLoad(pool, "PRODUCT_DATABASE"), latestLoad(pool, "MANUFACTURER_LIST")]);
      const [productRows, manufacturerRows] = await Promise.all([
        products ? pool.query<ProductRow>(`SELECT source_row AS "sourceRow", product_code AS "productCode", description, ncm
          FROM catalog.reference_product_row WHERE load_id = $1 ORDER BY source_row`, [products.id]) : null,
        manufacturers ? pool.query<ManufacturerRow>(`SELECT source_row AS "sourceRow", name, address, country, code
          FROM catalog.reference_manufacturer_row WHERE load_id = $1 ORDER BY source_row`, [manufacturers.id]) : null,
      ]);
      reply.header("cache-control", "no-store");
      return {
        productDatabase: products && productRows ? { loadId: products.id, fileName: products.fileName,
          fileSha256: products.fileSha256, loadedAt: products.loadedAt, loadedBy: products.loadedBy,
          duplicated: Number(products.summary.duplicated ?? 0), products: productRows.rows } : null,
        manufacturerList: manufacturers && manufacturerRows ? { loadId: manufacturers.id, fileName: manufacturers.fileName,
          fileSha256: manufacturers.fileSha256, loadedAt: manufacturers.loadedAt, loadedBy: manufacturers.loadedBy,
          manufacturers: manufacturerRows.rows } : null,
      };
    });

  // The NCMs of the latest DATABASE load still missing from the NCM catalog, so they can be registered at any time.
  app.get("/api/v1/reference-loads/pending-ncms", { config: permissionConfig("reference-loads.manage", "global") },
    async (_request, reply) => {
      const load = await latestLoad(pool, "PRODUCT_DATABASE");
      const rows = load ? (await pool.query<{ ncm: string }>(
        "SELECT ncm FROM catalog.reference_product_row WHERE load_id = $1", [load.id])).rows : [];
      reply.header("cache-control", "no-store");
      return { ncms: await unregisteredNcms(pool, rows, brasiliaToday()) };
    });

  app.post("/api/v1/reference-loads/preview", { config: permissionConfig("reference-loads.manage", "global") },
    async (request, reply) => {
      const parsed = referenceLoadBody.safeParse(request.body);
      if (!parsed.success) return problem(reply, 400, "INVALID_REFERENCE_LOAD", invalidBody);
      const body = parsed.data;
      const refused = refusedRows(body);
      const latest = await latestLoad(pool, body.kind);
      const plan = body.kind === "PRODUCT_DATABASE"
        ? planProductLoad(body.rows, await readProducts(pool, body.rows, false))
        : planManufacturerLoad(body.rows, await readSuppliers(pool, body.rows, false));
      reply.header("cache-control", "no-store");
      return { kind: body.kind, refused, summary: summarize(body, plan),
        ncms: body.kind === "PRODUCT_DATABASE" ? await unregisteredNcms(pool, body.rows, brasiliaToday()) : [],
        sameAsLatest: latest?.fileSha256 === body.fileSha256 };
    });

  app.post("/api/v1/reference-loads", { config: permissionConfig("reference-loads.manage", "global") },
    async (request, reply) => {
      const parsed = referenceLoadBody.safeParse(request.body);
      if (!parsed.success) return problem(reply, 400, "INVALID_REFERENCE_LOAD", invalidBody);
      const actor = request.authContext;
      if (!actor) return problem(reply, 401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
      const body = parsed.data;
      const refused = refusedRows(body);
      if (refused.length) {
        return problem(reply, 422, "REFERENCE_ROWS_REFUSED",
          `A planilha tem ${refused.length} linha(s) recusada(s); corrija a planilha antes de carregar.`);
      }
      return transaction(pool, reply, async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`catalog:reference-load:${body.kind}`]);
        const latest = await latestLoad(client, body.kind);
        const plan = body.kind === "PRODUCT_DATABASE"
          ? planProductLoad(body.rows, await readProducts(client, body.rows, true))
          : planManufacturerLoad(body.rows, await readSuppliers(client, body.rows, true));
        const summary = summarize(body, plan);
        // The same file again, with nothing left to change in the catalog, keeps the latest load.
        if (latest && latest.fileSha256 === body.fileSha256 && plan.created.length === 0 && plan.updated.length === 0) {
          return { alreadyLoaded: true, load: latest, summary };
        }
        const loadId = randomUUID();
        await client.query(`INSERT INTO catalog.reference_load (id, kind, file_name, file_sha256, row_count, summary, loaded_by,
            loaded_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, clock_timestamp())`,
        [loadId, body.kind, body.fileName, body.fileSha256, body.rows.length, JSON.stringify(summary), actor.userId]);
        if (body.kind === "PRODUCT_DATABASE") {
          await client.query(`INSERT INTO catalog.reference_product_row (load_id, source_row, product_code, description, ncm)
            SELECT $1::uuid, r."sourceRow", r."productCode", r.description, r.ncm
            FROM jsonb_to_recordset($2::jsonb) AS r("sourceRow" integer, "productCode" text, description text, ncm text)`,
          [loadId, JSON.stringify(body.rows)]);
        } else {
          await client.query(`INSERT INTO catalog.reference_manufacturer_row (load_id, source_row, name, address, country, code)
            SELECT $1::uuid, r."sourceRow", r.name, r.address, r.country, r.code
            FROM jsonb_to_recordset($2::jsonb) AS r("sourceRow" integer, name text, address text, country text, code text)`,
          [loadId, JSON.stringify(body.rows)]);
        }
        await enrichCatalog(client, body, plan, loadId, actor);
        await record(client, "REFERENCE_LOAD", loadId, "REFERENCE_LOAD", loadId, "CREATE", null,
          { kind: body.kind, fileName: body.fileName, fileSha256: body.fileSha256, summary }, actor,
          `Carga da ${kindLabel[body.kind]} ${body.fileName}.`);
        const load = await latestLoad(client, body.kind);
        if (!load || load.id !== loadId) throw new BusinessError(409, "REFERENCE_LOAD_CONFLICT", "Outra carga foi gravada ao mesmo tempo.");
        return { alreadyLoaded: false, load, summary };
      }, 201);
    });
}

type AuditEvent = { id: string; entityId: string; operation: "CREATE" | "UPDATE"; field: string | null;
  before: unknown; after: unknown; correlationId: string };
type OutboxEvent = { eventId: string; eventType: string; aggregateId: string; payload: unknown };

/** The catalog changes of the load, with one audit event per changed field and one outbox event per entry. */
async function enrichCatalog(client: PoolClient, body: ReferenceLoadBody, plan: ProductPlan | ManufacturerPlan,
  loadId: string, actor: { userId: string; issuer: string; subject: string }) {
  const reason = `Carga da ${kindLabel[body.kind]} ${body.fileName} (${loadId}).`;
  const evidence = `Carga da ${kindLabel[body.kind]}: ${body.fileName}, SHA-256 ${body.fileSha256}.`;
  const kind = body.kind === "PRODUCT_DATABASE" ? "PRODUCT" : "SUPPLIER";
  const audit: AuditEvent[] = [], outbox: OutboxEvent[] = [];
  const created = body.kind === "PRODUCT_DATABASE"
    ? (plan as ProductPlan).created.map(row => ({ id: randomUUID(), aliasId: randomUUID(), code: row.productCode.trim(),
      name: row.description, ncm: row.ncm, address: null, country: null }))
    : (plan as ManufacturerPlan).created.map(row => ({ id: randomUUID(), aliasId: randomUUID(), code: row.code,
      name: row.name.trim(), ncm: null, address: row.address.trim() || null, country: row.country.trim() || null }));
  for (const entry of created) {
    const correlationId = randomUUID();
    audit.push({ id: randomUUID(), entityId: entry.id, operation: "CREATE", field: null, before: null,
      after: { kind, code: entry.code, name: entry.name, ...(kind === "PRODUCT" ? { ncmCode: entry.ncm }
        : { address: entry.address, country: entry.country }), provenance: "REFERENCE_LOAD", loadId }, correlationId });
    outbox.push({ eventId: correlationId, eventType: "catalog.entry.created", aggregateId: entry.id,
      payload: { id: entry.id, importer: null, kind, version: 1, loadId } });
  }
  for (const entry of plan.updated) {
    const correlationId = randomUUID();
    for (const change of entry.changes) {
      audit.push({ id: randomUUID(), entityId: entry.id, operation: "UPDATE", field: change.field, before: change.from,
        after: change.to, correlationId });
    }
    outbox.push({ eventId: correlationId, eventType: "catalog.entry.updated", aggregateId: entry.id,
      payload: { id: entry.id, importer: null, kind, changedFields: entry.changes.map(change => change.field), loadId } });
  }
  if (created.length) {
    await client.query(`INSERT INTO catalog.entry (id, importer, kind, code, name, product_ncm_code, supplier_address,
        supplier_country, provenance, evidence, created_by, updated_by)
      SELECT c.id, NULL, $2::varchar, c.code, c.name, c.ncm, c.address, c.country, 'REFERENCE_LOAD', $3::text, $4::uuid, $4::uuid
      FROM jsonb_to_recordset($1::jsonb) AS c(id uuid, code text, name text, ncm text, address text, country text)`,
    [JSON.stringify(created), kind, evidence, actor.userId]);
    await client.query(`INSERT INTO catalog.entry_alias (id, entry_id, raw_code, source_kind, created_by)
      SELECT c."aliasId", c.id, c.code, 'MANUAL_ENTRY', $2::uuid
      FROM jsonb_to_recordset($1::jsonb) AS c(id uuid, "aliasId" uuid, code text)`,
    [JSON.stringify(created), actor.userId]);
  }
  if (plan.updated.length) {
    if (body.kind === "PRODUCT_DATABASE") {
      await client.query(`UPDATE catalog.entry AS e SET name = c.name, product_ncm_code = c.ncm, version = e.version + 1,
          updated_by = $2::uuid, updated_at = now()
        FROM jsonb_to_recordset($1::jsonb) AS c(id uuid, name text, ncm text) WHERE e.id = c.id AND e.kind = 'PRODUCT'`,
      [JSON.stringify((plan as ProductPlan).updated.map(({ id, name, ncm }) => ({ id, name, ncm }))), actor.userId]);
    } else {
      await client.query(`UPDATE catalog.entry AS e SET supplier_address = c.address, supplier_country = c.country,
          version = e.version + 1, updated_by = $2::uuid, updated_at = now()
        FROM jsonb_to_recordset($1::jsonb) AS c(id uuid, address text, country text) WHERE e.id = c.id AND e.kind = 'SUPPLIER'`,
      [JSON.stringify((plan as ManufacturerPlan).updated.map(({ id, address, country }) => ({ id, address, country }))),
        actor.userId]);
    }
  }
  if (audit.length) {
    await client.query(`INSERT INTO audit.audit_log (id, aggregate_type, aggregate_id, entity_type, entity_id, operation,
        field_name, old_value, new_value, actor_id, occurred_at, reason, correlation_id)
      SELECT a.id, 'CATALOG_ENTRY', a."entityId", 'CATALOG_ENTRY', a."entityId", a.operation, a.field, a.before, a.after,
        $2::text, now(), $3::text, a."correlationId"
      FROM jsonb_to_recordset($1::jsonb) AS a(id uuid, "entityId" uuid, operation text, field text, before jsonb,
        after jsonb, "correlationId" uuid)`,
    [JSON.stringify(audit), `${actor.issuer}#${actor.subject}`, reason]);
    await client.query(`INSERT INTO audit.outbox_message (event_id, event_type, aggregate_type, aggregate_id, payload, occurred_at)
      SELECT o."eventId", o."eventType", 'CATALOG_ENTRY', o."aggregateId", o.payload, now()
      FROM jsonb_to_recordset($1::jsonb) AS o("eventId" uuid, "eventType" text, "aggregateId" uuid, payload jsonb)`,
    [JSON.stringify(outbox)]);
  }
}
