import PDFDocument from "pdfkit";

/**
 * A rendered payslip's data — assembled by the statement service from a finalized
 * (PAID) PayrollRecord, its components and the employee/employer directory. Kept
 * self-contained so the renderer stays a pure function (record data in, PDF out).
 */
export interface PayslipData {
  employerName: string;
  employeeName: string;
  employeeCode: string | null;
  designation: string | null;
  period: { start: string; end: string; label: string };
  currencyCode: string;
  payDate: string | null;
  paymentRef: string | null; // already masked (e.g. ••••1234)
  earnings: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
  employerContribs: { name: string; amount: number }[];
  gross: number;
  totalDeductions: number;
  net: number;
  ytd?: { gross: number; deductions: number; net: number } | null;
  documentVersion: number;
  checksum: string;
}

const INK = "#15201d";
const MUTED = "#6b7c74";
const HAIR = "#d8e0dc";
const ACCENT = "#0b6b5f";
const PANEL = "#eef3f0";

/** Group Indian-style for INR, plain thousands otherwise; always 2dp. */
function fmtMoney(n: number, currency: string): string {
  const locale = currency === "INR" ? "en-IN" : "en-US";
  return n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Render a one-page A4 payslip PDF and resolve the complete Buffer. Uses only the
 * standard Helvetica family (no external font files), so it works in the container
 * with no assets. The currency is shown as its ISO code (the ₹ glyph is absent from
 * the standard PDF fonts), keeping amounts unambiguous and render-safe.
 */
export function renderPayslipPdf(data: PayslipData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Payslip ${data.period.label} — ${data.employeeName}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const money = (n: number) => fmtMoney(n, data.currencyCode);

    // ---- Header ----
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text(data.employerName, left, 48);
    doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(11).text("PAYSLIP", left, 72);
    doc.fillColor(MUTED).font("Helvetica").fontSize(9)
      .text(`Pay period: ${data.period.start} to ${data.period.end}  (${data.period.label})`, left, 88)
      .text(`Currency: ${data.currencyCode}${data.payDate ? `   ·   Pay date: ${data.payDate}` : ""}`, left, 100);
    doc.moveTo(left, 118).lineTo(right, 118).strokeColor(HAIR).lineWidth(1).stroke();

    // ---- Employee block ----
    let y = 132;
    const row = (label: string, value: string, x: number) => {
      doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(label.toUpperCase(), x, y);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(value || "—", x, y + 10);
    };
    row("Employee", data.employeeName, left);
    row("Employee code", data.employeeCode ?? "—", left + width * 0.38);
    row("Designation", data.designation ?? "—", left + width * 0.68);
    y += 34;
    if (data.paymentRef) {
      doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("PAYMENT REFERENCE", left, y);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(data.paymentRef, left, y + 10);
      y += 30;
    }

    // ---- Earnings / Deductions two-column table ----
    const colGap = 20;
    const colW = (width - colGap) / 2;
    const xE = left;
    const xD = left + colW + colGap;
    const tableTop = y + 6;

    const header = (x: string, title: string, px: number) => {
      doc.rect(px, tableTop, colW, 20).fill(PANEL);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text(title, px + 8, tableTop + 6);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text("Amount", px, tableTop + 6, { width: colW - 8, align: "right" });
      void x;
    };
    header("E", "Earnings", xE);
    header("D", "Deductions", xD);

    const lineRows = (rows: { name: string; amount: number }[], px: number) => {
      let ry = tableTop + 24;
      for (const r of rows) {
        doc.fillColor(INK).font("Helvetica").fontSize(9).text(r.name, px + 8, ry, { width: colW * 0.6 });
        doc.fillColor(INK).font("Helvetica").fontSize(9).text(money(r.amount), px, ry, { width: colW - 8, align: "right" });
        ry += 16;
      }
      return ry;
    };
    const endE = lineRows(data.earnings, xE);
    const endD = lineRows(data.deductions.length ? data.deductions : [{ name: "— none —", amount: 0 }], xD);
    const tableBottom = Math.max(endE, endD) + 4;

    // Column totals
    doc.moveTo(xE, tableBottom).lineTo(xE + colW, tableBottom).strokeColor(HAIR).stroke();
    doc.moveTo(xD, tableBottom).lineTo(xD + colW, tableBottom).strokeColor(HAIR).stroke();
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(9)
      .text("Gross earnings", xE + 8, tableBottom + 6)
      .text(money(data.gross), xE, tableBottom + 6, { width: colW - 8, align: "right" });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(9)
      .text("Total deductions", xD + 8, tableBottom + 6)
      .text(money(data.totalDeductions), xD, tableBottom + 6, { width: colW - 8, align: "right" });

    // ---- Net pay banner ----
    const netY = tableBottom + 34;
    doc.roundedRect(left, netY, width, 40, 6).fill(ACCENT);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11).text("NET PAY", left + 16, netY + 14);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(16).text(`${data.currencyCode} ${money(data.net)}`, left, netY + 11, { width: width - 16, align: "right" });

    let footY = netY + 58;

    // ---- Employer contributions (cost to company, not deducted) ----
    if (data.employerContribs.length) {
      doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("EMPLOYER CONTRIBUTIONS (not deducted from pay)", left, footY);
      footY += 12;
      for (const c of data.employerContribs) {
        doc.fillColor(INK).font("Helvetica").fontSize(9).text(c.name, left + 8, footY, { width: width * 0.6 });
        doc.fillColor(INK).font("Helvetica").fontSize(9).text(money(c.amount), left, footY, { width: width - 8, align: "right" });
        footY += 14;
      }
      footY += 6;
    }

    // ---- Year to date ----
    if (data.ytd) {
      doc.moveTo(left, footY).lineTo(right, footY).strokeColor(HAIR).stroke();
      footY += 8;
      doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("YEAR TO DATE", left, footY);
      footY += 12;
      const ytdCol = (label: string, val: number, x: number) => {
        doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(label, x, footY);
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(money(val), x, footY + 10);
      };
      ytdCol("Gross", data.ytd.gross, left);
      ytdCol("Deductions", data.ytd.deductions, left + width * 0.34);
      ytdCol("Net", data.ytd.net, left + width * 0.68);
      footY += 32;
    }

    // ---- Footer: integrity ----
    const fY = doc.page.height - doc.page.margins.bottom - 26;
    doc.moveTo(left, fY).lineTo(right, fY).strokeColor(HAIR).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(7)
      .text(`System-generated payslip · v${data.documentVersion} · integrity ${data.checksum.slice(0, 16)}…`, left, fY + 6)
      .text("Computer-generated; no signature required.", left, fY + 6, { width, align: "right" });

    doc.end();
  });
}
