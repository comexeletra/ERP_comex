export type ExportPurchaseOrder = {
  id: string;
  number: string;
  importer: string;
  identityStatus: string;
  historicalItemCount: number;
  linkedProcessCount: number;
  historicalItemsWithIp: number;
  historicalItemsWithoutIp: number;
  unresolvedIssueCount: number;
};

function csvCell(value: string | number): string {
  const text = String(value);
  // Excel interprets values beginning with these characters as formulas, even
  // when the CSV field is quoted. Preserve the visible text as literal data.
  const literal = /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${literal.replaceAll('"', '""')}"`;
}

export function purchaseOrdersCsv(orders: readonly ExportPurchaseOrder[]): string {
  const headers = ["ID", "PO TOTVS", "Importador", "Estado da identidade",
    "Observações históricas", "IPs vinculados", "Linhas com IP", "Linhas sem IP", "Pendências abertas"];
  const lines = orders.map(order => [order.id, order.number, order.importer, order.identityStatus,
    order.historicalItemCount, order.linkedProcessCount, order.historicalItemsWithIp,
    order.historicalItemsWithoutIp, order.unresolvedIssueCount]);
  return [headers, ...lines].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
