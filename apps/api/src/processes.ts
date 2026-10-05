import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { importerScopePredicate, permissionConfig } from "./authorization.js";
import { sourceColumnHeadersFor } from "./source-audit.js";

const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
};
const processQuery = z.object({
  ...paging,
  ipNumber: z.string().trim().max(80).optional(),
  importer: z.string().trim().max(120).optional(),
  logisticsStatus: z.string().trim().max(40).optional(),
  qualityStatus: z.string().trim().max(32).optional(),
}).strict();
const itemQuery = z.object(paging).strict();
const pendingQuery = z.object({
  ...paging,
  poNumber: z.string().trim().max(80).optional(),
  importer: z.string().trim().max(120).optional(),
}).strict();
const unassignedQuery = z.object({
  ...paging,
  ipNumber: z.string().trim().max(80).optional(),
  importer: z.string().trim().max(120).optional(),
}).strict();

function problem(reply: FastifyReply, status: 400 | 404, detail: string) {
  return reply.code(status).send({
    type: "about:blank", title: status === 404 ? "Recurso não encontrado" : "Parâmetros inválidos",
    status, detail, instance: reply.request.url.split("?", 1)[0], traceId: reply.request.id,
    code: status === 404 ? "RESOURCE_NOT_FOUND" : "INVALID_QUERY",
  });
}

const validIp = (expression: string) =>
  `NULLIF(btrim(${expression}), '') IS NOT NULL AND upper(btrim(${expression})) NOT IN ('CANCELLED', 'CANCELED') AND left(btrim(${expression}), 1) <> '#'`;

export async function registerProcessReadRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/processes", { config: permissionConfig("processes.read") }, async (request, reply) => {
    const parsed = processQuery.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, "Revise os filtros e a paginação.");
    const { page, pageSize, ipNumber, importer, logisticsStatus, qualityStatus } = parsed.data;
    const scope = importerScopePredicate("process.importer", 1, request.authorizationContext?.importerScopes ?? []);
    const result = await pool.query<{ total_count: number; items: Record<string, unknown>[] }>(
      `WITH filtered AS MATERIALIZED (
         SELECT process.id, process.ip_number, process.importer, process.logistics_status, process.lifecycle_status, process.quality_status,
           (SELECT count(*)::int FROM procurement.process_purchase_order AS link
            JOIN procurement.purchase_order AS po ON po.id = link.purchase_order_id
            WHERE link.process_id = process.id AND po.importer = ANY($1::text[])) AS purchase_order_count,
           (SELECT count(*)::int FROM migration.source_row AS source
            WHERE source.sheet_name = 'Pré Embarque' AND btrim(source.raw_values->>'F') = process.importer
              AND upper(btrim(source.raw_values->>'AB')) = process.normalized_ip_number) AS historical_line_count,
           (SELECT count(*)::int FROM procurement.po_item_allocation AS allocation
            WHERE allocation.process_id = process.id AND allocation.status = 'ACTIVE') AS operational_allocation_count,
           (SELECT count(*)::int FROM costs.process_cost AS cost WHERE cost.process_id = process.id) AS historical_cost_count
         FROM imports.import_process AS process
         WHERE ${scope.sql}
           AND ($2::text IS NULL OR strpos(lower(process.ip_number), lower($2)) > 0)
           AND ($3::text IS NULL OR strpos(lower(process.importer), lower($3)) > 0)
           AND ($4::text IS NULL OR process.logistics_status = $4)
           AND ($5::text IS NULL OR process.quality_status = $5)
       ), page AS (
         SELECT * FROM filtered ORDER BY ip_number, id LIMIT $6 OFFSET $7
       )
       SELECT (SELECT count(*)::int FROM filtered) AS total_count,
         coalesce(jsonb_agg(jsonb_build_object(
           'id', page.id, 'ipNumber', page.ip_number, 'importer', page.importer,
           'logisticsStatus', page.logistics_status, 'lifecycleStatus', page.lifecycle_status,
           'qualityStatus', page.quality_status,
           'purchaseOrderCount', page.purchase_order_count,
           'historicalLineCount', page.historical_line_count,
           'operationalAllocationCount', page.operational_allocation_count,
           'historicalCostCount', page.historical_cost_count
         ) ORDER BY page.ip_number, page.id) FILTER (WHERE page.id IS NOT NULL), '[]'::jsonb) AS items
       FROM page`,
      [scope.values[0], ipNumber || null, importer || null, logisticsStatus || null, qualityStatus || null, pageSize, (page - 1) * pageSize],
    );
    return { page, pageSize, totalCount: Number(result.rows[0]?.total_count ?? 0), items: result.rows[0]?.items ?? [] };
  });

  app.get<{ Params: { id: string } }>("/api/v1/processes/:id", { config: permissionConfig("processes.read") }, async (request, reply) => {
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) return problem(reply, 400, "Identificador de IP inválido.");
    const scope = importerScopePredicate("process.importer", 2, request.authorizationContext?.importerScopes ?? []);
    const result = await pool.query<{ item: Record<string, unknown> }>(
      `SELECT jsonb_build_object(
         'id', process.id, 'ipNumber', process.ip_number, 'importer', process.importer,
         'logisticsStatus', process.logistics_status, 'qualityStatus', process.quality_status,
         'sourceKind', process.source_kind, 'priority', process.priority,
         'notes', process.notes, 'version', process.version::text,
         'lifecycleStatus', process.lifecycle_status, 'closedAt', process.closed_at,
         'closedBy', process.closed_by, 'closeReason', process.close_reason,
         'purchaseOrders', coalesce((SELECT jsonb_agg(jsonb_build_object(
           'id', po.id, 'number', po.external_number, 'importer', po.importer,
           'linkSource', link.source_kind
         ) ORDER BY po.normalized_number, po.id)
         FROM procurement.process_purchase_order AS link
         JOIN procurement.purchase_order AS po ON po.id = link.purchase_order_id
         WHERE link.process_id = process.id AND po.importer = ANY($2::text[])), '[]'::jsonb),
         'operationalAllocations', coalesce((SELECT jsonb_agg(jsonb_build_object(
           'id', allocation.id, 'poId', po.id, 'poNumber', po.external_number,
           'productCode', item.product_code, 'quantity', allocation.quantity::text,
           'unit', item.unit
         ) ORDER BY po.external_number, item.line_number, allocation.id)
         FROM procurement.po_item_allocation AS allocation
         JOIN procurement.purchase_order_item AS item ON item.id = allocation.purchase_order_item_id
         JOIN procurement.purchase_order AS po ON po.id = item.purchase_order_id
         WHERE allocation.process_id = process.id AND allocation.status = 'ACTIVE'
           AND po.importer = ANY($2::text[])), '[]'::jsonb),
         'historicalCosts', coalesce((SELECT jsonb_agg(jsonb_build_object(
           'id', cost.id, 'type', cost.cost_type, 'currency', cost.currency_code,
           'amount', cost.amount::text, 'status', cost.status,
           'sourceSheetName', source.sheet_name, 'sourceRowNumber', source.row_number,
           'sourceColumn', cost.source_column
         ) ORDER BY cost.cost_type, cost.currency_code, cost.id)
         FROM costs.process_cost AS cost
         JOIN migration.source_row AS source ON source.id = cost.source_row_id
         WHERE cost.process_id = process.id), '[]'::jsonb)
       ) AS item
       FROM imports.import_process AS process WHERE process.id = $1 AND ${scope.sql} LIMIT 1`,
      [id.data, scope.values[0]],
    );
    if (!result.rowCount) return problem(reply, 404, "O IP não existe ou está fora do escopo autorizado.");
    return result.rows[0].item;
  });

  app.get<{ Params: { id: string } }>("/api/v1/processes/:id/items", { config: permissionConfig("processes.read") }, async (request, reply) => {
    const id = z.string().uuid().safeParse(request.params.id);
    const parsed = itemQuery.safeParse(request.query);
    if (!id.success || !parsed.success) return problem(reply, 400, "Identificador ou paginação inválidos.");
    const scope = importerScopePredicate("process.importer", 2, request.authorizationContext?.importerScopes ?? []);
    const result = await pool.query<{ process_found: boolean; total_count: number; items: Record<string, unknown>[] }>(
      `WITH visible AS MATERIALIZED (
         SELECT process.id, process.importer, process.normalized_ip_number
         FROM imports.import_process AS process WHERE process.id = $1 AND ${scope.sql}
       ), filtered AS MATERIALIZED (
         SELECT source.id, source.sheet_name, source.row_number, source.raw_values,
                po.id AS purchase_order_id, po.external_number AS po_number
         FROM visible AS process
         JOIN migration.source_row AS source ON source.sheet_name = 'Pré Embarque'
           AND btrim(source.raw_values->>'F') = process.importer
           AND upper(btrim(source.raw_values->>'AB')) = process.normalized_ip_number
         LEFT JOIN procurement.po_line_observation AS obs ON obs.source_row_id = source.id
         LEFT JOIN procurement.purchase_order AS po ON po.id = obs.purchase_order_id
           AND po.importer = process.importer
       ), page AS (
         SELECT * FROM filtered ORDER BY row_number, id LIMIT $3 OFFSET $4
       )
       SELECT EXISTS(SELECT 1 FROM visible) AS process_found,
              (SELECT count(*)::int FROM filtered) AS total_count,
              coalesce(jsonb_agg(jsonb_build_object(
                'id', page.id, 'sourceSheetName', page.sheet_name,
                'sourceRowNumber', page.row_number, 'sourceValues', page.raw_values,
                'purchaseOrderId', page.purchase_order_id, 'poNumber', page.po_number,
                'productCode', page.raw_values->>'T', 'productDescription', page.raw_values->>'U',
                'quantityFromSource', page.raw_values->>'W', 'legacyStatus', page.raw_values->>'E'
              ) ORDER BY page.row_number, page.id) FILTER (WHERE page.id IS NOT NULL), '[]'::jsonb) AS items
       FROM page`,
      [id.data, scope.values[0], parsed.data.pageSize, (parsed.data.page - 1) * parsed.data.pageSize],
    );
    if (!result.rows[0]?.process_found) return problem(reply, 404, "O IP não existe ou está fora do escopo autorizado.");
    return { ...parsed.data, totalCount: Number(result.rows[0].total_count),
      items: result.rows[0].items.map(item => ({ ...item,
        sourceColumnHeaders: sourceColumnHeadersFor(String(item.sourceSheetName ?? "")),
      })) };
  });

  for (const kind of ["pending-import-items", "unassigned-po-items"] as const) {
    app.get(`/api/v1/${kind}`, { config: permissionConfig("processes.read") }, async (request, reply) => {
      const parsed = (kind === "pending-import-items" ? pendingQuery : unassignedQuery).safeParse(request.query);
      if (!parsed.success) return problem(reply, 400, "Revise os filtros e a paginação.");
      const { page, pageSize, importer } = parsed.data;
      // Legacy-only rows have no normalized PO or IP FK. The importer remains in source column F.
      const scopedSql = `btrim(source.raw_values->>'F') = ANY($1::text[])`;
      const category = kind === "pending-import-items"
        ? `NOT (${validIp("source.raw_values->>'AB'")})`
        : `NULLIF(btrim(source.raw_values->>'N'), '') IS NULL`;
      const filter = kind === "pending-import-items"
        ? `($2::text IS NULL OR strpos(lower(coalesce(source.raw_values->>'N', '')), lower($2)) > 0)`
        : `($2::text IS NULL OR strpos(lower(coalesce(source.raw_values->>'AB', '')), lower($2)) > 0)`;
      const reference = kind === "pending-import-items" ? (parsed.data as z.infer<typeof pendingQuery>).poNumber : (parsed.data as z.infer<typeof unassignedQuery>).ipNumber;
      const result = await pool.query<{ total_count: number; items: Record<string, unknown>[] }>(
        `WITH filtered AS MATERIALIZED (
           SELECT source.id, source.sheet_name, source.row_number, source.raw_values,
                  po.id AS purchase_order_id, po.external_number AS po_number,
                  process.id AS process_id, process.ip_number,
                  ${validIp("source.raw_values->>'AB'")} AS has_valid_ip
           FROM migration.source_row AS source
           LEFT JOIN procurement.po_line_observation AS obs ON obs.source_row_id = source.id
           LEFT JOIN procurement.purchase_order AS po ON po.id = obs.purchase_order_id
           LEFT JOIN imports.import_process AS process
             ON process.normalized_ip_number = upper(btrim(source.raw_values->>'AB'))
             AND process.importer = btrim(source.raw_values->>'F')
           WHERE source.sheet_name = 'Pré Embarque' AND ${scopedSql}
             AND ${category} AND ${filter}
             AND ($3::text IS NULL OR strpos(lower(source.raw_values->>'F'), lower($3)) > 0)
         ), page AS (
           SELECT * FROM filtered ORDER BY sheet_name, row_number, id LIMIT $4 OFFSET $5
         )
         SELECT (SELECT count(*)::int FROM filtered) AS total_count,
           coalesce(jsonb_agg(jsonb_build_object(
             'id', page.id, 'sourceSheetName', page.sheet_name, 'sourceRowNumber', page.row_number,
             'sourceValues', page.raw_values, 'importer', page.raw_values->>'F',
             'sourcePoNumber', page.raw_values->>'N', 'sourceIpNumber', page.raw_values->>'AB',
             'purchaseOrderId', page.purchase_order_id, 'poNumber', page.po_number,
             'processId', page.process_id, 'ipNumber', page.ip_number,
             'legacyStatus', page.raw_values->>'E',
             'reason', CASE WHEN page.has_valid_ip THEN 'PO ausente na origem' ELSE 'IP ausente ou inválido na origem' END,
             'alsoWithoutPo', NULLIF(btrim(page.raw_values->>'N'), '') IS NULL,
             'alsoWithoutIp', NOT page.has_valid_ip
           ) ORDER BY page.sheet_name, page.row_number, page.id)
             FILTER (WHERE page.id IS NOT NULL), '[]'::jsonb) AS items
         FROM page`,
        [request.authorizationContext?.importerScopes ?? [], reference || null, importer || null, pageSize, (page - 1) * pageSize],
      );
      const items = result.rows[0]?.items ?? [];
      return { page, pageSize, totalCount: Number(result.rows[0]?.total_count ?? 0),
        items: items.map(item => ({ ...item,
          sourceColumnHeaders: sourceColumnHeadersFor(String(item.sourceSheetName ?? "")),
        })) };
    });
  }
}
