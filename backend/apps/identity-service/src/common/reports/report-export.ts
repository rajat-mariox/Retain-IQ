/**
 * Shared report-export helpers. A report is a simple { columns, rows } table;
 * these render it to CSV or a native Excel workbook. Every domain's export
 * (attendance, payroll, projects, …) goes through this, so formatting/escaping
 * stay consistent and we don't reimplement CSV/xlsx per module.
 *
 * The Excel output uses the SpreadsheetML (XML Spreadsheet 2003) format — a plain
 * XML workbook Excel/Sheets open natively, with typed cells (numbers vs text) and
 * a styled header row. It's dependency-free (no exceljs/zip), which matters here
 * because the build environment has no package registry access.
 */

export type Cell = string | number | null | undefined;
export interface ReportTable {
  columns: string[];
  rows: Cell[][];
}

/** RFC-4180-ish CSV: quote every field, double inner quotes, CRLF rows. */
export function toCsv(table: ReportTable): string {
  const esc = (v: Cell) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [table.columns.map(esc).join(",")];
  for (const r of table.rows) lines.push(r.map(esc).join(","));
  return lines.join("\r\n");
}

const xmlEsc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] ?? c);

/** A cell as SpreadsheetML — Number type for finite numbers, String otherwise. */
function cellXml(v: Cell): string {
  if (typeof v === "number" && Number.isFinite(v)) return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
  const s = v === null || v === undefined ? "" : String(v);
  return `<Cell><Data ss:Type="String">${xmlEsc(s)}</Data></Cell>`;
}

/**
 * A single-sheet SpreadsheetML workbook as a Buffer. Header row is bold on a
 * light fill and frozen. Opens natively in Excel and Google Sheets.
 */
export function toXlsx(sheetName: string, table: ReportTable): Buffer {
  const name = xmlEsc((sheetName || "Report").slice(0, 31));
  const header = `<Row ss:StyleID="hdr">${table.columns.map((c) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${xmlEsc(c)}</Data></Cell>`).join("")}</Row>`;
  const body = table.rows.map((r) => `<Row>${r.map(cellXml).join("")}</Row>`).join("");
  const xml =
    `<?xml version="1.0"?>\n` +
    `<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n` +
    `<Styles><Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#EFF2F7" ss:Pattern="Solid"/></Style></Styles>\n` +
    `<Worksheet ss:Name="${name}">\n` +
    `<Table>${header}${body}</Table>\n` +
    `<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>\n` +
    `</Worksheet>\n</Workbook>`;
  return Buffer.from(xml, "utf8");
}

/** MIME + a safe download filename for a given format. */
export function exportMeta(baseName: string, format: "csv" | "xlsx") {
  const safe = baseName.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "");
  return format === "xlsx"
    ? { filename: `${safe}.xls`, contentType: "application/vnd.ms-excel" }
    : { filename: `${safe}.csv`, contentType: "text/csv; charset=utf-8" };
}
