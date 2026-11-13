/**
 * Client-side report downloads. `downloadCsv` and `downloadXlsx` take the same
 * row objects and produce a file the browser saves. The Excel output is
 * SpreadsheetML (XML Spreadsheet 2003) — dependency-free, opens natively in Excel
 * and Google Sheets, with a styled header row and numeric cells kept as numbers.
 */

function trigger(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\r\n");
  trigger(new Blob([csv], { type: "text/csv;charset=utf-8;" }), filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

const xmlEsc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] ?? c);

export function downloadXlsx(filename: string, sheetName: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const cell = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v)
      ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
      : `<Cell><Data ss:Type="String">${xmlEsc(v === null || v === undefined ? "" : String(v))}</Data></Cell>`;
  const headerRow = `<Row ss:StyleID="hdr">${headers.map((h) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${xmlEsc(h)}</Data></Cell>`).join("")}</Row>`;
  const body = rows.map((r) => `<Row>${headers.map((h) => cell(r[h])).join("")}</Row>`).join("");
  const xml =
    `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n` +
    `<Styles><Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#EFF2F7" ss:Pattern="Solid"/></Style></Styles>\n` +
    `<Worksheet ss:Name="${xmlEsc((sheetName || "Report").slice(0, 31))}"><Table>${headerRow}${body}</Table>` +
    `<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions></Worksheet>\n</Workbook>`;
  const name = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  trigger(new Blob([xml], { type: "application/vnd.ms-excel" }), name);
}
