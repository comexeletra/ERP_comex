import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";

const quantity = z.string().trim().regex(/^(?:0|[1-9]\d{0,15})(?:[.,]\d{1,8})?$/u)
  .refine(value => !/^0(?:[.,]0+)?$/u.test(value)).transform(value => value.replace(",", "."));
const nonnegative = z.string().trim().regex(/^(?:0|[1-9]\d{0,15})(?:[.,]\d{1,8})?$/u)
  .transform(value => value.replace(",", "."));
const invoiceUnitPrice = z.string().trim().regex(/^(?:0|[1-9]\d{0,15})(?:[.,]\d{1,18})?$/u)
  .transform(value => value.replace(",", "."));
function decimalUnits(value: string): bigint {
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0") || "0");
}
function priceUnits(value: string): bigint {
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  return BigInt(whole) * 1_000_000_000_000_000_000n + BigInt(fraction.padEnd(18, "0") || "0");
}
function absoluteUnits(value: bigint): bigint { return value < 0n ? -value : value; }
const nullableText = (limit: number) => z.string().trim().max(limit).nullable();
const poFields = z.object({
  number: z.string().trim().min(1).max(80),
  purchaseRequestId: z.uuid().nullable().optional(),
  supplierText: nullableText(240), orderDate: z.iso.date().nullable(), notes: z.string().trim().max(4000),
  reason: z.string().trim().min(3).max(1000),
}).strict();
export const createPo = poFields.extend({
  importer: z.string().trim().min(1).max(120),
  supplierText: z.string().trim().min(1).max(240),
});
const processFields = z.object({
  ipNumber: z.string().trim().min(1).max(80),
  supplierText: nullableText(240).optional(),
  logisticsStatus: nullableText(40), priority: nullableText(20),
  notes: z.string().trim().max(4000), reason: z.string().trim().min(3).max(1000),
}).strict();
const createProcess = processFields.extend({
  importer: z.string().trim().min(1).max(120),
  supplierText: z.string().trim().min(1).max(240),
});
const invoiceImport = z.object({
  confirmDuplicateInvoice: z.boolean().optional(),
  orphanPoDecisions: z.array(z.object({ purchaseOrderId: z.uuid(),
    action: z.enum(["KEEP", "REMOVE"]) }).strict()).max(200).optional(),
  process: createProcess,
  invoice: z.object({
    fileName: z.string().trim().min(1).max(255), number: z.string().trim().min(1).max(120),
    issueDate: z.iso.date().nullable(), amount: nonnegative, currency: z.string().regex(/^[A-Z]{3}$/u),
    metadata: z.record(z.string(), z.unknown()),
  }).strict(),
  allocations: z.array(z.object({ itemId: z.uuid(), quantity, notes: z.string().trim().max(2000).default("") }).strict())
    .min(1).max(1000),
}).strict();
const invoiceDuplicateQuery = z.object({ importer: z.string().trim().min(1).max(120),
  ipNumber: z.string().trim().min(1).max(80), invoiceNumber: z.string().trim().min(1).max(120),
  exporterText: z.string().trim().min(1).max(240), fileSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional() });
const updateProcessFields = processFields.extend({
  importer: z.string().trim().min(1).max(120).optional(),
});
export const itemFields = z.object({
  externalLineReference: nullableText(80), productCode: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000), orderedQuantity: quantity,
  unit: z.string().trim().min(1).max(32), unitPrice: nonnegative.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/u).nullable(),
  reason: z.string().trim().min(3).max(1000),
}).strict().refine(value => (value.unitPrice === null) === (value.currency === null));
const allocationFields = z.object({
  quantity, notes: z.string().trim().max(2000), reason: z.string().trim().min(3).max(1000),
}).strict();
const createAllocation = allocationFields.extend({
  itemId: z.uuid(), processId: z.uuid(), factoryShipDate: z.iso.date().nullable().optional(),
});
const updateAllocation = z.object({
  quantity: quantity.optional(), notes: z.string().trim().max(2000).optional(),
  factoryShipDate: z.iso.date().nullable().optional(), reason: z.string().trim().min(3).max(1000),
}).strict().refine(value => value.quantity !== undefined || value.notes !== undefined
  || value.factoryShipDate !== undefined);
const cancelAllocation = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
const closeProcess = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
const cancelProcess = z.object({
  reason: z.string().trim().min(3).max(1000),
  purchaseOrders: z.array(z.discriminatedUnion("destinationType", [
    z.object({ purchaseOrderId: z.uuid(), destinationType: z.literal("IDLE") }).strict(),
    z.object({ purchaseOrderId: z.uuid(), destinationType: z.literal("EXISTING"), processId: z.uuid() }).strict(),
    z.object({ purchaseOrderId: z.uuid(), destinationType: z.literal("NEW"), ipNumber: z.string().trim().min(1).max(80) }).strict(),
  ])).max(200),
}).strict();
const invoiceCandidateQuery = z.object({
  importer: z.string().trim().min(1).max(120),
  productCode: z.string().trim().min(1).max(120),
  sourcePoNumber: z.string().trim().min(1).max(80),
  revisingIpNumber: z.string().trim().max(80).optional(),
}).strict();
const invoiceCatalogUpdates = z.object({
  products: z.array(z.object({ productCode: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(2000), ncmCode: z.string().regex(/^\d{8}$/u).nullable(),
    manufacturer: nullableText(240), manufacturerAddress: nullableText(500), manufacturerCountry: nullableText(120) }).strict()).max(1000),
  poItems: z.array(z.object({ itemId: z.uuid(), description: z.string().trim().min(1).max(1000),
    unitPrice: nonnegative, currency: z.string().regex(/^[A-Z]{3}$/u), ncmCode: z.string().regex(/^\d{8}$/u).nullable() }).strict()).max(1000),
}).strict();
const uuid = z.uuid();

export class BusinessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string,
    readonly ipNumbers?: string[]) { super(message); }
}
export function problem(reply: FastifyReply, status: number, code: string, detail: string, ipNumbers?: string[]) {
  return reply.code(status).send({ type: "about:blank", title: detail, status, detail,
    instance: reply.request.url.split("?", 1)[0], traceId: reply.request.id, code,
    ...(ipNumbers ? { ipNumbers } : {}) });
}
function normalizePoNumber(value: string): string {
  return value.toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "").replace(/^PO/u, "");
}
function normalizeSupplier(value: string | null | undefined): string {
  return (value ?? "").toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "");
}
async function findDuplicateInvoiceIpNumbers(queryable: Pool | PoolClient, invoiceNumber: string,
  exporterText: string, fileSha256: string | undefined, ipNumber: string): Promise<string[]> {
  const potentialDuplicates = await queryable.query<{ number: string; notes: string; ip_number: string;
    supplier_text: string | null }>(
    `SELECT document.number, document.notes, process.ip_number, process.supplier_text
     FROM imports.process_document document
     JOIN imports.import_process process ON process.id = document.process_id
     WHERE document.kind = 'INVOICE' AND document.status = 'ACTIVE'
       AND process.record_status = 'ACTIVE'
       AND process.normalized_ip_number <> upper(btrim($3))
       AND (regexp_replace(upper(document.number), '[^A-Z0-9]', '', 'g') = $1
         OR ($2::text IS NOT NULL AND document.notes LIKE '%' || $2 || '%'))`,
    [normalizeSupplier(invoiceNumber), fileSha256 ?? null, ipNumber]);
  return [...new Set(potentialDuplicates.rows.filter(candidate => {
    let savedHash: unknown;
    try { savedHash = JSON.parse(candidate.notes).fileSha256; } catch { savedHash = undefined; }
    return Boolean(fileSha256 && savedHash === fileSha256)
      || (normalizeSupplier(candidate.number) === normalizeSupplier(invoiceNumber)
        && normalizeSupplier(candidate.supplier_text) === normalizeSupplier(exporterText));
  }).map(candidate => candidate.ip_number))];
}
export function keyFrom(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !/^[\x21-\x7e]{1,128}$/u.test(key)) {
    throw new BusinessError(400, "INVALID_IDEMPOTENCY_KEY", "Informe Idempotency-Key válido.");
  }
  return key;
}
export function versionFrom(request: FastifyRequest): string {
  const value = request.headers["x-record-version"] ?? request.headers["if-match"];
  if (value === undefined) throw new BusinessError(428, "PRECONDITION_REQUIRED", "Informe X-Record-Version com a versão atual.");
  if (typeof value !== "string" || !/^"[0-9]+"$/u.test(value)) {
    if (typeof value === "string" && /^[0-9]+$/u.test(value)) return `"${value}"`;
    throw new BusinessError(400, "INVALID_VERSION", "X-Record-Version inválido.");
  }
  return value;
}
export function actorAndScopes(request: FastifyRequest) {
  const actor = request.authContext;
  const auth = request.authorizationContext;
  if (!actor || !auth) throw new BusinessError(401, "AUTHENTICATION_REQUIRED", "Sessão ausente.");
  return { actor, scopes: auth.importerScopes };
}
function inScope(importer: string, scopes: readonly string[]) {
  if (!scopes.includes(importer)) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Importadora fora do seu escopo.");
}
export async function transaction<T>(pool: Pool, reply: FastifyReply, fn: (client: PoolClient) => Promise<T>, status = 200) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return reply.code(status).send(result);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message, error.ipNumbers);
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "23505") return problem(reply, 409, "DUPLICATE_RECORD", "Já existe um registro com essa identidade ou vínculo.");
    if (code === "23514") return problem(reply, 409, "BUSINESS_CONSTRAINT", "A quantidade ou o vínculo viola uma regra do pedido.");
    throw error;
  } finally { client.release(); }
}
export async function receipt(client: PoolClient, actorId: string, key: string, type: string, payload: unknown) {
  const hash = createHash("sha256").update(JSON.stringify({ type, payload })).digest("hex");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`operational:${actorId}:${key}`]);
  const previous = await client.query<{ payload_sha256: string; resource_type: string; resource_id: string }>(
    `SELECT payload_sha256, resource_type, resource_id FROM procurement.operational_command_receipt
     WHERE actor_user_id = $1 AND idempotency_key = $2`, [actorId, key]);
  if (previous.rows[0]) {
    if (previous.rows[0].payload_sha256.trim() !== hash || previous.rows[0].resource_type !== type) {
      throw new BusinessError(409, "IDEMPOTENCY_KEY_REUSED", "Chave já usada com outro conteúdo.");
    }
    return { hash, existingId: previous.rows[0].resource_id };
  }
  return { hash, existingId: null };
}
export async function saveReceipt(client: PoolClient, actorId: string, key: string, hash: string, type: string, id: string) {
  await client.query(
    `INSERT INTO procurement.operational_command_receipt
     (actor_user_id,idempotency_key,payload_sha256,resource_type,resource_id)
     VALUES ($1,$2,$3,$4,$5)`, [actorId, key, hash, type, id]);
}
export async function record(client: PoolClient, aggregateType: string, aggregateId: string,
  entityType: string, entityId: string, operation: string, before: unknown, after: unknown,
  actor: { issuer: string; subject: string }, reason: string) {
  const eventId = randomUUID();
  await client.query(
    `INSERT INTO audit.audit_log
     (id,aggregate_type,aggregate_id,entity_type,entity_id,operation,field_name,old_value,new_value,
      actor_id,occurred_at,reason,correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,$7::jsonb,$8::jsonb,$9,now(),$10,$11)`,
    [randomUUID(), aggregateType, aggregateId, entityType, entityId, operation,
      before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after),
      `${actor.issuer}#${actor.subject}`, reason, eventId]);
  await client.query(
    `INSERT INTO audit.outbox_message
     (event_id,event_type,aggregate_type,aggregate_id,payload,occurred_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,now())`,
    [eventId, `comex.${entityType.toLowerCase()}.${operation.toLowerCase()}`,
      aggregateType, aggregateId, JSON.stringify({ aggregateId, entityId, operation })]);
}
async function knownImporter(client: PoolClient, importer: string) {
  const result = await client.query(
    `SELECT importer FROM procurement.purchase_order WHERE importer = $1
     UNION SELECT importer FROM imports.import_process WHERE importer = $1
     UNION SELECT value AS importer FROM catalog.operational_value WHERE entity_key = 'IMPORTER' AND value = $1
     LIMIT 1`, [importer]);
  if (!result.rowCount) throw new BusinessError(404, "UNKNOWN_IMPORTER", "Importadora ainda não cadastrada.");
}
export async function lockedPo(client: PoolClient, id: string, scopes: string[]) {
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM procurement.purchase_order WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE`,
    [id, scopes]);
  if (!result.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "PO não encontrada.");
  return result.rows[0];
}
export async function validatePurchaseRequest(client: PoolClient, id: string | null | undefined, importer: string) {
  if (!id) return;
  const result = await client.query(
    `SELECT id FROM procurement.purchase_request WHERE id = $1 AND importer = $2`, [id, importer]);
  if (!result.rows[0]) throw new BusinessError(404, "PURCHASE_REQUEST_NOT_FOUND", "SC não encontrada para esta importadora.");
}
export function checkVersion(row: Record<string, unknown>, expected: string) {
  if (`"${row.version}"` !== expected) {
    throw new BusinessError(409, "VERSION_CONFLICT", "Registro alterado. Recarregue antes de salvar.");
  }
}

export async function registerOperationalRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/processes/invoice-duplicates", { config: permissionConfig("processes.write") },
    async (request, reply) => {
      const parsed = invoiceDuplicateQuery.safeParse(request.query);
      if (!parsed.success) return problem(reply, 400, "INVALID_INVOICE_DUPLICATE_QUERY", "Informe os dados da invoice.");
      try { inScope(parsed.data.importer, request.authorizationContext?.importerScopes ?? []); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      const [ipNumbers, existing] = await Promise.all([
        findDuplicateInvoiceIpNumbers(pool, parsed.data.invoiceNumber,
          parsed.data.exporterText, parsed.data.fileSha256, parsed.data.ipNumber),
        pool.query<{ importer: string }>(`SELECT importer FROM imports.import_process
          WHERE normalized_ip_number = upper(btrim($1)) LIMIT 1`, [parsed.data.ipNumber]),
      ]);
      return { ipNumbers, ipReferenceOtherImporter: Boolean(existing.rows[0]
        && existing.rows[0].importer !== parsed.data.importer) };
    });

  app.post("/api/v1/processes/import-invoice", { config: permissionConfig("processes.write") },
    async (request, reply) => {
      const parsed = invoiceImport.safeParse(request.body);
      if (!parsed.success) return problem(reply, 400, "INVALID_INVOICE_IMPORT", "Revise os dados da invoice e as associações de PO.");
      let key: string; let auth: ReturnType<typeof actorAndScopes>;
      try {
        key = keyFrom(request); auth = actorAndScopes(request); inScope(parsed.data.process.importer, auth.scopes);
      } catch (error) {
        if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message);
        throw error;
      }
      const body = parsed.data;
      return transaction(pool, reply, async client => {
        const command = await receipt(client, auth.actor.userId, key, "IP_INVOICE_IMPORT", body);
        if (command.existingId) return { id: command.existingId, replayed: true };
        await knownImporter(client, body.process.importer);
        const invoiceImporterCnpj = typeof body.invoice.metadata.importerCnpj === "string"
          ? body.invoice.metadata.importerCnpj.replace(/\D/gu, "") : "";
        const importerCnpj = invoiceImporterCnpj.length === 14 ? await client.query(
          `SELECT 1 FROM catalog.operational_value
           WHERE entity_key = 'IMPORTER' AND value = $1
             AND regexp_replace(coalesce(cnpj, ''), '[^0-9]', '', 'g') = $2`,
          [body.process.importer, invoiceImporterCnpj]) : { rowCount: 0 };
        const confirmImporterCnpjMismatch = body.invoice.metadata.confirmImporterCnpjMismatch === true;
        if (!importerCnpj.rowCount && !confirmImporterCnpjMismatch) {
          throw new BusinessError(409, "INVOICE_IMPORTER_CNPJ_MISMATCH",
            "Confirme a selecao manual quando o CNPJ do cabecalho nao corresponder a importadora selecionada.");
        }
        const invoiceIpReference = typeof body.invoice.metadata.ipNumberFromInvoice === "string"
          ? body.invoice.metadata.ipNumberFromInvoice.trim() : "";
        if (!invoiceIpReference || invoiceIpReference.toLocaleUpperCase("en-US") !== body.process.ipNumber.trim().toLocaleUpperCase("en-US")) {
          throw new BusinessError(400, "INVOICE_IP_REFERENCE_MISMATCH", "IP REF must match the invoice header.");
        }
        const fileSha256 = body.invoice.metadata.fileSha256;
        if (fileSha256 !== undefined && (typeof fileSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(fileSha256))) {
          throw new BusinessError(400, "INVALID_INVOICE_FILE_HASH", "O SHA-256 do arquivo da invoice é inválido.");
        }
        const invoiceAssignments = z.array(z.object({ itemId: z.uuid(), poNumber: z.string().trim().min(1).max(80),
          sourcePoNumber: z.string().trim().min(1).max(80), poProductCode: z.string().trim().min(1).max(120),
          confirmCodeMismatch: z.boolean(), confirmSupplierMismatch: z.boolean(),
          confirmUnitMismatch: z.boolean().optional(), confirmPriceMismatch: z.boolean().optional(), quantity,
          productCode: z.string().trim().min(1).max(120),
          sourceRow: z.number().int().positive() }).strict())
          .min(1).max(2000).safeParse(body.invoice.metadata.assignments);
        if (!invoiceAssignments.success) throw new BusinessError(400, "INVALID_INVOICE_ASSIGNMENTS", "Invoice assignments are required.");
        const invoiceLines = z.array(z.object({ sourceRow: z.number().int().positive(),
          productCode: z.string().trim().min(1).max(120), quantity, poCell: z.string(),
          amount: nonnegative.optional(), unitPrice: invoiceUnitPrice.optional(),
          ncm: z.string().regex(/^\d{8}$/u).optional(),
          unit: z.string().trim().min(1).max(32).optional(),
          description: z.string().trim().min(1).max(1000).optional() }).passthrough())
          .min(1).max(2000).safeParse(body.invoice.metadata.lines);
        if (!invoiceLines.success) throw new BusinessError(400, "INVALID_INVOICE_LINES", "Invoice lines are required.");
        if (body.invoice.currency !== "CNY") {
          throw new BusinessError(400, "INVALID_INVOICE_CURRENCY", "A carga de invoice aceita somente CNY.");
        }
        const lineByRow = new Map(invoiceLines.data.map(line => [line.sourceRow, line]));
        if (lineByRow.size !== invoiceLines.data.length) {
          throw new BusinessError(400, "INVALID_INVOICE_LINES", "A invoice contém linhas repetidas.");
        }
        const linesWithAmounts = invoiceLines.data.filter(line => line.amount !== undefined);
        if (linesWithAmounts.length) {
          const lineAmountTotal = linesWithAmounts.reduce((total, line) => total + decimalUnits(line.amount!), 0n);
          if (linesWithAmounts.length !== invoiceLines.data.length
            || absoluteUnits(lineAmountTotal - decimalUnits(body.invoice.amount)) > 1_000_000n) {
            throw new BusinessError(400, "INVOICE_TOTAL_MISMATCH", "O valor da invoice não confere com a soma das linhas.");
          }
        }
        for (const line of invoiceLines.data) {
          if (line.amount === undefined || line.unitPrice === undefined) continue;
          const calculated = (decimalUnits(line.quantity) * priceUnits(line.unitPrice)
            + 500_000_000_000_000_000n) / 1_000_000_000_000_000_000n;
          if (absoluteUnits(calculated - decimalUnits(line.amount)) > 1_100_000n) {
            throw new BusinessError(400, "INVOICE_LINE_AMOUNT_MISMATCH",
              `Linha ${line.sourceRow}: quantidade × preço unitário não confere com o valor.`);
          }
        }
        if (body.invoice.metadata.totalQuantity !== undefined) {
          const totalQuantity = nonnegative.safeParse(body.invoice.metadata.totalQuantity);
          if (!totalQuantity.success || absoluteUnits(invoiceLines.data.reduce((total, line) => total + decimalUnits(line.quantity), 0n)
            - decimalUnits(totalQuantity.data)) > 1n) {
            throw new BusinessError(400, "INVOICE_TOTAL_MISMATCH", "A quantidade total não confere com as linhas.");
          }
        }
        const assignedByRow = new Map<number, number>();
        for (const assignment of invoiceAssignments.data) {
          const sourceLine = lineByRow.get(assignment.sourceRow);
          const sourcePoNumbers = sourceLine
            ? [...sourceLine.poCell.matchAll(/\bPO\s*([0-9]{3,})/giu)].map(match => normalizePoNumber(match[0])) : [];
          if (!sourceLine || sourceLine.productCode !== assignment.productCode
            || !sourcePoNumbers.includes(normalizePoNumber(assignment.sourcePoNumber))
            || normalizePoNumber(assignment.poNumber) !== normalizePoNumber(assignment.sourcePoNumber)) {
            throw new BusinessError(400, "INVOICE_LINE_MISMATCH", "Assignment does not match the source invoice line.");
          }
          if (assignment.productCode.trim().toLocaleUpperCase("en-US")
            !== assignment.poProductCode.trim().toLocaleUpperCase("en-US")
            && !assignment.confirmCodeMismatch) {
            throw new BusinessError(400, "INVOICE_CODE_MISMATCH_UNCONFIRMED", "Confirm the product code divergence before approving this PO allocation.");
          }
          assignedByRow.set(assignment.sourceRow,
            (assignedByRow.get(assignment.sourceRow) ?? 0) + Number(assignment.quantity));
        }
        if (invoiceLines.data.some(line => Math.abs((assignedByRow.get(line.sourceRow) ?? 0) - Number(line.quantity)) > 0.00000001)
          || assignedByRow.size !== invoiceLines.data.length) {
          throw new BusinessError(400, "INVOICE_LINE_QUANTITY_MISMATCH", "Assignments must total the source line quantity.");
        }
        const parsedCatalogUpdates = invoiceCatalogUpdates.safeParse(body.invoice.metadata.catalogUpdates ?? { products: [], poItems: [] });
        if (!parsedCatalogUpdates.success) throw new BusinessError(400, "INVALID_INVOICE_CATALOG_UPDATES", "Revise the selected product and PO catalog updates.");
        const catalogUpdates = parsedCatalogUpdates.data;
        const poProductCodes = new Set(invoiceAssignments.data.map(item => item.poProductCode.toLocaleUpperCase("en-US")));
        if (catalogUpdates.products.some(update => !poProductCodes.has(update.productCode.toLocaleUpperCase("en-US")))) {
          throw new BusinessError(400, "INVOICE_CATALOG_UPDATE_MISMATCH", "Catalog updates must match products and PO items selected for this invoice.");
        }
        const aggregated = new Map<string, number>();
        for (const allocation of body.allocations) {
          aggregated.set(allocation.itemId, (aggregated.get(allocation.itemId) ?? 0) + Number(allocation.quantity));
        }
        const assignedTotals = new Map<string, number>();
        for (const assignment of invoiceAssignments.data) {
          assignedTotals.set(assignment.itemId, (assignedTotals.get(assignment.itemId) ?? 0) + Number(assignment.quantity));
        }
        if (assignedTotals.size !== aggregated.size || [...aggregated].some(([itemId, total]) =>
          Math.abs(total - (assignedTotals.get(itemId) ?? Number.NaN)) > 0.00000001)) {
          throw new BusinessError(400, "INVOICE_ALLOCATION_MISMATCH", "As quantidades distribuídas não conferem com as associações da invoice.");
        }
        if (catalogUpdates.poItems.some(update => !aggregated.has(update.itemId))) {
          throw new BusinessError(400, "INVOICE_CATALOG_UPDATE_MISMATCH", "PO item updates must match selected invoice allocations.");
        }
        const exporterText = typeof body.invoice.metadata.exporterText === "string"
          ? body.invoice.metadata.exporterText.trim() : "";
        if (!exporterText || body.process.supplierText?.trim() !== exporterText) {
          throw new BusinessError(400, "INVOICE_EXPORTER_REQUIRED", "O supplier do IP deve corresponder ao campo Exporter da invoice.");
        }
        const duplicateLocks = [
          `invoice-number:${normalizeSupplier(body.invoice.number)}:${normalizeSupplier(exporterText)}`,
          ...(fileSha256 ? [`invoice-file:${fileSha256}`] : []),
        ].sort();
        for (const lock of duplicateLocks) {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lock]);
        }
        const duplicateIpNumbers = await findDuplicateInvoiceIpNumbers(client, body.invoice.number,
          exporterText, fileSha256, body.process.ipNumber);
        if (duplicateIpNumbers.length && !body.confirmDuplicateInvoice) {
          throw new BusinessError(409, "INVOICE_DUPLICATE_UNCONFIRMED",
            "Esta invoice já está associada a outro IP ativo. Confirme a duplicidade para continuar.", duplicateIpNumbers);
        }
        const matchedItems = await client.query<{ id: string; purchase_order_id: string; number: string; importer: string; quantity: string; product_code: string; source_status: string | null; unit: string; unit_price: string | null; currency_code: string | null; supplier_entry_id: string | null; supplier_text: string | null; supplier_name: string | null; supplier_code: string | null }>(
          `SELECT item.id, item.purchase_order_id, po.external_number AS number, po.importer,
                  item.ordered_quantity::text AS quantity, item.product_code, item.source_status,
                  item.unit, item.unit_price::text, item.currency_code,
                  po.supplier_entry_id, po.supplier_text,
                  supplier.name AS supplier_name, supplier.code AS supplier_code
           FROM procurement.purchase_order_item item JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
           LEFT JOIN catalog.entry supplier ON supplier.id = po.supplier_entry_id
           WHERE item.id = ANY($1::uuid[]) ORDER BY item.id FOR UPDATE OF item, po`, [[...aggregated.keys()]],
        );
        if (matchedItems.rowCount !== aggregated.size || matchedItems.rows.some(item => item.importer !== body.process.importer)) {
          const offending = invoiceAssignments.data.find(assignment => !matchedItems.rows.some(item =>
            item.id === assignment.itemId && item.importer === body.process.importer));
          throw new BusinessError(409, "PO_ITEM_MISMATCH",
            `Linha ${offending?.sourceRow ?? "?"} da invoice: item de PO não encontrado na importadora do IP.`);
        }
        if (matchedItems.rows.some(item => ["CANCELLED", "CANCELED"].includes(item.source_status?.toUpperCase() ?? ""))) {
          const canceled = matchedItems.rows.find(item => ["CANCELLED", "CANCELED"].includes(item.source_status?.toUpperCase() ?? ""));
          const row = invoiceAssignments.data.find(assignment => assignment.itemId === canceled?.id)?.sourceRow;
          throw new BusinessError(409, "PO_ITEM_MISMATCH", `Linha ${row ?? "?"} da invoice: item cancelado na PO de origem.`);
        }
        const byItemId = new Map(matchedItems.rows.map(item => [item.id, item]));
        const supplierByItemId = new Map(matchedItems.rows.map(item => [item.id, {
          supplierEntryId: item.supplier_entry_id, supplierText: item.supplier_text,
          supplierName: item.supplier_name, supplierCode: item.supplier_code,
          matchesExporter: [item.supplier_text, item.supplier_name, item.supplier_code]
            .some(value => normalizeSupplier(value) === normalizeSupplier(exporterText)),
        }]));
        for (const assignment of invoiceAssignments.data) {
          const item = byItemId.get(assignment.itemId);
          if (!item || item.product_code !== assignment.poProductCode
            || normalizePoNumber(item.number) !== normalizePoNumber(assignment.poNumber)
            || normalizePoNumber(item.number) !== normalizePoNumber(assignment.sourcePoNumber)) {
            throw new BusinessError(409, "PO_ITEM_MISMATCH",
              `Linha ${assignment.sourceRow} da invoice: o item selecionado não corresponde à PO e ao produto indicados.`);
          }
          const supplier = supplierByItemId.get(assignment.itemId)!;
          if (!supplier.matchesExporter && !assignment.confirmSupplierMismatch) {
            throw new BusinessError(400, "INVOICE_SUPPLIER_MISMATCH_UNCONFIRMED",
              "Confirme a divergencia entre o Exporter da invoice e o fornecedor da PO.");
          }
          const sourceLine = lineByRow.get(assignment.sourceRow);
          if (sourceLine?.unit && item.unit && sourceLine.unit.trim().toUpperCase() !== item.unit.trim().toUpperCase()
            && assignment.confirmUnitMismatch !== true) {
            throw new BusinessError(400, "INVOICE_UNIT_MISMATCH_UNCONFIRMED",
              `Linha ${assignment.sourceRow}: confirme a divergência de unidade com a PO.`);
          }
          if (sourceLine?.unitPrice && item.unit_price && item.currency_code === "CNY"
            && absoluteUnits(priceUnits(sourceLine.unitPrice) - priceUnits(item.unit_price)) > 10_000_000_000n
            && assignment.confirmPriceMismatch !== true) {
            throw new BusinessError(400, "INVOICE_PRICE_MISMATCH_UNCONFIRMED",
              `Linha ${assignment.sourceRow}: confirme a divergência de preço com a PO.`);
          }
        }
        const supplierIdsForProcess = new Set([...supplierByItemId.values()].map(item => item.supplierEntryId));
        const processSupplierEntryId = [...supplierByItemId.values()].every(item => item.matchesExporter && item.supplierEntryId)
          && supplierIdsForProcess.size === 1 ? [...supplierIdsForProcess][0] : null;
        const invoiceSupplierDivergence = processSupplierEntryId === null;
        const previousProcess = await client.query<Record<string, unknown>>(
          `SELECT * FROM imports.import_process
           WHERE normalized_ip_number = upper(btrim($1)) FOR UPDATE`,
          [body.process.ipNumber]);
        if (previousProcess.rows[0] && previousProcess.rows[0].importer !== body.process.importer) {
          throw new BusinessError(409, "IP_REFERENCE_OTHER_IMPORTER",
            "O IP REF da invoice já pertence a outra importadora.");
        }
        const linkedPos = previousProcess.rows[0] ? await client.query<{
          purchase_order_id: string; external_number: string; source_kind: string }>(
          `SELECT link.purchase_order_id, po.external_number, link.source_kind
           FROM procurement.process_purchase_order link
           JOIN procurement.purchase_order po ON po.id = link.purchase_order_id
           WHERE link.process_id = $1 FOR UPDATE OF link`, [previousProcess.rows[0].id]) : { rows: [] };
        const newPoIds = new Set(matchedItems.rows.map(item => item.purchase_order_id));
        const orphanLinks = linkedPos.rows.filter(link => !newPoIds.has(link.purchase_order_id));
        const orphanDecisions = new Map((body.orphanPoDecisions ?? []).map(decision => [decision.purchaseOrderId, decision.action]));
        if (orphanLinks.some(link => !orphanDecisions.has(link.purchase_order_id))) {
          throw new BusinessError(409, "INVOICE_ORPHAN_PO_DECISION_REQUIRED",
            "Escolha manter ou remover cada PO vinculada que ficará sem alocação.");
        }
        if (orphanDecisions.size !== orphanLinks.length) {
          throw new BusinessError(400, "INVALID_INVOICE_ORPHAN_PO_DECISIONS",
            "As decisões de PO não correspondem aos vínculos sem alocação.");
        }
        let processId: string;
        let isRevision = false;
        if (previousProcess.rows[0]) {
          const previous = previousProcess.rows[0];
          checkVersion(previous, versionFrom(request));
          if (previous.record_status === "CANCELLED") {
            throw new BusinessError(409, "CANCELLED_IP_REFERENCE", "A cancelled IP cannot be revised.");
          }
          if (previous.lifecycle_status === "CLOSED") {
            throw new BusinessError(409, "CLOSED_IP_REVISION", "Reopen the IP before revising its invoice.");
          }
          isRevision = previous.record_status !== "DRAFT";
          processId = String(previous.id);
          if (isRevision) {
            const dependentDocuments = await client.query(
              `SELECT 1 FROM imports.process_document WHERE process_id = $1 AND status = 'ACTIVE'
                AND kind <> 'INVOICE' AND purchase_order_item_id IS NOT NULL LIMIT 1`, [processId]);
            if (dependentDocuments.rowCount) {
              throw new BusinessError(409, "INVOICE_REVISION_HAS_LINKED_DOCUMENTS", "A linked BL/NF document must be reviewed before replacing this invoice.");
            }
            const oldDocuments = await client.query<Record<string, unknown>>(
              `SELECT * FROM imports.process_document WHERE process_id = $1 AND kind = 'INVOICE' AND status = 'ACTIVE' FOR UPDATE`, [processId]);
            for (const document of oldDocuments.rows) {
              await client.query(`UPDATE imports.process_document SET status = 'CANCELLED', version = version + 1, updated_at = now() WHERE id = $1`, [document.id]);
              await record(client, "IMPORT_PROCESS", processId, "PROCESS_DOCUMENT", String(document.id), "REVISION_CANCEL",
                document, { ...document, status: "CANCELLED" }, auth.actor, "Substituida por nova revisao da invoice.");
            }
            const oldAllocations = await client.query<Record<string, unknown>>(
              `SELECT * FROM procurement.po_item_allocation WHERE process_id = $1 AND status = 'ACTIVE' FOR UPDATE`, [processId]);
            for (const allocation of oldAllocations.rows) {
              await client.query(`UPDATE procurement.po_item_allocation SET status = 'CANCELLED', version = version + 1, updated_at = now() WHERE id = $1`, [allocation.id]);
              await record(client, "IMPORT_PROCESS", processId, "PO_ITEM_ALLOCATION", String(allocation.id), "REVISION_CANCEL",
                allocation, { ...allocation, status: "CANCELLED" }, auth.actor, "Substituida por nova revisao da invoice.");
            }
          }
          await client.query(
            `UPDATE imports.import_process SET record_status = 'ACTIVE', source_kind = 'CHINA_INVOICE',
               logistics_status = 'WAITING SHIPMENT', priority = $2, notes = $3, supplier_text = $4,
               supplier_entry_id = $5, incoterm = $6, port_loading = $7, port_discharge = $8,
               invoice_supplier_divergence = $9, version = version + 1, updated_at = now() WHERE id = $1`,
            [processId, body.process.priority, body.process.notes, exporterText, processSupplierEntryId,
              typeof body.invoice.metadata.incoterm === "string" ? body.invoice.metadata.incoterm : null,
              typeof body.invoice.metadata.originText === "string" ? body.invoice.metadata.originText : null,
              typeof body.invoice.metadata.destinationText === "string" ? body.invoice.metadata.destinationText : null,
              invoiceSupplierDivergence]);
          await record(client, "IMPORT_PROCESS", processId, "IMPORT_PROCESS", processId, "REVISION", previous,
            { ...body.process, logisticsStatus: "WAITING SHIPMENT", recordStatus: "ACTIVE",
              source: "CHINA_INVOICE", invoiceNumber: body.invoice.number,
              confirmedDuplicateInvoice: Boolean(duplicateIpNumbers.length && body.confirmDuplicateInvoice),
              invoiceImporterCnpj, confirmedImporterCnpjMismatch: confirmImporterCnpjMismatch,
              invoiceSupplierDivergence }, auth.actor, body.process.reason);
        } else {
          processId = randomUUID();
          await client.query(
            `INSERT INTO imports.import_process
             (id,importer,ip_number,normalized_ip_number,logistics_status,priority,notes,source_kind,version,supplier_text,supplier_entry_id,
              incoterm,port_loading,port_discharge,record_status,invoice_supplier_divergence)
             VALUES ($1,$2,$3,upper(btrim($3)),'WAITING SHIPMENT',$4,$5,'CHINA_INVOICE',1,$6,$7,$8,$9,$10,'ACTIVE',$11)`,
            [processId, body.process.importer, body.process.ipNumber, body.process.priority, body.process.notes,
              exporterText, processSupplierEntryId,
              typeof body.invoice.metadata.incoterm === "string" ? body.invoice.metadata.incoterm : null,
              typeof body.invoice.metadata.originText === "string" ? body.invoice.metadata.originText : null,
              typeof body.invoice.metadata.destinationText === "string" ? body.invoice.metadata.destinationText : null,
              invoiceSupplierDivergence],
          );
          await record(client, "IMPORT_PROCESS", processId, "IMPORT_PROCESS", processId, "CREATE", null,
            { ...body.process, logisticsStatus: "WAITING SHIPMENT", recordStatus: "ACTIVE",
              source: "CHINA_INVOICE", invoiceNumber: body.invoice.number,
              confirmedDuplicateInvoice: Boolean(duplicateIpNumbers.length && body.confirmDuplicateInvoice),
              invoiceImporterCnpj, confirmedImporterCnpjMismatch: confirmImporterCnpjMismatch,
              invoiceSupplierDivergence }, auth.actor, body.process.reason);
        }
        for (const link of orphanLinks) {
          const action = orphanDecisions.get(link.purchase_order_id)!;
          if (action === "REMOVE") {
            await client.query(`DELETE FROM procurement.process_purchase_order
              WHERE purchase_order_id = $1 AND process_id = $2`, [link.purchase_order_id, processId]);
          }
          await record(client, "IMPORT_PROCESS", processId, "PROCESS_PURCHASE_ORDER", link.purchase_order_id,
            action, link, { purchaseOrderId: link.purchase_order_id, action, linked: action === "KEEP" },
            auth.actor, body.process.reason);
        }
        const available = await client.query<{ id: string; ordered_quantity: string; allocated_quantity: string }>(
          `SELECT item.id, item.ordered_quantity::text,
             coalesce(sum(allocation.quantity) FILTER (WHERE allocation.status = 'ACTIVE'
               AND process.record_status = 'ACTIVE' AND process.id <> $2), 0)::text AS allocated_quantity
           FROM procurement.purchase_order_item item
           LEFT JOIN procurement.po_item_allocation allocation ON allocation.purchase_order_item_id = item.id
           LEFT JOIN imports.import_process process ON process.id = allocation.process_id
           WHERE item.id = ANY($1::uuid[]) GROUP BY item.id`,
          [[...aggregated.keys()], processId]);
        if (available.rowCount !== aggregated.size || available.rows.some(item =>
          aggregated.get(item.id)! > Number(item.ordered_quantity) - Number(item.allocated_quantity) + 0.00000001)) {
          const insufficient = available.rows.find(item => aggregated.get(item.id)! >
            Number(item.ordered_quantity) - Number(item.allocated_quantity) + 0.00000001);
          const missingId = [...aggregated.keys()].find(id => !available.rows.some(item => item.id === id));
          const row = invoiceAssignments.data.find(assignment => assignment.itemId === (insufficient?.id ?? missingId))?.sourceRow;
          throw new BusinessError(409, "PO_BALANCE_CHANGED",
            `Linha ${row ?? "?"} da invoice: saldo da PO alterado. Revalide POs e saldos e ajuste a distribuição.`);
        }
        for (const item of matchedItems.rows) {
          const allocationId = randomUUID();
          const allocationQuantity = aggregated.get(item.id)!;
          await client.query(
            `INSERT INTO procurement.process_purchase_order (purchase_order_id,process_id,source_kind)
             VALUES ($1,$2,'CHINA_INVOICE') ON CONFLICT DO NOTHING`, [item.purchase_order_id, processId],
          );
          await client.query(
            `INSERT INTO procurement.po_item_allocation (id,purchase_order_item_id,process_id,quantity,notes)
             VALUES ($1,$2,$3,$4,$5)`, [allocationId, item.id, processId, allocationQuantity,
              body.allocations.filter(allocation => allocation.itemId === item.id).map(allocation => allocation.notes).filter(Boolean).join("\n")],
          );
          await record(client, "IMPORT_PROCESS", processId, "PO_ITEM_ALLOCATION", allocationId, "CREATE", null,
            { itemId: item.id, poNumber: item.number, poProductCode: item.product_code, quantity: allocationQuantity,
              invoiceAssignments: invoiceAssignments.data.filter(assignment => assignment.itemId === item.id)
                .map(assignment => ({ sourceRow: assignment.sourceRow, invoiceProductCode: assignment.productCode,
                  confirmedCodeMismatch: assignment.confirmCodeMismatch, exporterText,
                  poSupplierText: supplierByItemId.get(item.id)?.supplierText,
                  poSupplierName: supplierByItemId.get(item.id)?.supplierName,
                  poSupplierCode: supplierByItemId.get(item.id)?.supplierCode,
                  confirmedSupplierMismatch: assignment.confirmSupplierMismatch,
                  confirmedUnitMismatch: assignment.confirmUnitMismatch === true,
                  confirmedPriceMismatch: assignment.confirmPriceMismatch === true })) }, auth.actor, body.process.reason);
        }
        const documentId = randomUUID();
        await client.query(
          `INSERT INTO imports.process_document
           (id,process_id,kind,number,issue_date,amount,currency_code,notes)
           VALUES ($1,$2,'INVOICE',$3,$4,$5,$6,$7)`,
          [documentId, processId, body.invoice.number, body.invoice.issueDate, body.invoice.amount,
            body.invoice.currency, JSON.stringify({ fileName: body.invoice.fileName, ...body.invoice.metadata })],
        );
        await record(client, "IMPORT_PROCESS", processId, "PROCESS_DOCUMENT", documentId, "CREATE", null,
          { kind: "INVOICE", number: body.invoice.number, issueDate: body.invoice.issueDate,
            amount: body.invoice.amount, currency: body.invoice.currency, fileName: body.invoice.fileName }, auth.actor, body.process.reason);
        for (const update of catalogUpdates.products) {
          const found = await client.query<Record<string, unknown>>(
            `SELECT * FROM catalog.entry WHERE kind = 'PRODUCT' AND importer IS NULL
              AND normalized_code = upper(btrim($1)) FOR UPDATE`, [update.productCode]);
          const product = found.rows[0];
          if (!product) throw new BusinessError(409, "PRODUCT_CATALOG_NOT_FOUND", `Product ${update.productCode} is not registered in the global product catalog.`);
          const updated = await client.query<Record<string, unknown>>(
            `UPDATE catalog.entry SET name = $2, product_ncm_code = coalesce($3, product_ncm_code),
               manufacturer = coalesce($4, manufacturer), manufacturer_address = coalesce($5, manufacturer_address),
               manufacturer_country = coalesce($6, manufacturer_country), version = version + 1,
               updated_by = $7, updated_at = now() WHERE id = $1 RETURNING *`,
            [product.id, update.name, update.ncmCode, update.manufacturer, update.manufacturerAddress,
              update.manufacturerCountry, auth.actor.userId]);
          await record(client, "CATALOG_ENTRY", String(product.id), "CATALOG_ENTRY", String(product.id), "UPDATE",
            product, updated.rows[0], auth.actor, body.process.reason);
        }
        for (const update of catalogUpdates.poItems) {
          const item = byItemId.get(update.itemId);
          if (!item) throw new BusinessError(409, "PO_ITEM_MISMATCH", "An invoice PO item update is not part of the selected allocation.");
          const before = await client.query<Record<string, unknown>>(
            `SELECT * FROM procurement.purchase_order_item WHERE id = $1 FOR UPDATE`, [update.itemId]);
          const updated = await client.query<Record<string, unknown>>(
            `UPDATE procurement.purchase_order_item SET description = $2, unit_price = $3,
               currency_code = $4, ncm = coalesce($5, ncm), updated_at = now() WHERE id = $1 RETURNING *`,
            [update.itemId, update.description, update.unitPrice, update.currency, update.ncmCode]);
          await client.query(`UPDATE procurement.purchase_order SET version = version + 1, updated_at = now() WHERE id = $1`, [item.purchase_order_id]);
          await record(client, "PURCHASE_ORDER", item.purchase_order_id, "PURCHASE_ORDER_ITEM", update.itemId, "UPDATE",
            before.rows[0], updated.rows[0], auth.actor, body.process.reason);
        }
        await saveReceipt(client, auth.actor.userId, key, command.hash, "IP_INVOICE_IMPORT", processId);
        return { id: processId, documentId, allocations: aggregated.size, ipNumber: body.process.ipNumber,
          revision: isRevision };
      }, 201);
    });

  app.get("/api/v1/purchase-orders/invoice-candidates", { config: permissionConfig("purchase-orders.read") },
    async (request, reply) => {
      const parsed = invoiceCandidateQuery.safeParse(request.query);
      if (!parsed.success) return problem(reply, 400, "INVALID_INVOICE_CANDIDATE_QUERY", "Informe importadora, produto e PO da invoice.");
      try { inScope(parsed.data.importer, request.authorizationContext?.importerScopes ?? []); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      const result = await pool.query<Record<string, unknown>>(
        `SELECT item.id, item.line_number AS "lineNumber", item.product_code AS "productCode",
                item.description, item.ordered_quantity::text AS "orderedQuantity", item.unit,
                item.unit_price::text AS "unitPrice", item.currency_code AS currency, item.ncm AS "poNcmCode",
                po.id AS "purchaseOrderId", po.external_number AS "poNumber",
                po.supplier_entry_id AS "supplierEntryId", po.supplier_text AS "supplierText",
                supplier.name AS "supplierName", supplier.code AS "supplierCode",
                product.id AS "productId", product.name AS "productName",
                product.product_ncm_code AS "productNcmCode", product.manufacturer,
                product.manufacturer_address AS "manufacturerAddress",
                product.manufacturer_country AS "manufacturerCountry",
                (item.ordered_quantity - coalesce(sum(allocation.quantity) FILTER (WHERE allocation.status = 'ACTIVE'
                  AND process.record_status = 'ACTIVE'
                  AND ($4::text IS NULL OR process.normalized_ip_number <> upper(btrim($4)))), 0))::text AS "remainingQuantity"
         FROM procurement.purchase_order_item item
         JOIN procurement.purchase_order po ON po.id = item.purchase_order_id
         LEFT JOIN catalog.entry supplier ON supplier.id = po.supplier_entry_id
         LEFT JOIN catalog.entry product ON product.kind = 'PRODUCT' AND product.importer IS NULL
           AND product.normalized_code = upper(btrim(item.product_code))
         LEFT JOIN procurement.po_item_allocation allocation ON allocation.purchase_order_item_id = item.id
         LEFT JOIN imports.import_process process ON process.id = allocation.process_id
         WHERE po.importer = $1 AND po.importer = ANY($5::text[])
           AND regexp_replace(regexp_replace(upper(po.external_number), '[^A-Z0-9]', '', 'g'), '^PO', '')
             = regexp_replace(regexp_replace(upper($3), '[^A-Z0-9]', '', 'g'), '^PO', '')
           AND upper(coalesce(item.source_status, '')) NOT IN ('CANCELLED','CANCELED')
           GROUP BY item.id, po.id, supplier.id, product.id
         ORDER BY (upper(btrim(item.product_code)) = upper(btrim($2))) DESC,
           po.normalized_number, item.line_number`,
        [parsed.data.importer, parsed.data.productCode,
          parsed.data.sourcePoNumber, parsed.data.revisingIpNumber || null,
          request.authorizationContext?.importerScopes ?? []],
      );
      const matchingPo = result.rows[0] ? null : await pool.query<{ id: string }>(
        `SELECT id FROM procurement.purchase_order
         WHERE importer = $1 AND importer = ANY($3::text[])
           AND regexp_replace(regexp_replace(upper(external_number), '[^A-Z0-9]', '', 'g'), '^PO', '')
             = regexp_replace(regexp_replace(upper($2), '[^A-Z0-9]', '', 'g'), '^PO', '')
         LIMIT 1`, [parsed.data.importer, parsed.data.sourcePoNumber,
          request.authorizationContext?.importerScopes ?? []]);
      const purchaseOrderId = result.rows[0]?.purchaseOrderId ?? matchingPo?.rows[0]?.id ?? null;
      return { items: result.rows, poExists: purchaseOrderId !== null, purchaseOrderId };
    });

  app.get<{ Params: { id: string } }>("/api/v1/purchase-orders/:id/operational",
    { config: permissionConfig("purchase-orders.read") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      if (!id.success) return problem(reply, 400, "INVALID_ID", "Identificador inválido.");
      const scopes = request.authorizationContext?.importerScopes ?? [];
      const po = await pool.query<Record<string, unknown>>(
        `SELECT po.id, po.importer, po.external_number AS number, po.supplier_entry_id AS "supplierEntryId",
                coalesce(supplier.code, po.supplier_text) AS "supplierText", supplier.name AS "supplierName",
                coalesce(po.order_date, CASE WHEN po.source_kind = 'MANUAL_TOTVS_REFERENCE'
                  THEN (po.created_at AT TIME ZONE 'America/Sao_Paulo')::date END)::text AS "orderDate",
                po.notes, po.source_kind AS "sourceKind", po.version::text,
                po.purchase_request_id AS "purchaseRequestId",
                CASE WHEN sc.id IS NULL THEN NULL ELSE jsonb_build_object(
                  'id', sc.id, 'scNumber', sc.sc_number, 'supplierEntryId', sc.supplier_entry_id,
                  'supplierText', coalesce(sc_supplier.code, sc.supplier_text), 'supplierName', sc_supplier.name,
                  'scDate', sc.sc_date::text,
                  'commercialPlanReceivedDate', sc.commercial_plan_received_date::text,
                  'requester', sc.requester, 'approvalDate', sc.approval_date::text,
                  'importer', sc.importer) END AS "purchaseRequest"
         FROM procurement.purchase_order po
         LEFT JOIN catalog.entry supplier ON supplier.id = po.supplier_entry_id
         LEFT JOIN procurement.purchase_request sc ON sc.id = po.purchase_request_id
         LEFT JOIN catalog.entry sc_supplier ON sc_supplier.id = sc.supplier_entry_id
         WHERE po.id = $1 AND po.importer = ANY($2::text[])`, [id.data, scopes]);
      if (!po.rows[0]) return problem(reply, 404, "RESOURCE_NOT_FOUND", "PO não encontrada.");
      const items = await pool.query<Record<string, unknown>>(
        `SELECT item.id, item.line_number AS "lineNumber",
                item.external_line_reference AS "externalLineReference",
                item.product_code AS "productCode", item.description,
                item.ordered_quantity::text AS "orderedQuantity", item.unit,
                item.unit_price::text AS "unitPrice", item.currency_code AS currency,
                item.necessity_date::text AS "necessityDate", item.sc_date::text AS "scDate", item.priority, item.demand,
                item.requester, item.sc_number AS "scNumber", item.sc_approval_date::text AS "scApprovalDate",
                item.purpose, item.product_group AS "productGroup", to_jsonb(item)->>'item_group' AS "group", item.cost_center AS "costCenter",
                item.draft_po AS "draftPo", item.po_approval_date::text AS "poApprovalDate",
                item.po_sent_date::text AS "poSentDate", item.category, item.ncm, item.remarks,
                item.commercial_plan_received_date::text AS "commercialPlanReceivedDate",
                item.mrp_completed_date::text AS "mrpCompletedDate", item.target_mrp_days AS "targetMrpDays",
                item.target_order_days AS "targetOrderDays", item.target_shipment_days AS "targetShipmentDays",
                item.target_port_days AS "targetPortDays", item.target_transit_days AS "targetTransitDays",
                item.target_customs_days AS "targetCustomsDays",
                item.actual_factory_ship_date::text AS "actualFactoryShipDate",
                item.actual_port_departure_date::text AS "actualPortDepartureDate",
                item.source_kind AS "sourceKind", item.source_status AS "sourceStatus",
                coalesce(sum(a.quantity) FILTER (WHERE a.status = 'ACTIVE'), 0)::text AS "allocatedQuantity",
                CASE WHEN upper(coalesce(item.source_status, '')) IN ('CANCELLED', 'CANCELED') THEN '0'
                     ELSE (item.ordered_quantity - coalesce(sum(a.quantity) FILTER (WHERE a.status = 'ACTIVE'), 0))::text
                END AS "remainingQuantity"
         FROM procurement.purchase_order_item item
         LEFT JOIN procurement.po_item_allocation a ON a.purchase_order_item_id = item.id
         WHERE item.purchase_order_id = $1 GROUP BY item.id ORDER BY item.line_number`, [id.data]);
      const allocations = await pool.query<Record<string, unknown>>(
        `SELECT a.id, a.purchase_order_item_id AS "itemId", a.process_id AS "processId",
                process.ip_number AS "ipNumber", a.quantity::text, a.notes,
                a.factory_ship_date::text AS "factoryShipDate", a.version::text
         FROM procurement.po_item_allocation a
         JOIN procurement.purchase_order_item item ON item.id = a.purchase_order_item_id
         JOIN imports.import_process process ON process.id = a.process_id
         WHERE item.purchase_order_id = $1 AND a.status = 'ACTIVE'
           AND process.importer = ANY($2::text[])
         ORDER BY process.ip_number, a.id`, [id.data, scopes]);
      reply.header("ETag", `"${po.rows[0].version}"`);
      return { ...po.rows[0], items: items.rows, allocations: allocations.rows };
    });

  app.post("/api/v1/purchase-orders", { config: permissionConfig("purchase-orders.write") },
    async (request, reply) => {
      const parsed = createPo.safeParse(request.body);
      if (!parsed.success) return problem(reply, 400, "INVALID_PO", "Revise a PO e seus campos.");
      let key: string; let auth: ReturnType<typeof actorAndScopes>;
      try { key = keyFrom(request); auth = actorAndScopes(request); inScope(parsed.data.importer, auth.scopes); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      const body = parsed.data;
      return transaction(pool, reply, async client => {
        const claim = await receipt(client, auth.actor.userId, key, "PO", body);
        if (claim.existingId) return { id: claim.existingId, replayed: true };
        await knownImporter(client, body.importer);
        await validatePurchaseRequest(client, body.purchaseRequestId, body.importer);
        const id = randomUUID();
        const result = await client.query<Record<string, unknown>>(
          `INSERT INTO procurement.purchase_order
           (id,importer,external_number,normalized_number,identity_status,source_kind,version,
            supplier_text,order_date,notes,purchase_request_id)
           VALUES ($1,$2,$3::text,upper($3::text),'MANUAL_UNVERIFIED','MANUAL_TOTVS_REFERENCE',1,$4,
             (now() AT TIME ZONE 'America/Sao_Paulo')::date,$5,$6)
           RETURNING id, importer, external_number AS number, order_date::text AS "orderDate", version::text`,
          [id, body.importer, body.number, body.supplierText, body.notes, body.purchaseRequestId ?? null]);
        await saveReceipt(client, auth.actor.userId, key, claim.hash, "PO", id);
        await record(client, "PURCHASE_ORDER", id, "PURCHASE_ORDER", id, "CREATE", null,
          { ...body, orderDate: result.rows[0].orderDate }, auth.actor, body.reason);
        return result.rows[0];
      }, 201);
    });

  app.patch<{ Params: { id: string } }>("/api/v1/purchase-orders/:id",
    { config: permissionConfig("purchase-orders.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id); const parsed = poFields.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_PO", "Revise os campos da PO.");
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const before = await lockedPo(client, id.data, auth.scopes);
        checkVersion(before, expected);
        if (before.source_kind !== "MANUAL_TOTVS_REFERENCE"
          && parsed.data.number !== before.external_number) {
          throw new BusinessError(409, "HISTORICAL_IDENTITY", "A identidade da PO histórica exige reconciliação da origem.");
        }
        if (parsed.data.purchaseRequestId !== undefined) {
          await validatePurchaseRequest(client, parsed.data.purchaseRequestId, String(before.importer));
        }
        const result = await client.query<Record<string, unknown>>(
          `UPDATE procurement.purchase_order AS po SET supplier_text = $2::text,
            supplier_entry_id = CASE WHEN $2::text IS NULL THEN NULL
              WHEN $2::text IS DISTINCT FROM po.supplier_text THEN (
                SELECT CASE WHEN count(*)=1 THEN min(supplier.id::text)::uuid END
                FROM catalog.entry supplier WHERE supplier.kind='SUPPLIER' AND supplier.importer IS NULL
                  AND (supplier.normalized_code=upper(btrim($2::text))
                    OR upper(btrim(supplier.name))=upper(btrim($2::text))))
              ELSE po.supplier_entry_id END,
            notes = $3, external_number = $4::text, normalized_number = upper($4::text),
            purchase_request_id = CASE WHEN $5::boolean THEN $6::uuid ELSE purchase_request_id END,
            version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING id, version::text`,
          [id.data, parsed.data.supplierText, parsed.data.notes, parsed.data.number,
            parsed.data.purchaseRequestId !== undefined, parsed.data.purchaseRequestId ?? null]);
        await record(client, "PURCHASE_ORDER", id.data, "PURCHASE_ORDER", id.data, "UPDATE",
          before, { ...parsed.data, orderDate: before.order_date ?? null }, auth.actor, parsed.data.reason);
        return result.rows[0];
      });
    });

  app.post<{ Params: { id: string } }>("/api/v1/purchase-orders/:id/items",
    { config: permissionConfig("purchase-orders.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id); const parsed = itemFields.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_ITEM", "Revise o item, quantidade e moeda.");
      let key: string; let auth: ReturnType<typeof actorAndScopes>;
      try { key = keyFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const po = await lockedPo(client, id.data, auth.scopes);
        const claim = await receipt(client, auth.actor.userId, key, "PO_ITEM", { poId: id.data, ...parsed.data });
        if (claim.existingId) return { id: claim.existingId, replayed: true };
        const next = await client.query<{ line_number: number }>(
          `SELECT coalesce(max(line_number),0)::int + 1 AS line_number
           FROM procurement.purchase_order_item WHERE purchase_order_id = $1`, [id.data]);
        const itemId = randomUUID(); const body = parsed.data;
        await client.query(
          `INSERT INTO procurement.purchase_order_item
           (id,purchase_order_id,line_number,external_line_reference,product_code,description,
            ordered_quantity,unit,unit_price,currency_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [itemId, id.data, next.rows[0].line_number, body.externalLineReference,
            body.productCode, body.description, body.orderedQuantity, body.unit, body.unitPrice, body.currency]);
        await client.query("UPDATE procurement.purchase_order SET version = version + 1, updated_at = now() WHERE id = $1", [id.data]);
        await saveReceipt(client, auth.actor.userId, key, claim.hash, "PO_ITEM", itemId);
        await record(client, "PURCHASE_ORDER", id.data, "PURCHASE_ORDER_ITEM", itemId, "CREATE",
          null, body, auth.actor, body.reason);
        return { id: itemId, purchaseOrderId: po.id, lineNumber: next.rows[0].line_number };
      }, 201);
    });

  app.patch<{ Params: { id: string; itemId: string } }>("/api/v1/purchase-orders/:id/items/:itemId",
    { config: permissionConfig("purchase-orders.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id); const itemId = uuid.safeParse(request.params.itemId);
      const parsed = itemFields.safeParse(request.body);
      if (!id.success || !itemId.success || !parsed.success) return problem(reply, 400, "INVALID_ITEM", "Revise o item.");
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const po = await lockedPo(client, id.data, auth.scopes); checkVersion(po, expected);
        const found = await client.query<Record<string, unknown>>(
          `SELECT * FROM procurement.purchase_order_item
           WHERE id = $1 AND purchase_order_id = $2 FOR UPDATE`, [itemId.data, id.data]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Item não encontrado nesta PO.");
        const body = parsed.data;
        await client.query(
          `UPDATE procurement.purchase_order_item SET external_line_reference = $2, product_code = $3,
            description = $4, ordered_quantity = $5, unit = $6, unit_price = $7,
            currency_code = $8, updated_at = now() WHERE id = $1`,
          [itemId.data, body.externalLineReference, body.productCode, body.description,
            body.orderedQuantity, body.unit, body.unitPrice, body.currency]);
        const updated = await client.query<{ version: string }>(
          `UPDATE procurement.purchase_order SET version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING version::text`, [id.data]);
        await record(client, "PURCHASE_ORDER", id.data, "PURCHASE_ORDER_ITEM", itemId.data, "UPDATE",
          found.rows[0], body, auth.actor, body.reason);
        return { id: itemId.data, purchaseOrderVersion: updated.rows[0].version };
      });
    });

  app.post("/api/v1/processes", { config: permissionConfig("processes.write") },
    async (request, reply) => {
      const parsed = createProcess.safeParse(request.body);
      if (!parsed.success) return problem(reply, 400, "INVALID_PROCESS", "Revise o IP.");
      let key: string; let auth: ReturnType<typeof actorAndScopes>;
      try { key = keyFrom(request); auth = actorAndScopes(request); inScope(parsed.data.importer, auth.scopes); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      const body = parsed.data;
      return transaction(pool, reply, async client => {
        const claim = await receipt(client, auth.actor.userId, key, "IP", body);
        if (claim.existingId) return { id: claim.existingId, replayed: true };
        await knownImporter(client, body.importer);
        const id = randomUUID();
        await client.query(
          `INSERT INTO imports.import_process
           (id,importer,ip_number,normalized_ip_number,logistics_status,priority,notes,source_kind,version,supplier_text)
           VALUES ($1,$2,$3::text,upper($3::text),$4,$5,$6,'MANUAL',1,$7)`,
          [id, body.importer, body.ipNumber, body.logisticsStatus, body.priority, body.notes, body.supplierText]);
        await saveReceipt(client, auth.actor.userId, key, claim.hash, "IP", id);
        await record(client, "IMPORT_PROCESS", id, "IMPORT_PROCESS", id, "CREATE", null, body, auth.actor, body.reason);
        return { id, ipNumber: body.ipNumber, version: "1" };
      }, 201);
    });

  app.post<{ Params: { id: string } }>("/api/v1/processes/:id/close",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      const parsed = closeProcess.safeParse(request.body);
      if (!id.success || !parsed.success) {
        return problem(reply, 400, "INVALID_CLOSURE", "Informe uma justificativa para encerrar o IP.");
      }
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const found = await client.query<Record<string, unknown>>(
          `SELECT * FROM imports.import_process
           WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE`, [id.data, auth.scopes]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "IP não encontrado.");
        checkVersion(found.rows[0], expected);
        if (found.rows[0].record_status !== "ACTIVE") throw new BusinessError(409, "IP_NOT_ACTIVE", "Only active IPs can be closed.");
        if (found.rows[0].lifecycle_status === "CLOSED") {
          throw new BusinessError(409, "PROCESS_ALREADY_CLOSED", "Este IP já está encerrado.");
        }
        const actor = `${auth.actor.issuer}#${auth.actor.subject}`;
        const closed = await client.query<{ version: string; closed_at: Date }>(
          `UPDATE imports.import_process SET lifecycle_status = 'CLOSED', closed_at = now(),
             closed_by = $2, close_reason = $3, version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING version::text, closed_at`,
          [id.data, actor, parsed.data.reason]);
        await record(client, "IMPORT_PROCESS", id.data, "IMPORT_PROCESS", id.data, "CLOSE",
          found.rows[0], { lifecycleStatus: "CLOSED", closedBy: actor, reason: parsed.data.reason },
          auth.actor, parsed.data.reason);
        return { id: id.data, lifecycleStatus: "CLOSED", version: closed.rows[0].version,
          closedAt: closed.rows[0].closed_at };
      });
    });

  app.post<{ Params: { id: string } }>("/api/v1/processes/:id/reopen",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      const parsed = closeProcess.safeParse(request.body);
      if (!id.success || !parsed.success) {
        return problem(reply, 400, "INVALID_REOPEN", "Informe uma justificativa para reabrir o IP.");
      }
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const found = await client.query<Record<string, unknown>>(
          `SELECT * FROM imports.import_process
           WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE`, [id.data, auth.scopes]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "IP não encontrado.");
        checkVersion(found.rows[0], expected);
        if (found.rows[0].record_status !== "ACTIVE") throw new BusinessError(409, "IP_NOT_ACTIVE", "Only active IPs can be reopened.");
        if (found.rows[0].lifecycle_status !== "CLOSED") {
          throw new BusinessError(409, "PROCESS_NOT_CLOSED", "Este IP não está encerrado.");
        }
        const reopened = await client.query<{ version: string }>(
          `UPDATE imports.import_process SET lifecycle_status = 'OPEN', closed_at = NULL,
             closed_by = NULL, close_reason = NULL, version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING version::text`, [id.data]);
        await record(client, "IMPORT_PROCESS", id.data, "IMPORT_PROCESS", id.data, "REOPEN",
          found.rows[0], { lifecycleStatus: "OPEN", reason: parsed.data.reason },
          auth.actor, parsed.data.reason);
        return { id: id.data, lifecycleStatus: "OPEN", version: reopened.rows[0].version };
      });
    });

  app.post<{ Params: { id: string } }>("/api/v1/processes/:id/cancel",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      const parsed = cancelProcess.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_PROCESS_CANCELLATION", "Revise o destino das POs e o motivo do cancelamento.");
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const found = await client.query<Record<string, unknown>>(
          `SELECT * FROM imports.import_process WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE`,
          [id.data, auth.scopes]);
        const process = found.rows[0];
        if (!process) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "IP nÃ£o encontrado.");
        checkVersion(process, expected);
        if (process.record_status === "CANCELLED") throw new BusinessError(409, "PROCESS_ALREADY_CANCELLED", "Este IP jÃ¡ foi cancelado.");
        if (process.lifecycle_status !== "OPEN") throw new BusinessError(409, "PROCESS_CLOSED", "Reabra o IP antes de cancelar e encaminhar suas POs.");
        const links = await client.query<{ purchase_order_id: string; number: string }>(
          `SELECT po.id AS purchase_order_id, po.external_number AS number
           FROM procurement.process_purchase_order link
           JOIN procurement.purchase_order po ON po.id = link.purchase_order_id
           WHERE link.process_id = $1 AND po.importer = $2 ORDER BY po.normalized_number FOR UPDATE OF po`,
          [id.data, process.importer]);
        const supplied = new Set(parsed.data.purchaseOrders.map(item => item.purchaseOrderId));
        const current = new Set(links.rows.map(item => item.purchase_order_id));
        if (supplied.size !== parsed.data.purchaseOrders.length || supplied.size !== current.size
          || [...current].some(poId => !supplied.has(poId))) {
          throw new BusinessError(409, "CANCELLATION_PO_LIST_CHANGED", "A lista de POs do IP mudou. Recarregue antes de cancelar.");
        }
        const newDestinations = new Map<string, string>();
        for (const route of parsed.data.purchaseOrders) {
          if (route.destinationType === "EXISTING") {
            if (route.processId === id.data) throw new BusinessError(400, "INVALID_CANCELLATION_DESTINATION", "Escolha outro IP como destino.");
            const target = await client.query<Record<string, unknown>>(
              `SELECT id, importer, record_status, lifecycle_status FROM imports.import_process
               WHERE id = $1 AND importer = $2 AND importer = ANY($3::text[]) FOR UPDATE`,
              [route.processId, process.importer, auth.scopes]);
            if (!target.rows[0] || target.rows[0].record_status === "CANCELLED" || target.rows[0].lifecycle_status !== "OPEN") {
              throw new BusinessError(409, "INVALID_CANCELLATION_DESTINATION", "O IP de destino nÃ£o existe, estÃ¡ encerrado ou cancelado.");
            }
          } else if (route.destinationType === "NEW") {
            const normalized = route.ipNumber.trim().toLocaleUpperCase("en-US");
            if (normalized === String(process.normalized_ip_number).trim().toLocaleUpperCase("en-US")) {
              throw new BusinessError(400, "INVALID_CANCELLATION_DESTINATION", "O novo IP precisa ter outro IP REF.");
            }
            newDestinations.set(normalized, route.ipNumber.trim());
          }
        }
        const preexistingNewIps = await client.query<{ normalized_ip_number: string }>(
          `SELECT normalized_ip_number FROM imports.import_process
           WHERE normalized_ip_number = ANY($1::text[])`, [[...newDestinations.keys()]]);
        if (preexistingNewIps.rowCount) throw new BusinessError(409, "IP_REFERENCE_CONFLICT", "Um dos IP REF informados jÃ¡ existe. Selecione o IP existente como destino.");

        const documents = await client.query<Record<string, unknown>>(
          `SELECT * FROM imports.process_document WHERE process_id = $1 AND status = 'ACTIVE' FOR UPDATE`, [id.data]);
        for (const document of documents.rows) {
          await client.query(`UPDATE imports.process_document SET status = 'CANCELLED', version = version + 1, updated_at = now() WHERE id = $1`, [document.id]);
          await record(client, "IMPORT_PROCESS", id.data, "PROCESS_DOCUMENT", String(document.id), "CANCEL", document,
            { ...document, status: "CANCELLED" }, auth.actor, parsed.data.reason);
        }
        const allocations = await client.query<Record<string, unknown>>(
          `SELECT * FROM procurement.po_item_allocation WHERE process_id = $1 AND status = 'ACTIVE' FOR UPDATE`, [id.data]);
        for (const allocation of allocations.rows) {
          await client.query(`UPDATE procurement.po_item_allocation SET status = 'CANCELLED', version = version + 1, updated_at = now() WHERE id = $1`, [allocation.id]);
          await record(client, "IMPORT_PROCESS", id.data, "PO_ITEM_ALLOCATION", String(allocation.id), "CANCEL",
            allocation, { ...allocation, status: "CANCELLED" }, auth.actor, parsed.data.reason);
        }
        await client.query(
          `UPDATE imports.import_process SET record_status = 'CANCELLED', logistics_status = 'CANCELLED',
             version = version + 1, updated_at = now() WHERE id = $1`, [id.data]);
        await record(client, "IMPORT_PROCESS", id.data, "IMPORT_PROCESS", id.data, "CANCEL", process,
          { recordStatus: "CANCELLED", logisticsStatus: "CANCELLED" }, auth.actor, parsed.data.reason);
        for (const link of links.rows) {
          await record(client, "IMPORT_PROCESS", id.data, "PROCESS_PURCHASE_ORDER", link.purchase_order_id, "UNLINK",
            { purchaseOrderId: link.purchase_order_id, poNumber: link.number }, null, auth.actor, parsed.data.reason);
        }
        await client.query(`DELETE FROM procurement.process_purchase_order WHERE process_id = $1`, [id.data]);

        const destinationIds = new Map<string, string>();
        for (const [normalized, ipNumber] of newDestinations) {
          const destinationId = randomUUID();
          const destinationSupplierEntryId = process.supplier_entry_id ? String(process.supplier_entry_id) : null;
          const destinationSupplierText = destinationSupplierEntryId ? process.supplier_text : null;
          await client.query(
            `INSERT INTO imports.import_process
             (id,importer,ip_number,normalized_ip_number,logistics_status,priority,notes,source_kind,version,supplier_text,supplier_entry_id,record_status)
             VALUES ($1,$2,$3,$4,NULL,NULL,$5,'CANCELLATION_TRANSFER',1,$6,$7,'DRAFT')`,
            [destinationId, process.importer, ipNumber, normalized,
              `Criado no cancelamento do IP ${process.ip_number}; aguardando invoice.`,
              destinationSupplierText, destinationSupplierEntryId]);
          destinationIds.set(normalized, destinationId);
          await record(client, "IMPORT_PROCESS", destinationId, "IMPORT_PROCESS", destinationId, "CREATE", null,
            { ipNumber, recordStatus: "DRAFT", source: "CANCELLATION_TRANSFER", sourceProcessId: id.data }, auth.actor, parsed.data.reason);
        }
        let linkedPoCount = 0;
        for (const route of parsed.data.purchaseOrders) {
          const targetId = route.destinationType === "EXISTING" ? route.processId
            : route.destinationType === "NEW" ? destinationIds.get(route.ipNumber.trim().toLocaleUpperCase("en-US")) : undefined;
          if (!targetId) continue;
          await client.query(
            `INSERT INTO procurement.process_purchase_order (purchase_order_id,process_id,source_kind)
             VALUES ($1,$2,'CANCELLATION_TRANSFER') ON CONFLICT DO NOTHING`, [route.purchaseOrderId, targetId]);
          linkedPoCount += 1;
          await record(client, "IMPORT_PROCESS", targetId, "PROCESS_PURCHASE_ORDER", route.purchaseOrderId, "TRANSFER", null,
            { purchaseOrderId: route.purchaseOrderId, sourceProcessId: id.data }, auth.actor, parsed.data.reason);
        }
        return { id: id.data, status: "CANCELLED", releasedAllocations: allocations.rowCount,
          linkedPurchaseOrders: linkedPoCount, createdDraftIps: destinationIds.size };
      });
    });

  app.patch<{ Params: { id: string } }>("/api/v1/processes/:id",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id); const parsed = updateProcessFields.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_PROCESS", "Revise o IP.");
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try {
        expected = versionFrom(request); auth = actorAndScopes(request);
        if (parsed.data.importer !== undefined) inScope(parsed.data.importer, auth.scopes);
      }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        const found = await client.query<Record<string, unknown>>(
          `SELECT * FROM imports.import_process WHERE id = $1 AND importer = ANY($2::text[]) FOR UPDATE`,
          [id.data, auth.scopes]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "IP não encontrado.");
        checkVersion(found.rows[0], expected);
        if (found.rows[0].record_status !== "ACTIVE") throw new BusinessError(409, "IP_NOT_ACTIVE", "Draft or cancelled IPs cannot be edited here.");
        if (found.rows[0].lifecycle_status === "CLOSED") {
          throw new BusinessError(409, "PROCESS_CLOSED", "Reabra o IP antes de editar seus dados.");
        }
        const body = { ...parsed.data, importer: parsed.data.importer ?? String(found.rows[0].importer) };
        if (body.importer !== found.rows[0].importer) {
          if (found.rows[0].source_kind !== "MANUAL") {
            throw new BusinessError(409, "HISTORICAL_IMPORTER", "A importadora do IP histórico exige reconciliação da origem.");
          }
          await knownImporter(client, body.importer);
          const references = await client.query(
            `SELECT EXISTS (SELECT 1 FROM procurement.process_purchase_order WHERE process_id = $1)
                 OR EXISTS (SELECT 1 FROM procurement.po_item_allocation WHERE process_id = $1)
                 OR EXISTS (SELECT 1 FROM costs.process_cost WHERE process_id = $1)
                 OR EXISTS (SELECT 1 FROM imports.process_document WHERE process_id = $1)
                 OR EXISTS (SELECT 1 FROM migration.source_row
                   WHERE sheet_name = 'Pré Embarque'
                     AND btrim(raw_values->>'F') = $2
                     AND upper(btrim(raw_values->>'AB')) = upper(btrim($3))) AS has_references`,
            [id.data, found.rows[0].importer, found.rows[0].ip_number]);
          if (references.rows[0]?.has_references) {
            throw new BusinessError(409, "PROCESS_IMPORTER_REFERENCES", "Remova ou reconcilie os vínculos com POs, distribuições e custos antes de alterar a importadora.");
          }
        }
        if (found.rows[0].source_kind !== "MANUAL" && body.ipNumber !== found.rows[0].ip_number) {
          throw new BusinessError(409, "HISTORICAL_IDENTITY", "A identidade do IP histórico exige reconciliação da origem.");
        }
        if (["CANCELLED", "CANCELED"].includes(body.logisticsStatus?.toUpperCase() ?? "")) {
          throw new BusinessError(409, "GUIDED_CANCELLATION_REQUIRED", "Use o cancelamento guiado do IP para liberar e encaminhar as POs.");
        }
        const updated = await client.query<{ version: string }>(
          `UPDATE imports.import_process SET importer = $2, logistics_status = $3, priority = $4,
            notes = $5, ip_number = $6::text, normalized_ip_number = upper($6::text), supplier_text = $7,
            version = version + 1, updated_at = now()
           WHERE id = $1 RETURNING version::text`,
          [id.data, body.importer, body.logisticsStatus, body.priority, body.notes, body.ipNumber,
            body.supplierText ?? found.rows[0].supplier_text ?? null]);
        await record(client, "IMPORT_PROCESS", id.data, "IMPORT_PROCESS", id.data, "UPDATE",
          found.rows[0], body, auth.actor, body.reason);
        return { id: id.data, version: updated.rows[0].version };
      });
    });

  app.post<{ Params: { id: string } }>("/api/v1/purchase-orders/:id/allocations",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id); const parsed = createAllocation.safeParse(request.body);
      if (!id.success || !parsed.success) return problem(reply, 400, "INVALID_ALLOCATION", "Revise item, IP e quantidade.");
      let key: string; let auth: ReturnType<typeof actorAndScopes>;
      try { key = keyFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      const body = parsed.data;
      return transaction(pool, reply, async client => {
        const po = await lockedPo(client, id.data, auth.scopes);
        const claim = await receipt(client, auth.actor.userId, key, "ALLOCATION", { poId: id.data, ...body });
        if (claim.existingId) return { id: claim.existingId, replayed: true };
        const item = await client.query(
          `SELECT id FROM procurement.purchase_order_item
           WHERE id = $1 AND purchase_order_id = $2
             AND upper(coalesce(source_status, '')) NOT IN ('CANCELLED', 'CANCELED')`,
          [body.itemId, id.data]);
        const process = await client.query(
          `SELECT id FROM imports.import_process WHERE id = $1 AND importer = $2
           AND importer = ANY($3::text[])
            AND lifecycle_status = 'OPEN' AND record_status = 'ACTIVE'
           AND upper(coalesce(logistics_status, '')) NOT IN ('CANCELLED', 'CANCELED')
           FOR UPDATE`,
          [body.processId, po.importer, auth.scopes]);
        if (!item.rowCount || !process.rowCount) {
          throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Item ou IP não pertence a esta importadora.");
        }
        const allocationId = randomUUID();
        await client.query(
          `INSERT INTO procurement.po_item_allocation
           (id,purchase_order_item_id,process_id,quantity,notes,factory_ship_date)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [allocationId, body.itemId, body.processId, body.quantity, body.notes, body.factoryShipDate ?? null]);
        await client.query(
          `INSERT INTO procurement.process_purchase_order (purchase_order_id,process_id,source_kind)
           VALUES ($1,$2,'OPERATIONAL') ON CONFLICT DO NOTHING`, [id.data, body.processId]);
        await client.query("UPDATE procurement.purchase_order SET version = version + 1, updated_at = now() WHERE id = $1", [id.data]);
        await saveReceipt(client, auth.actor.userId, key, claim.hash, "ALLOCATION", allocationId);
        await record(client, "PURCHASE_ORDER", id.data, "PO_ITEM_ALLOCATION", allocationId, "CREATE",
          null, body, auth.actor, body.reason);
        return { id: allocationId, version: "1" };
      }, 201);
    });

  app.patch<{ Params: { id: string; allocationId: string } }>(
    "/api/v1/purchase-orders/:id/allocations/:allocationId",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      const allocationId = uuid.safeParse(request.params.allocationId);
      const parsed = updateAllocation.safeParse(request.body);
      if (!id.success || !allocationId.success || !parsed.success) {
        return problem(reply, 400, "INVALID_ALLOCATION", "Revise a quantidade.");
      }
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        await lockedPo(client, id.data, auth.scopes);
        const found = await client.query<Record<string, unknown>>(
          `SELECT a.* FROM procurement.po_item_allocation a
           JOIN procurement.purchase_order_item item ON item.id = a.purchase_order_item_id
           JOIN imports.import_process process ON process.id = a.process_id
           WHERE a.id = $1 AND item.purchase_order_id = $2 AND a.status = 'ACTIVE'
             AND process.lifecycle_status = 'OPEN' AND process.record_status = 'ACTIVE' FOR UPDATE OF a, process`,
          [allocationId.data, id.data]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Distribuição não encontrada ou IP encerrado.");
        checkVersion(found.rows[0], expected);
        const body = parsed.data;
        const updated = await client.query<{ version: string }>(
          `UPDATE procurement.po_item_allocation SET
            quantity = coalesce($2, quantity), notes = coalesce($3, notes),
            factory_ship_date = CASE WHEN $4::boolean THEN $5::date ELSE factory_ship_date END,
            version = version + 1, updated_at = now() WHERE id = $1 RETURNING version::text`,
          [allocationId.data, body.quantity ?? null, body.notes ?? null,
            body.factoryShipDate !== undefined, body.factoryShipDate ?? null]);
        await client.query("UPDATE procurement.purchase_order SET version = version + 1, updated_at = now() WHERE id = $1", [id.data]);
        await record(client, "PURCHASE_ORDER", id.data, "PO_ITEM_ALLOCATION", allocationId.data,
          "UPDATE", found.rows[0], body, auth.actor, body.reason);
        return { id: allocationId.data, version: updated.rows[0].version };
      });
    });

  app.delete<{ Params: { id: string; allocationId: string } }>(
    "/api/v1/purchase-orders/:id/allocations/:allocationId",
    { config: permissionConfig("processes.write") }, async (request, reply) => {
      const id = uuid.safeParse(request.params.id);
      const allocationId = uuid.safeParse(request.params.allocationId);
      const parsed = cancelAllocation.safeParse(request.body);
      if (!id.success || !allocationId.success || !parsed.success) {
        return problem(reply, 400, "INVALID_ALLOCATION", "Informe uma justificativa para cancelar a distribuição.");
      }
      let expected: string; let auth: ReturnType<typeof actorAndScopes>;
      try { expected = versionFrom(request); auth = actorAndScopes(request); }
      catch (error) { if (error instanceof BusinessError) return problem(reply, error.status, error.code, error.message); throw error; }
      return transaction(pool, reply, async client => {
        await lockedPo(client, id.data, auth.scopes);
        const found = await client.query<Record<string, unknown>>(
          `SELECT a.* FROM procurement.po_item_allocation a
           JOIN procurement.purchase_order_item item ON item.id = a.purchase_order_item_id
           JOIN imports.import_process process ON process.id = a.process_id
           WHERE a.id = $1 AND item.purchase_order_id = $2 AND a.status = 'ACTIVE'
             AND process.lifecycle_status = 'OPEN' AND process.record_status = 'ACTIVE' FOR UPDATE OF a, process`,
          [allocationId.data, id.data]);
        if (!found.rows[0]) throw new BusinessError(404, "RESOURCE_NOT_FOUND", "Distribuição não encontrada ou IP encerrado.");
        checkVersion(found.rows[0], expected);
        await client.query(
          `UPDATE procurement.po_item_allocation SET status = 'CANCELLED',
            version = version + 1, updated_at = now() WHERE id = $1`, [allocationId.data]);
        await client.query(
          `DELETE FROM procurement.process_purchase_order link
           WHERE link.purchase_order_id = $1 AND link.process_id = $2
             AND link.source_kind = 'OPERATIONAL'
             AND NOT EXISTS (
               SELECT 1 FROM procurement.po_item_allocation a
               JOIN procurement.purchase_order_item item ON item.id = a.purchase_order_item_id
               WHERE item.purchase_order_id = $1 AND a.process_id = $2 AND a.status = 'ACTIVE'
             )`, [id.data, found.rows[0].process_id]);
        await client.query("UPDATE procurement.purchase_order SET version = version + 1, updated_at = now() WHERE id = $1", [id.data]);
        await record(client, "PURCHASE_ORDER", id.data, "PO_ITEM_ALLOCATION", allocationId.data,
          "CANCEL", found.rows[0], { status: "CANCELLED" }, auth.actor, parsed.data.reason);
        return { id: allocationId.data, status: "CANCELLED" };
      });
    });
}
