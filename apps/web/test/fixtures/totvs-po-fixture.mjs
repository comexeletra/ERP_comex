import ExcelJS from "exceljs";

const headers = ["Item", "Produto", "Descricao", "UM", "Quantidade", "Valor Unitario", "Valor Total",
  "CC", "PC / AE", "CNPJ/CPF", "Codigo", "Razao Social", "Nro.SC"];

const defaultRows = [
  { item: "0001", productCode: 123, quantity: 2, unitPrice: 0.01, total: 10.12345678, costCenter: "1202027" },
  { item: "0002", productCode: "GADGET-RF.R120", quantity: 3, unitPrice: 0, total: 1.00000001, costCenter: "1202027" },
  { item: "0003", productCode: "HXAP1000R31044-CEMIG", quantity: 4, unitPrice: 99.99, total: 0, costCenter: "1202027" },
];

export async function makeTotvsPoFile({ rows = defaultRows, columnHeaders = headers } = {}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Pedido de Compras");
  worksheet.addRow(columnHeaders);
  for (const entry of rows) {
    if (entry.blank) {
      worksheet.addRow([]);
      continue;
    }
    const values = {
      Item: entry.item ?? "0001",
      Produto: entry.productCode ?? "SYNTHETIC-001",
      Descricao: entry.description ?? "Produto de teste sintético",
      UM: entry.unit ?? "UN",
      Quantidade: entry.quantity ?? 1,
      "Valor Unitario": entry.unitPrice ?? 0,
      "Valor Total": entry.total ?? 0,
      CC: entry.costCenter ?? "1202027",
      "PC / AE": entry.poNumber ?? "030201",
      "CNPJ/CPF": entry.cnpj ?? "12.345.678/0001-90",
      Codigo: entry.supplierCode ?? "EX000135",
      "Razao Social": entry.supplierName ?? "FORNECEDOR SINTÉTICO",
      "Nro.SC": entry.scNumber ?? "020028",
    };
    const row = worksheet.addRow(columnHeaders.map(header => values[header] ?? ""));
    if (typeof values.Produto === "number") row.getCell(columnHeaders.indexOf("Produto") + 1).numFmt = "0000000000";
  }
  return new File([Buffer.from(await workbook.xlsx.writeBuffer())], "PO-synthetic.xlsx");
}

export { headers as totvsPoHeaders };
