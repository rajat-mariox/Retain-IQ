/**
 * Dependency-free "Save as PDF": opens a clean, print-optimized HTML document in
 * a new window and triggers the browser's print dialog, where the user picks
 * "Save as PDF". This is how many SaaS products produce payslips/invoices — a
 * real, professional PDF via the browser's print engine, no server-side PDF lib.
 */

export interface PrintField { label: string; value: string }
export interface PrintLine { cells: string[]; strong?: boolean }

export interface PrintDoc {
  title: string; // browser/PDF title
  heading: string; // big heading on the document
  reference?: string; // e.g. invoice number / payslip period
  org?: string; // issuing org name
  meta?: PrintField[]; // key/value block (top-right)
  parties?: { label: string; lines: string[] }[]; // e.g. "Billed to"
  columns?: string[]; // table header
  rows?: PrintLine[]; // table body
  totals?: PrintField[]; // totals block (bottom-right)
  note?: string;
}

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

export function printDocument(doc: PrintDoc) {
  const meta = (doc.meta ?? []).map((f) => `<div><span class="k">${esc(f.label)}</span><span class="v">${esc(f.value)}</span></div>`).join("");
  const parties = (doc.parties ?? [])
    .map((p) => `<div class="party"><div class="plabel">${esc(p.label)}</div>${p.lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>`)
    .join("");
  const thead = doc.columns ? `<thead><tr>${doc.columns.map((c, i) => `<th class="${i === 0 ? "l" : "r"}">${esc(c)}</th>`).join("")}</tr></thead>` : "";
  const tbody = (doc.rows ?? [])
    .map((r) => `<tr>${r.cells.map((c, i) => `<td class="${i === 0 ? "l" : "r"}${r.strong ? " strong" : ""}">${esc(c)}</td>`).join("")}</tr>`)
    .join("");
  const table = doc.columns ? `<table>${thead}<tbody>${tbody}</tbody></table>` : "";
  const totals = (doc.totals ?? []).map((t) => `<div class="trow"><span class="tk">${esc(t.label)}</span><span class="tv">${esc(t.value)}</span></div>`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; margin: 0; padding: 40px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 16px; }
  .brand { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #4f46e5; font-weight: 700; }
  h1 { font-size: 22px; margin: 6px 0 2px; }
  .ref { color: #64748b; font-size: 13px; }
  .meta { text-align: right; font-size: 12px; color: #475569; }
  .meta .k { display: inline-block; min-width: 90px; color: #94a3b8; }
  .meta .v { font-weight: 600; color: #0f172a; }
  .parties { display: flex; gap: 40px; margin: 24px 0; }
  .plabel { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; border-bottom: 1px solid #cbd5e1; padding: 8px 10px; }
  td { padding: 8px 10px; border-bottom: 1px solid #eef2f7; }
  .r { text-align: right; } .l { text-align: left; }
  .strong { font-weight: 600; }
  .totals { margin: 16px 0 0 auto; width: 280px; }
  .trow { display: flex; justify-content: space-between; padding: 6px 10px; }
  .trow:last-child { border-top: 2px solid #0f172a; font-weight: 700; font-size: 15px; }
  .tk { color: #475569; } .tv { font-variant-numeric: tabular-nums; }
  .note { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; }
  @media print { body { padding: 24px; } @page { margin: 16mm; } }
</style></head><body>
  <div class="top">
    <div>
      ${doc.org ? `<div class="brand">${esc(doc.org)}</div>` : `<div class="brand">RetainIQ</div>`}
      <h1>${esc(doc.heading)}</h1>
      ${doc.reference ? `<div class="ref">${esc(doc.reference)}</div>` : ""}
    </div>
    <div class="meta">${meta}</div>
  </div>
  ${parties ? `<div class="parties">${parties}</div>` : ""}
  ${table}
  ${totals ? `<div class="totals">${totals}</div>` : ""}
  ${doc.note ? `<div class="note">${esc(doc.note)}</div>` : ""}
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 200); };</script>
</body></html>`;

  const win = window.open("", "_blank", "width=800,height=1000");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
