import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { permissionConfig } from "./authorization.js";

const preColumns = excelColumns("B", "BB");
const postColumns = excelColumns("B", "AS");
const allowedColumns = new Set([...preColumns, ...postColumns]);
const preHeaders = ["Necessity", "Priority", "Alert", "Status", "Importer", "Demand", "Requester", "SC Totvs", "SC Appr. Date", "Finalidade", "Cost Center", "Draft PO", "PO Totvs", "PO Date", "PO Appr. Date", "PO Sent Date", "Supplier", "Category", "Product Code", "Product Description", "NCM", "Qty", "Unit Price", "Total Price", "Currency", "Remarks", "IP Number", "IP Date Totvs", "Mode", "Incoterm", "Broker", "POL", "POD", "ETD", "ETA", "Transit Time", "Invoice", "BL Number", "BL Date", "Arrival", "Duimp", "Duimp Date", "Channel", "Clearance", "ETE", "NF Request", "NF", "NF Issue Date", "Delivery Date", "LT Total", "Rupture Risk"];
preHeaders.push("(sem cabeçalho)", "Coluna BB");
const postHeaders = ["IP Number", "Priority", "Alert", "Status", "Importer", "Supplier", "Invoice", "Currency", "Total Amount", "Mode", "Incoterm", "POL", "POD", "Broker", "BL Number", "ETD", "Transit Time", "ETA", "ETE Eletra", "BL Date", "Freight Ccy.", "Freight Cost", "Container", "Ctnr Type", "Ctnr Qty", "Forwarder", "Doc ok", "Arrival", "Due Storage", "Taxes Paid (R$)", "Duimp", "Duimp Date", "Channel", "Clearance", "NF Request", "NF", "NF Issue Date", "NF Homolog.", "Delivery Date", "(sem cabeçalho)", "Fines R$", "Storage R$", "Demurrage R$", "Qty Ctnr Dem"];
const querySchema = z.object({
  sheet: z.enum(["all", "Pré Embarque", "Pós Embarque"]).default("all"),
  importer: z.string().trim().max(120).optional(),
  search: z.string().trim().max(160).optional(),
  gap: z.enum(["all", "without-ip", "without-po", "quality", "any"]).default("all"),
  filters: z.string().max(48000).optional(),
  sortColumn: z.string().regex(/^[A-Z]{1,2}$/u).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
const columnFilterSchema = z.union([
  z.string().trim().min(1).max(200),
  z.object({ text: z.string().trim().max(200).optional(),
    values: z.array(z.string().max(500)).max(100).optional(), exclude: z.boolean().optional() }).strict(),
]);
const columnFiltersSchema = z.record(z.string().regex(/^[A-Z]{1,2}$/u), columnFilterSchema)
  .refine(value => Object.keys(value).length <= 88, "Muitos filtros de coluna.");
const valuesQuerySchema = z.object({
  sheet: z.enum(["all", "Pré Embarque", "Pós Embarque"]).default("all"),
  importer: z.string().trim().max(120).optional(), search: z.string().trim().max(160).optional(),
  gap: z.enum(["all", "without-ip", "without-po", "quality", "any"]).default("all"),
  filters: z.string().max(48000).optional(), column: z.string().regex(/^[A-Z]{1,2}$/u),
  valueSearch: z.string().trim().max(160).optional(),
}).strict();

type ColumnFilter = z.infer<typeof columnFilterSchema>;

function columnsForSheet(sheet: string): string[] {
  return sheet === "Pré Embarque" ? preColumns : sheet === "Pós Embarque" ? postColumns : [...allowedColumns];
}

function parseColumnFilters(raw: string | undefined, sheet: string, reply: FastifyReply): Record<string, ColumnFilter> | null {
  if (!raw) return {};
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { problem(reply, 400, "INVALID_COLUMN_FILTER", "Os filtros de coluna não são JSON válido."); return null; }
  const validated = columnFiltersSchema.safeParse(value);
  if (!validated.success) {
    problem(reply, 400, "INVALID_COLUMN_FILTER", "Um ou mais filtros de coluna são inválidos.");
    return null;
  }
  const sheetColumns = columnsForSheet(sheet);
  if (Object.keys(validated.data).some(column => !sheetColumns.includes(column))) {
    problem(reply, 400, "INVALID_COLUMN_FILTER", "O filtro usa uma coluna que não existe na aba selecionada.");
    return null;
  }
  return validated.data;
}

function columnFilterPredicate(filtersParameter: string, excludeColumnParameter?: string): string {
  const excludeColumn = excludeColumnParameter ? `AND filter.column_key <> ${excludeColumnParameter}` : "";
  return `NOT EXISTS (
    SELECT 1 FROM jsonb_each(${filtersParameter}::jsonb) AS filter(column_key, filter_spec)
    WHERE ${excludeColumn ? `TRUE ${excludeColumn} AND` : ""} (
      (jsonb_typeof(filter.filter_spec) = 'string'
        AND strpos(lower(coalesce(source.raw_values ->> filter.column_key, '')), lower(filter.filter_spec #>> '{}')) = 0)
      OR (jsonb_typeof(filter.filter_spec) = 'object' AND (
        (nullif(filter.filter_spec->>'text', '') IS NOT NULL
          AND strpos(lower(coalesce(source.raw_values ->> filter.column_key, '')), lower(filter.filter_spec->>'text')) = 0)
        OR (filter.filter_spec ? 'values' AND CASE
          WHEN coalesce((filter.filter_spec->>'exclude')::boolean, false)
            THEN coalesce(source.raw_values ->> filter.column_key, '') = ANY(ARRAY(
              SELECT jsonb_array_elements_text(filter.filter_spec->'values')))
          ELSE coalesce(source.raw_values ->> filter.column_key, '') <> ALL(ARRAY(
              SELECT jsonb_array_elements_text(filter.filter_spec->'values')))
        END)
      ))
    )
  )`;
}

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
  app.get("/api/v1/source-rows/column-values", { config: permissionConfig("processes.read") }, async (request, reply) => {
    const parsed = valuesQuerySchema.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Revise a coluna e os filtros para listar os valores.");
    const { sheet, importer, search, gap, column, valueSearch } = parsed.data;
    if (!columnsForSheet(sheet).includes(column)) {
      return problem(reply, 400, "INVALID_COLUMN", "A coluna não existe na aba selecionada.");
    }
    const columnFilters = parseColumnFilters(parsed.data.filters, sheet, reply);
    if (!columnFilters) return;
    const optionsFilter = columnFilters[column];
    const selectedValues = typeof optionsFilter === "object" && optionsFilter !== null && "values" in optionsFilter
      ? optionsFilter.values ?? [] : [];
    const columnPredicate = columnFilterPredicate("$4", "$5");
    const preNoIp = `(${validIp("source.raw_values->>'AB'")}) IS NOT TRUE`;
    const postNoIp = `(${validIp("source.raw_values->>'B'")}) IS NOT TRUE`;
    const noIp = `(source.sheet_name = 'Pré Embarque' AND ${preNoIp}) OR (source.sheet_name = 'Pós Embarque' AND ${postNoIp})`;
    const noPo = `(source.sheet_name = 'Pré Embarque' AND NULLIF(btrim(source.raw_values->>'N'), '') IS NULL)`;
    const calculationError = `jsonb_array_length(source.error_columns) > 0`;
    const result = await pool.query<{ total_count: number; items: Array<{ value: string; rowCount: number }> }>(
      `WITH visible AS MATERIALIZED (
         SELECT source.id, source.batch_id, source.sheet_name, source.row_number, source.raw_values,
                source.error_columns,
                (${noPo}) AS missing_po, (${noIp}) AS missing_ip, ${calculationError} AS has_calculation_error
         FROM migration.source_row AS source
         WHERE btrim(source.raw_values->>'F') = ANY($1::text[])
           AND ($2::text = 'all' OR source.sheet_name = $2)
           AND ($3::text IS NULL OR btrim(source.raw_values->>'F') = $3)
       ), filtered AS MATERIALIZED (
         SELECT * FROM visible AS source
         WHERE ($6::text IS NULL OR strpos(lower(concat_ws(' ', source.batch_id::text, source.sheet_name,
                source.raw_values->>'F', source.raw_values::text)), lower($6)) > 0)
           AND ${columnPredicate}
           AND ($7::text = 'all'
             OR ($7::text = 'without-ip' AND source.missing_ip)
             OR ($7::text = 'without-po' AND source.missing_po)
             OR ($7::text = 'quality' AND source.has_calculation_error)
             OR ($7::text = 'any' AND (source.missing_ip OR source.missing_po OR source.has_calculation_error)))
       ), grouped AS MATERIALIZED (
         SELECT coalesce(source.raw_values->>$5, '') AS value, count(*)::int AS row_count
         FROM filtered AS source GROUP BY 1
       ), option_page AS (
         SELECT value, row_count FROM grouped
         WHERE ($8::text IS NULL OR strpos(lower(value), lower($8)) > 0)
         ORDER BY lower(value), value LIMIT 200
       )
       SELECT (SELECT count(*)::int FROM grouped
                 WHERE $8::text IS NULL OR strpos(lower(value), lower($8)) > 0) AS total_count,
              coalesce(jsonb_agg(jsonb_build_object('value', option_page.value, 'rowCount', option_page.row_count)
                ORDER BY lower(option_page.value), option_page.value) FILTER (WHERE option_page.value IS NOT NULL),
                '[]'::jsonb) AS items
       FROM option_page`,
      [request.authorizationContext?.importerScopes ?? [], sheet, importer || null,
        JSON.stringify(columnFilters), column, search || null, gap, valueSearch || null]);
    const items = result.rows[0]?.items ?? [];
    const knownValues = new Set(items.map(item => item.value));
    for (const value of selectedValues) if (!knownValues.has(value)) items.push({ value, rowCount: 0 });
    return { column, items, totalCount: Number(result.rows[0]?.total_count ?? 0),
      hasMore: Number(result.rows[0]?.total_count ?? 0) > 200 };
  });

  app.get("/api/v1/source-rows", { config: permissionConfig("processes.read") }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, "INVALID_QUERY", "Revise a aba, os filtros de coluna ou a paginação.");
    const { sheet, importer, search, gap, page, pageSize, sortColumn, sortDirection } = parsed.data;
    const columnFilters = parseColumnFilters(parsed.data.filters, sheet, reply);
    if (!columnFilters) return;
    if ((sortColumn && !sortDirection) || (!sortColumn && sortDirection)
      || (sortColumn && !columnsForSheet(sheet).includes(sortColumn))) {
      return problem(reply, 400, "INVALID_SORT", "A coluna e a ordem da classificação são incompatíveis.");
    }
    const scopes = request.authorizationContext?.importerScopes ?? [];
    const preNoIp = `(${validIp("source.raw_values->>'AB'")}) IS NOT TRUE`;
    const postNoIp = `(${validIp("source.raw_values->>'B'")}) IS NOT TRUE`;
    const noIp = `(source.sheet_name = 'Pré Embarque' AND ${preNoIp}) OR (source.sheet_name = 'Pós Embarque' AND ${postNoIp})`;
    const noPo = `(source.sheet_name = 'Pré Embarque' AND NULLIF(btrim(source.raw_values->>'N'), '') IS NULL)`;
    const calculationError = `jsonb_array_length(source.error_columns) > 0`;
    const columnPredicate = columnFilterPredicate("$4");
    const sortExpression = sortColumn
      ? `CASE WHEN (source.raw_values->>'${sortColumn}') ~ '^-?[0-9]+(\\.[0-9]+)?$'
           THEN (source.raw_values->>'${sortColumn}')::numeric END ${sortDirection === "desc" ? "DESC" : "ASC"} NULLS LAST,
         lower(coalesce(source.raw_values->>'${sortColumn}', '')) ${sortDirection === "desc" ? "DESC" : "ASC"},`
      : "";
    const result = await pool.query<{
      total_count: number; rows_before_gap_filter: number; without_po: number; without_ip: number;
      cell_errors: number; any_gap: number; items: Array<Record<string, unknown>>;
    }>(
      `WITH visible AS MATERIALIZED (
         SELECT source.id, source.batch_id, source.sheet_name, source.row_number,
                source.raw_values, source.error_columns, btrim(source.raw_values->>'F') AS importer,
                po.id AS purchase_order_id, po.external_number AS po_number,
                process.id AS process_id, process.ip_number,
                (${noPo}) AS missing_po,
                (${noIp}) AS missing_ip,
                ${calculationError} AS has_calculation_error
         FROM migration.source_row AS source
         LEFT JOIN procurement.po_line_observation AS observation ON observation.source_row_id = source.id
         LEFT JOIN procurement.purchase_order AS po ON po.id = observation.purchase_order_id
         LEFT JOIN imports.import_process AS process
           ON process.normalized_ip_number = upper(btrim(CASE source.sheet_name
                WHEN 'Pré Embarque' THEN source.raw_values->>'AB'
                WHEN 'Pós Embarque' THEN source.raw_values->>'B' END))
          AND process.importer = btrim(source.raw_values->>'F')
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
            OR ($6::text = 'quality' AND source.has_calculation_error)
            OR ($6::text = 'any' AND (source.missing_ip OR source.missing_po OR source.has_calculation_error))
       ), page AS (
         SELECT * FROM gap_filtered AS source ORDER BY ${sortExpression} sheet_name, row_number, id LIMIT $7 OFFSET $8
       )
       SELECT (SELECT count(*)::int FROM gap_filtered) AS total_count,
              (SELECT count(*)::int FROM filtered) AS rows_before_gap_filter,
              (SELECT count(*) FILTER (WHERE missing_po)::int FROM filtered) AS without_po,
              (SELECT count(*) FILTER (WHERE missing_ip)::int FROM filtered) AS without_ip,
              (SELECT count(*) FILTER (WHERE jsonb_array_length(error_columns) > 0)::int FROM filtered) AS cell_errors,
              (SELECT count(*) FILTER (WHERE missing_ip OR missing_po OR has_calculation_error)::int FROM filtered) AS any_gap,
              coalesce(jsonb_agg(jsonb_build_object(
                'id', page.id, 'batchId', page.batch_id,
                'sourceSheetName', page.sheet_name, 'sourceRowNumber', page.row_number,
                'importer', page.importer, 'sourceValues', page.raw_values,
                'cellErrors', page.error_columns,
                'purchaseOrderId', page.purchase_order_id, 'poNumber', page.po_number,
                'processId', page.process_id, 'ipNumber', page.ip_number,
                'auditFlags', jsonb_build_object('withoutPurchaseOrder', page.missing_po,
                  'withoutValidIp', page.missing_ip,
                  'cellErrors', jsonb_array_length(page.error_columns), 'anyGap',
                  page.missing_ip OR page.missing_po OR page.has_calculation_error)
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
    const items = (result.rows[0]?.items ?? []) as Array<Record<string, unknown>>;
    return {
      page, pageSize, sheet, gap, totalCount: Number(result.rows[0]?.total_count ?? 0),
      rowsBeforeGapFilter: Number(result.rows[0]?.rows_before_gap_filter ?? 0),
      summary: { withoutPurchaseOrder: Number(result.rows[0]?.without_po ?? 0),
        withoutValidIp: Number(result.rows[0]?.without_ip ?? 0),
        cellErrors: Number(result.rows[0]?.cell_errors ?? 0),
        anyGap: Number(result.rows[0]?.any_gap ?? 0) },
      columns,
      columnHeaders,
      items: items.map(item => ({ ...item,
        sourceColumnHeaders: sourceColumnHeadersFor(String(item.sourceSheetName ?? "")),
      })),
    };
  });
}

export function sourceColumnHeadersFor(sheetName: string): Record<string, string> {
  // Sheet names in older imports may contain mojibake or omit accents. Normalize
  // those variants before choosing the matching header row.
  const normalizedName = sheetName
    .replaceAll("\u00c3\u00a9", "\u00e9")
    .replaceAll("\u00c3\u00b3", "\u00f3")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
  // Some historical rows carry a suffix/version in the sheet name. Keep the
  // matching tolerant so source fields from either worksheet retain labels.
  const headers = normalizedName.startsWith("pre embarque") ? preHeaders
    : normalizedName.startsWith("pos embarque") ? postHeaders : [];
  return Object.fromEntries(headers.map((header, index) => [excelColumnLabel(index + 2), header]));
}

function excelColumnLabel(value: number): string {
  let current = value;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + current % 26) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function validIp(expression: string): string {
  return `NULLIF(btrim(${expression}), '') IS NOT NULL AND upper(btrim(${expression})) NOT IN ('CANCELLED', 'CANCELED') AND left(btrim(${expression}), 1) <> '#'`;
}

function excelColumnNumber(label: string): number {
  return [...label].reduce((result, char) => result * 26 + char.charCodeAt(0) - 64, 0);
}
