import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { importerScopePredicate, permissionConfig } from "./authorization.js";
import { sourceColumnHeadersFor } from "./source-audit.js";

const portfolioFilterFields = {
  number: z.string().trim().max(80).optional(),
  importer: z.string().trim().max(120).optional(),
  product: z.string().trim().max(200).optional(),
  ipNumber: z.string().trim().max(80).optional(),
};
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  ...portfolioFilterFields,
}).strict();
const summaryQuery = z.object(portfolioFilterFields).strict();

function portfolioWhere(scopeSql: string): string {
  return `WHERE ${scopeSql}
    AND ($2::text IS NULL OR strpos(po.normalized_number, upper($2)) > 0)
    AND ($3::text IS NULL OR strpos(lower(po.importer), lower($3)) > 0)
    AND ($4::text IS NULL OR EXISTS (
      SELECT 1 FROM procurement.po_line_observation AS obs
      WHERE obs.purchase_order_id = po.id
        AND (strpos(lower(coalesce(obs.product_code_snapshot, '')), lower($4)) > 0
             OR strpos(lower(coalesce(obs.description_snapshot, '')), lower($4)) > 0)
    ))
    AND ($5::text IS NULL OR EXISTS (
      SELECT 1 FROM procurement.process_purchase_order AS link
      JOIN imports.import_process AS process ON process.id = link.process_id
      WHERE link.purchase_order_id = po.id
        AND process.importer = ANY($1::text[])
        AND strpos(lower(process.ip_number), lower($5)) > 0
    ))`;
}

type PurchaseOrderListRow = {
  total_count: number | string;
  items: Array<Record<string, unknown>>;
};

function badQuery(reply: FastifyReply, issues: unknown) {
  return reply.code(400).send({
    type: "about:blank",
    title: "Parâmetros inválidos",
    status: 400,
    detail: "Revise os filtros e os parâmetros de paginação.",
    instance: reply.request.url.split("?", 1)[0],
    traceId: reply.request.id,
    code: "INVALID_QUERY",
    errors: issues,
  });
}

export async function registerPurchaseOrderReadRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/purchase-orders", {
    config: permissionConfig("purchase-orders.read"),
  }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return badQuery(reply, parsed.error.flatten().fieldErrors);

    const { page, pageSize, number, importer, product, ipNumber } = parsed.data;
    const scopes = request.authorizationContext?.importerScopes ?? [];
    const scoped = importerScopePredicate("po.importer", 1, scopes);
    const offset = (page - 1) * pageSize;
    const result = await pool.query<PurchaseOrderListRow>(
      `WITH filtered AS MATERIALIZED (
         SELECT po.id,
                po.normalized_number,
                po.external_number,
                po.importer,
                po.identity_status,
                (SELECT count(*)::int
                 FROM procurement.po_line_observation AS obs
                 WHERE obs.purchase_order_id = po.id) AS historical_item_count,
                (SELECT count(*)::int
                 FROM procurement.po_line_observation AS obs
                 WHERE obs.purchase_order_id = po.id
                   AND NULLIF(btrim(obs.source_ip_text), '') IS NOT NULL
                   AND upper(btrim(obs.source_ip_text)) NOT IN ('CANCELLED', 'CANCELED')
                   AND left(btrim(obs.source_ip_text), 1) <> '#') AS historical_items_with_ip,
                (SELECT count(*)::int
                 FROM procurement.po_line_observation AS obs
                 WHERE obs.purchase_order_id = po.id
                   AND (NULLIF(btrim(obs.source_ip_text), '') IS NULL
                        OR upper(btrim(obs.source_ip_text)) IN ('CANCELLED', 'CANCELED')
                        OR left(btrim(obs.source_ip_text), 1) = '#')) AS historical_items_without_ip,
                (SELECT count(*)::int
                 FROM procurement.process_purchase_order AS link
                 JOIN imports.import_process AS process ON process.id = link.process_id
                 WHERE link.purchase_order_id = po.id
                   AND process.importer = ANY($1::text[])) AS linked_process_count,
                (SELECT count(DISTINCT issue.id)::int
                 FROM migration.data_issue AS issue
                 JOIN procurement.po_line_observation AS obs
                   ON obs.source_row_id = issue.source_row_id
                 WHERE obs.purchase_order_id = po.id AND issue.status = 'OPEN') AS unresolved_issue_count
         FROM procurement.purchase_order AS po
         ${portfolioWhere(scoped.sql)}
       ), page AS (
         SELECT * FROM filtered
         ORDER BY normalized_number, id
         LIMIT $6 OFFSET $7
       )
       SELECT (SELECT count(*)::int FROM filtered) AS total_count,
              coalesce(
                jsonb_agg(jsonb_build_object(
                  'id', page.id,
                  'number', page.external_number,
                  'importer', page.importer,
                  'identityStatus', page.identity_status,
                  'officialItemsKnown', false,
                  'historicalItemCount', page.historical_item_count,
                  'linkedProcessCount', page.linked_process_count,
                  'historicalItemsWithIp', page.historical_items_with_ip,
                  'historicalItemsWithoutIp', page.historical_items_without_ip,
                  'unresolvedIssueCount', page.unresolved_issue_count,
                  'balanceAvailable', false
                ) ORDER BY page.normalized_number, page.id)
                FILTER (WHERE page.id IS NOT NULL),
                '[]'::jsonb
              ) AS items
       FROM page`,
      [scoped.values[0], number || null, importer || null, product || null, ipNumber || null, pageSize, offset],
    );

    return {
      page,
      pageSize,
      totalCount: Number(result.rows[0]?.total_count ?? 0),
      items: result.rows[0]?.items ?? [],
    };
  });

  app.get("/api/v1/purchase-orders/summary", {
    config: permissionConfig("purchase-orders.read"),
  }, async (request, reply) => {
    const parsed = summaryQuery.safeParse(request.query);
    if (!parsed.success) return badQuery(reply, parsed.error.flatten().fieldErrors);
    const { number, importer, product, ipNumber } = parsed.data;
    const scoped = importerScopePredicate(
      "po.importer", 1, request.authorizationContext?.importerScopes ?? [],
    );
    const result = await pool.query<{
      purchase_orders: number; linked_processes: number; lines: number;
      lines_without_ip: number; by_importer: Array<{ importer: string; purchaseOrders: number }>;
      source_snapshot_at: Date | null;
    }>(
      `WITH filtered_po AS MATERIALIZED (
         SELECT po.id, po.importer FROM procurement.purchase_order AS po
         ${portfolioWhere(scoped.sql)}
       ), lines AS (
         SELECT count(*)::int AS total,
                count(*) FILTER (WHERE
                  NULLIF(btrim(obs.source_ip_text), '') IS NULL
                  OR upper(btrim(obs.source_ip_text)) IN ('CANCELLED', 'CANCELED')
                  OR left(btrim(obs.source_ip_text), 1) = '#')::int AS without_ip
         FROM filtered_po AS po
         JOIN procurement.po_line_observation AS obs ON obs.purchase_order_id = po.id
       ), linked AS (
         SELECT count(DISTINCT process.id)::int AS total
         FROM filtered_po AS po
         JOIN procurement.process_purchase_order AS link ON link.purchase_order_id = po.id
         JOIN imports.import_process AS process ON process.id = link.process_id
         WHERE process.importer = ANY($1::text[])
       ), importer_counts AS (
         SELECT importer, count(*)::int AS purchase_orders
         FROM filtered_po GROUP BY importer
       ), source_version AS (
         SELECT max(source.created_at) AS source_snapshot_at
         FROM filtered_po AS po
         JOIN procurement.po_line_observation AS obs ON obs.purchase_order_id = po.id
         JOIN migration.source_row AS source ON source.id = obs.source_row_id
       )
       SELECT (SELECT count(*)::int FROM filtered_po) AS purchase_orders,
              (SELECT total FROM linked) AS linked_processes,
              (SELECT total FROM lines) AS lines,
              (SELECT without_ip FROM lines) AS lines_without_ip,
              (SELECT source_snapshot_at FROM source_version) AS source_snapshot_at,
              coalesce((SELECT jsonb_agg(jsonb_build_object(
                'importer', importer, 'purchaseOrders', purchase_orders)
                ORDER BY importer) FROM importer_counts), '[]'::jsonb) AS by_importer`,
      [scoped.values[0], number || null, importer || null, product || null, ipNumber || null],
    );
    const row = result.rows[0];
    reply.header("Cache-Control", "no-store");
    return {
      purchaseOrders: Number(row?.purchase_orders ?? 0),
      linkedProcesses: Number(row?.linked_processes ?? 0),
      lines: Number(row?.lines ?? 0),
      linesWithoutIp: Number(row?.lines_without_ip ?? 0),
      sourceSnapshotAt: row?.source_snapshot_at ?? null,
      byImporter: row?.by_importer ?? [],
    };
  });

  app.get<{ Params: { id: string } }>(
    "/api/v1/purchase-orders/:id/overview",
    { config: permissionConfig("purchase-orders.read") },
    async (request, reply) => {
      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success) return badQuery(reply, { id: id.error.issues });

      const scopes = request.authorizationContext?.importerScopes ?? [];
      const scoped = importerScopePredicate("po.importer", 2, scopes);
      const overview = await pool.query<{ item: Record<string, unknown> | null }>(
        `SELECT jsonb_build_object(
           'id', po.id,
           'number', po.external_number,
           'importer', po.importer,
           'identityStatus', po.identity_status,
           'version', po.version::text,
           'officialItemsKnown', false,
           'balanceAvailable', false,
           'historicalItemCount', (
             SELECT count(*)::int FROM procurement.po_line_observation AS obs
             WHERE obs.purchase_order_id = po.id
           ),
           'unresolvedIssueCount', (
             SELECT count(DISTINCT issue.id)::int
             FROM migration.data_issue AS issue
             JOIN procurement.po_line_observation AS obs ON obs.source_row_id = issue.source_row_id
             WHERE obs.purchase_order_id = po.id AND issue.status = 'OPEN'
           ),
           'coverage', jsonb_build_object(
             'historicalLines', (
               SELECT count(*)::int FROM procurement.po_line_observation AS obs
               WHERE obs.purchase_order_id = po.id
             ),
             'linesWithIp', (
               SELECT count(*)::int FROM procurement.po_line_observation AS obs
               WHERE obs.purchase_order_id = po.id
                 AND NULLIF(btrim(obs.source_ip_text), '') IS NOT NULL
                 AND upper(btrim(obs.source_ip_text)) NOT IN ('CANCELLED', 'CANCELED')
                 AND left(btrim(obs.source_ip_text), 1) <> '#'
             ),
             'linesWithoutIp', (
               SELECT count(*)::int FROM procurement.po_line_observation AS obs
               WHERE obs.purchase_order_id = po.id
                 AND (NULLIF(btrim(obs.source_ip_text), '') IS NULL
                      OR upper(btrim(obs.source_ip_text)) IN ('CANCELLED', 'CANCELED')
                      OR left(btrim(obs.source_ip_text), 1) = '#')
             )
           ),
           'processes', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
               'id', process.id,
               'ipNumber', process.ip_number,
               'logisticsStatus', process.logistics_status,
               'qualityStatus', process.quality_status,
               'linkSource', link.source_kind,
               'linkedPurchaseOrderCount', (
                 SELECT count(*)::int
                 FROM procurement.process_purchase_order AS other_link
                 JOIN procurement.purchase_order AS other_po ON other_po.id = other_link.purchase_order_id
                 WHERE other_link.process_id = process.id AND other_po.importer = ANY($2::text[])
               ),
               'costs', coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                   'type', cost.cost_type,
                   'currency', cost.currency_code,
                   'amount', cost.amount::text,
                   'status', cost.status
                 ) ORDER BY cost.cost_type, cost.currency_code, cost.id)
                 FROM costs.process_cost AS cost WHERE cost.process_id = process.id
               ), '[]'::jsonb)
             ) ORDER BY process.ip_number, process.id)
             FROM procurement.process_purchase_order AS link
             JOIN imports.import_process AS process ON process.id = link.process_id
             WHERE link.purchase_order_id = po.id AND process.importer = ANY($2::text[])
           ), '[]'::jsonb)
         ) AS item
         FROM procurement.purchase_order AS po
         WHERE po.id = $1 AND ${scoped.sql}
         LIMIT 1`,
        [id.data, scoped.values[0]],
      );

      if (!overview.rowCount || !overview.rows[0]?.item) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Recurso não encontrado",
          status: 404,
          detail: "A PO não existe ou não está disponível no escopo autorizado.",
          instance: request.url.split("?", 1)[0],
          traceId: request.id,
          code: "RESOURCE_NOT_FOUND",
        });
      }
      return overview.rows[0].item;
    },
  );

  app.get<{ Params: { id: string }; Querystring: { page?: string; pageSize?: string } }>(
    "/api/v1/purchase-orders/:id/history-items",
    { config: permissionConfig("purchase-orders.read") },
    async (request, reply) => {
      const id = z.string().uuid().safeParse(request.params.id);
      const pagination = z.object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      }).safeParse(request.query);
      if (!id.success || !pagination.success) {
        const issues = !id.success
          ? { id: id.error.issues }
          : !pagination.success ? pagination.error.flatten().fieldErrors : {};
        return badQuery(reply, issues);
      }

      const scopes = request.authorizationContext?.importerScopes ?? [];
      const scoped = importerScopePredicate("po.importer", 2, scopes);
      const visible = await pool.query<{ id: string }>(
        `SELECT po.id
         FROM procurement.purchase_order AS po
         WHERE po.id = $1 AND ${scoped.sql}
         LIMIT 1`,
        [id.data, scoped.values[0]],
      );
      if (!visible.rowCount) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Recurso não encontrado",
          status: 404,
          detail: "A PO não existe ou não está disponível no escopo autorizado.",
          instance: request.url.split("?", 1)[0],
          traceId: request.id,
          code: "RESOURCE_NOT_FOUND",
        });
      }

      const { page, pageSize } = pagination.data;
      const offset = (page - 1) * pageSize;
      const history = await pool.query<{ total_count: number | string; items: Array<Record<string, unknown>> }>(
        `WITH filtered AS MATERIALIZED (
           SELECT obs.source_row_id,
                  obs.source_row_number,
                  obs.product_code_snapshot,
                  obs.description_snapshot,
                  obs.quantity::text AS quantity,
                  obs.historical_amount::text AS historical_amount,
                  obs.currency_code,
                  obs.necessity_date,
                  obs.historical_status,
                  obs.source_ip_text,
                  source.sheet_name,
                  source.raw_values
           FROM procurement.purchase_order AS po
           JOIN procurement.po_line_observation AS obs ON obs.purchase_order_id = po.id
           JOIN migration.source_row AS source ON source.id = obs.source_row_id
           WHERE po.id = $1 AND ${scoped.sql}
         ), page AS (
           SELECT * FROM filtered
           ORDER BY source_row_number, source_row_id
           LIMIT $3 OFFSET $4
         )
         SELECT (SELECT count(*)::int FROM filtered) AS total_count,
                coalesce(
                  jsonb_agg(jsonb_build_object(
                    'id', page.source_row_id,
                    'sourceRowNumber', page.source_row_number,
                    'productCode', page.product_code_snapshot,
                    'productDescription', page.description_snapshot,
                    'quantity', page.quantity,
                    'historicalAmount', page.historical_amount,
                    'currency', page.currency_code,
                    'necessityDate', page.necessity_date,
                    'legacyStatus', page.historical_status,
                    'ipNumber', page.source_ip_text,
                    'sourceSheetName', page.sheet_name,
                    'sourceValues', page.raw_values
                  ) ORDER BY page.source_row_number, page.source_row_id)
                  FILTER (WHERE page.source_row_id IS NOT NULL),
                  '[]'::jsonb
                ) AS items
         FROM page`,
        [id.data, scoped.values[0], pageSize, offset],
      );
      const items = history.rows[0]?.items ?? [];
      return { page, pageSize, totalCount: Number(history.rows[0]?.total_count ?? 0),
        items: items.map(item => ({ ...item,
          // PO observations are created only from the Pré Embarque sheet. Use
          // that schema directly so legacy sheet-name encoding cannot hide labels.
          sourceColumnHeaders: sourceColumnHeadersFor("Pré Embarque"),
        })) };
    },
  );
}
