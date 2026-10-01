import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";

const preColumns = excelColumns("B", "AZ");
const postColumns = excelColumns("B", "AS");
const allowedColumns = new Set([...preColumns, ...postColumns]);
const preHeaders = ["Necessity", "Priority", "Alert", "Status", "Importer", "Demand", "Requester", "SC Totvs", "SC Appr. Date", "Finalidade", "Cost Center", "Draft PO", "PO Totvs", "PO Date", "PO Appr. Date", "PO Sent Date", "Supplier", "Category", "Product Code", "Product Description", "NCM", "Qty", "Unit Price", "Total Price", "Currency", "Remarks", "IP Number", "IP Date Totvs", "Mode", "Incoterm", "Broker", "POL", "POD", "ETD", "ETA", "Transit Time", "Invoice", "BL Number", "BL Date", "Arrival", "Duimp", "Duimp Date", "Channel", "Clearance", "ETE", "NF Request", "NF", "NF Issue Date", "Delivery Date", "LT Total", "Rupture Risk"];
const postHeaders = ["IP Number", "Priority", "Alert", "Status", "Importer", "Supplier", "Invoice", "Currency", "Total Amount", "Mode", "Incoterm", "POL", "POD", "Broker", "BL Number", "ETD", "Transit Time", "ETA", "ETE Eletra", "BL Date", "Freight Ccy.", "Freight Cost", "Container", "Ctnr Type", "Ctnr Qty", "Forwarder", "Doc ok", "Arrival", "Due Storage", "Taxes Paid (R$)", "Duimp", "Duimp Date", "Channel", "Clearance", "NF Request", "NF", "NF Issue Date", "NF Homolog.", "Delivery Date", "(sem cabeçalho)", "Fines R$", "Storage R$", "Demurrage R$", "Qty Ctnr Dem"];
const querySchema = z.object({
  sheet: z.enum(["all", "Pré Embarque", "Pós Embarque"]).default("all"),
  importer: z.string().trim().max(120).optional(),
  search: z.string().trim().max(160).optional(),
  gap: z.enum(["all", "without-ip", "without-po", "quality", "any"]).default("all"),
  filters: z.string().max(8000).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
const columnFiltersSchema = z.record(z.string().regex(/^[A-Z]{1,2}$/u), z.string().trim().min(1).max(200))
  .refine(value => Object.keys(value).length <= 88, "Muitos filtros de coluna.");

function excelColumns(first: string, last: string): string[] {
  const number = (label: string) => [...label].reduce((result, char) => result * 26 + char.charCodeAt(0) - 64, 0);
  const label = (value: number) => {
    let current = value;
    let result = "";
    while (current > 0) {
      current -= 1;
      result = String.fromCharCode(65 + current % 26) + result;
      current = Math.floor(current / 26);
    }
    return result;
  };
  return Array.from({ length: number(last) - number(first) + 1 }, (_, index) => label(number(first) + index));
}

function problem(reply: FastifyReply, status: number, code: string, detail: string) {
  return reply.code(status).send({ type: "about:blank", title: detail, status, detail,
    instance: reply.request.url.split("?", 1)[0], traceId: reply.request.id, code });
}

export async function registerSourceAuditRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/v1/source-rows", { config: permissionConfig("processes.read") }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Revise a aba, os filtros de coluna ou a paginação.");
    const { sheet, importer, search, gap, page, pageSize } = parsed.data;
    let columnFilters: Record<string, string> = {};
    if (parsed.data.filters) {
      let value: unknown;
      try { value = JSON.parse(parsed.data.filters); }
      catch { return problem(reply, 400, "INVALID_COLUMN_FILTER", "Os filtros de coluna não são JSON válido."); }
      const validated = columnFiltersSchema.safeParse(value);
      if (!validated.success) return problem(reply, 400, "INVALID_COLUMN_FILTER", "Um ou mais filtros de coluna são inválidos.");
      columnFilters = Object.fromEntries(Object.entries(validated.data).filter(([, item]) => item.length > 0));
      const sheetColumns = sheet === "Pré Embarque" ? preColumns : sheet === "Pós Embarque" ? postColumns : [...allowedColumns];
      if (Object.keys(columnFilters).some(column => !sheetColumns.includes(column))) {
        return problem(reply, 400, "INVALID_COLUMN_FILTER", "O filtro usa uma coluna que não existe na aba selecionada.");
      }
    }
    const scopes = request.authorizationContext?.importerScopes ?? [];
    const preNoIp = `(${validIp("source.raw_values->>'AB'")}) IS NOT TRUE`;
    const postNoIp = `(${validIp("source.raw_values->>'B'")}) IS NOT TRUE`;
    const noIp = `(source.sheet_name = 'Pré Embarque' AND ${preNoIp}) OR (source.sheet_name = 'Pós Embarque' AND ${postNoIp})`;
    const noPo = `(source.sheet_name = 'Pré Embarque' AND NULLIF(btrim(source.raw_values->>'N'), '') IS NULL)`;
    const qualityGap = `(issues.open_issue_count > 0 OR jsonb_array_length(source.error_columns) > 0)`;
    const columnPredicate = `NOT EXISTS (
      SELECT 1 FROM jsonb_each_text($4::jsonb) AS filter(column_key, filter_value)
      WHERE strpos(lower(coalesce(source.raw_values ->> filter.column_key, '')), lower(filter.filter_value)) = 0
    )`;
    const result = await pool.query<{
      total_count: number; rows_before_gap_filter: number; without_po: number; without_ip: number;
      quality_issues: number; any_gap: number; items: Array<Record<string, unknown>>;
    }>(
      `WITH visible AS MATERIALIZED (
         SELECT source.id, source.batch_id, source.sheet_name, source.row_number,
                source.raw_values, source.error_columns, btrim(source.raw_values->>'F') AS importer,
                po.id AS purchase_order_id, po.external_number AS po_number,
                process.id AS process_id, process.ip_number,
                issues.open_issue_count,
                (${noPo}) AS missing_po,
                (${noIp}) AS missing_ip,
                ${qualityGap} AS has_quality_gap
         FROM migration.source_row AS source
         LEFT JOIN procurement.po_line_observation AS observation ON observation.source_row_id = source.id
         LEFT JOIN procurement.purchase_order AS po ON po.id = observation.purchase_order_id
         LEFT JOIN imports.import_process AS process
           ON process.normalized_ip_number = upper(btrim(CASE source.sheet_name
                WHEN 'Pré Embarque' THEN source.raw_values->>'AB'
                WHEN 'Pós Embarque' THEN source.raw_values->>'B' END))
          AND process.importer = btrim(source.raw_values->>'F')
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE issue.status = 'OPEN')::int AS open_issue_count
           FROM migration.data_issue AS issue WHERE issue.source_row_id = source.id
         ) AS issues ON TRUE
         WHERE btrim(source.raw_values->>'F') = ANY($1::text[])
           AND ($2::text = 'all' OR source.sheet_name = $2)
           AND ($3::text IS NULL OR btrim(source.raw_values->>'F') = $3)
       ), filtered AS MATERIALIZED (
         SELECT * FROM visible AS source
         WHERE ($5::text IS NULL OR strpos(lower(concat_ws(' ', source.batch_id::text, source.sheet_name,
                source.importer, source.po_number, source.ip_number, source.raw_values::text)), lower($5)) > 0)
           AND ${columnPredicate}
       ), gap_filtered AS MATERIALIZED (
         SELECT * FROM filtered AS source
         WHERE $6::text = 'all'
            OR ($6::text = 'without-ip' AND source.missing_ip)
            OR ($6::text = 'without-po' AND source.missing_po)
            OR ($6::text = 'quality' AND source.has_quality_gap)
            OR ($6::text = 'any' AND (source.missing_ip OR source.missing_po OR source.has_quality_gap))
       ), page AS (
         SELECT * FROM gap_filtered ORDER BY sheet_name, row_number, id LIMIT $7 OFFSET $8
       )
       SELECT (SELECT count(*)::int FROM gap_filtered) AS total_count,
              (SELECT count(*)::int FROM filtered) AS rows_before_gap_filter,
              (SELECT count(*) FILTER (WHERE missing_po)::int FROM filtered) AS without_po,
              (SELECT count(*) FILTER (WHERE missing_ip)::int FROM filtered) AS without_ip,
              (SELECT count(*) FILTER (WHERE has_quality_gap)::int FROM filtered) AS quality_issues,
              (SELECT count(*) FILTER (WHERE missing_ip OR missing_po OR has_quality_gap)::int FROM filtered) AS any_gap,
              coalesce(jsonb_agg(jsonb_build_object(
                'id', page.id, 'batchId', page.batch_id,
                'sourceSheetName', page.sheet_name, 'sourceRowNumber', page.row_number,
                'importer', page.importer, 'sourceValues', page.raw_values,
                'cellErrors', page.error_columns,
                'purchaseOrderId', page.purchase_order_id, 'poNumber', page.po_number,
                'processId', page.process_id, 'ipNumber', page.ip_number,
                'auditFlags', jsonb_build_object('withoutPurchaseOrder', page.missing_po,
                  'withoutValidIp', page.missing_ip, 'openQualityIssues', page.open_issue_count,
                  'cellErrors', jsonb_array_length(page.error_columns), 'anyGap',
                  page.missing_ip OR page.missing_po OR page.has_quality_gap)
              ) ORDER BY page.sheet_name, page.row_number, page.id)
                FILTER (WHERE page.id IS NOT NULL), '[]'::jsonb) AS items
       FROM page`,
      [scopes, sheet, importer || null, JSON.stringify(columnFilters), search || null, gap,
        pageSize, (page - 1) * pageSize]);

    const columns = sheet === "Pré Embarque" ? preColumns : sheet === "Pós Embarque" ? postColumns
      : [...new Set([...preColumns, ...postColumns])].sort((left, right) => excelColumnNumber(left) - excelColumnNumber(right));
    const columnHeaders: Record<string, string> = {};
    for (const [index, key] of preColumns.entries()) columnHeaders[key] = preHeaders[index] ?? "";
    for (const [index, key] of postColumns.entries()) {
      const label = postHeaders[index] ?? "";
      if (sheet === "Pós Embarque" || !columnHeaders[key]) columnHeaders[key] = label;
      else if (sheet === "all" && label && !columnHeaders[key].split(" / ").includes(label)) {
        columnHeaders[key] += ` / ${label}`;
      }
    }
    return {
      page, pageSize, sheet, gap, totalCount: Number(result.rows[0]?.total_count ?? 0),
      rowsBeforeGapFilter: Number(result.rows[0]?.rows_before_gap_filter ?? 0),
      summary: { withoutPurchaseOrder: Number(result.rows[0]?.without_po ?? 0),
        withoutValidIp: Number(result.rows[0]?.without_ip ?? 0),
        withQualityIssues: Number(result.rows[0]?.quality_issues ?? 0),
        anyGap: Number(result.rows[0]?.any_gap ?? 0) },
      columns,
      columnHeaders,
      items: result.rows[0]?.items ?? [],
    };
  });
}

function validIp(expression: string): string {
  return `NULLIF(btrim(${expression}), '') IS NOT NULL AND upper(btrim(${expression})) NOT IN ('CANCELLED', 'CANCELED') AND left(btrim(${expression}), 1) <> '#'`;
}

function excelColumnNumber(label: string): number {
  return [...label].reduce((result, char) => result * 26 + char.charCodeAt(0) - 64, 0);
}
