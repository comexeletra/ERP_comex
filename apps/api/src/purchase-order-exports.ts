import type { Pool } from "pg";

export type PurchaseOrderExportFilters = {
  number?: string;
  importer?: string;
  product?: string;
  ipNumber?: string;
};

export type PurchaseOrderExportRow = {
  id: string;
  number: string;
  importer: string;
  itemCount: number;
  linkedProcessCount: number;
  itemsWithIp: number;
  itemsWithoutIp: number;
  unresolvedIssueCount: number;
};

export async function queryPurchaseOrderExport(
  pool: Pool,
  importerScopes: readonly string[],
  filters: PurchaseOrderExportFilters,
): Promise<{ totalCount: number; rows: PurchaseOrderExportRow[] }> {
  const result = await pool.query<{
    total_count: number;
    id: string;
    number: string;
    importer: string;
    item_count: number;
    linked_process_count: number;
    items_with_ip: number;
    items_without_ip: number;
    unresolved_issue_count: number;
  }>(
    `SELECT count(*) OVER ()::int AS total_count,
            po.id, po.external_number AS number, po.importer,
            (SELECT count(*)::int FROM procurement.purchase_order_item AS item
             WHERE item.purchase_order_id = po.id) AS item_count,
            (SELECT count(*)::int FROM procurement.process_purchase_order AS link
             JOIN imports.import_process AS process ON process.id = link.process_id
             WHERE link.purchase_order_id = po.id AND process.importer = ANY($1::text[]))
              AS linked_process_count,
            (SELECT count(*)::int FROM procurement.purchase_order_item AS item
             WHERE item.purchase_order_id = po.id
               AND upper(coalesce(item.source_status, '')) NOT IN ('CANCELLED', 'CANCELED')
               AND EXISTS (SELECT 1 FROM procurement.po_item_allocation AS allocation
                           WHERE allocation.purchase_order_item_id = item.id
                             AND allocation.status = 'ACTIVE')) AS items_with_ip,
            (SELECT count(*)::int FROM procurement.purchase_order_item AS item
             WHERE item.purchase_order_id = po.id
               AND upper(coalesce(item.source_status, '')) NOT IN ('CANCELLED', 'CANCELED')
               AND NOT EXISTS (SELECT 1 FROM procurement.po_item_allocation AS allocation
                               WHERE allocation.purchase_order_item_id = item.id
                                 AND allocation.status = 'ACTIVE')) AS items_without_ip,
            (SELECT count(DISTINCT issue.id)::int
             FROM migration.data_issue AS issue
             JOIN procurement.po_line_observation AS observation
               ON observation.source_row_id = issue.source_row_id
             WHERE observation.purchase_order_id = po.id AND issue.status = 'OPEN')
              AS unresolved_issue_count
     FROM procurement.purchase_order AS po
     WHERE po.importer = ANY($1::text[])
       AND ($2::text IS NULL OR strpos(po.normalized_number, upper($2)) > 0)
       AND ($3::text IS NULL OR strpos(lower(po.importer), lower($3)) > 0)
       AND ($4::text IS NULL OR EXISTS (
         SELECT 1 FROM procurement.po_line_observation AS observation
         WHERE observation.purchase_order_id = po.id
           AND (strpos(lower(coalesce(observation.product_code_snapshot, '')), lower($4)) > 0
             OR strpos(lower(coalesce(observation.description_snapshot, '')), lower($4)) > 0)
       ) OR EXISTS (
         SELECT 1 FROM procurement.purchase_order_item AS item
         WHERE item.purchase_order_id = po.id
           AND (strpos(lower(item.product_code), lower($4)) > 0
             OR strpos(lower(item.description), lower($4)) > 0)
       ))
       AND ($5::text IS NULL OR EXISTS (
         SELECT 1 FROM procurement.process_purchase_order AS link
         JOIN imports.import_process AS process ON process.id = link.process_id
         WHERE link.purchase_order_id = po.id
           AND process.importer = ANY($1::text[])
           AND strpos(lower(process.ip_number), lower($5)) > 0
       ))
     ORDER BY po.normalized_number, po.id
     LIMIT 5001`,
    [importerScopes, filters.number || null, filters.importer || null,
      filters.product || null, filters.ipNumber || null],
  );

  return {
    totalCount: Number(result.rows[0]?.total_count ?? 0),
    rows: result.rows.map(row => ({
      id: row.id,
      number: row.number,
      importer: row.importer,
      itemCount: Number(row.item_count),
      linkedProcessCount: Number(row.linked_process_count),
      itemsWithIp: Number(row.items_with_ip),
      itemsWithoutIp: Number(row.items_without_ip),
      unresolvedIssueCount: Number(row.unresolved_issue_count),
    })),
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  const literal = /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${literal.replaceAll('"', '""')}"`;
}

export function purchaseOrderExportCsv(rows: readonly PurchaseOrderExportRow[]): string {
  const headers = ["ID", "PO TOTVS", "Importador", "Itens", "IPs vinculados",
    "Itens com IP", "Itens sem IP", "Pendências abertas"];
  const lines = rows.map(row => [row.id, row.number, row.importer, row.itemCount,
    row.linkedProcessCount, row.itemsWithIp, row.itemsWithoutIp, row.unresolvedIssueCount]);
  return `\uFEFF${[headers, ...lines].map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
