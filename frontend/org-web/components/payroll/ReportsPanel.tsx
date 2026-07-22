"use client";

import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { PayrollReport } from "@/lib/api";

const fmtHours = (m: number) => `${(m / 60).toFixed(1)}h`;
const money = (c: number, cur = "USD") =>
  `${cur === "USD" ? "$" : ""}${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
  LOCKED: "bg-amber-50 text-amber-700 ring-amber-200",
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

const EXPORTS: { kind: string; label: string; hint: string }[] = [
  { kind: "payroll", label: "Payroll", hint: "Per-employee pay, rates, overtime" },
  { kind: "timesheets", label: "Timesheets", hint: "Weekly sheets & approval status" },
  { kind: "billable", label: "Billable hours", hint: "Every entry with project & client" },
  { kind: "invoices", label: "Invoices", hint: "Invoice lines with rates & totals" },
];

/** Spec §6 (reports) + §8 (export center). */
export function ReportsPanel({ report }: { report: PayrollReport | null }) {
  const [range, setRange] = useState({ from: report?.from ?? "", to: report?.to ?? "" });

  // A plain link, not fetch(): the browser handles the download and the
  // Content-Disposition filename, which a blob round-trip would lose.
  const href = (kind: string) => `/api/payroll/export?kind=${kind}&from=${range.from}&to=${range.to}`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Export center" subtitle="Download as CSV — opens in Excel, Sheets or your accounting tool" />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">From</label>
              <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm text-slate-900 focus:border-brand focus:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">To</label>
              <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm text-slate-900 focus:border-brand focus:outline-none" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {EXPORTS.map((e) => (
              <a
                key={e.kind}
                href={href(e.kind)}
                className="group flex items-start gap-3 rounded-xl border border-hairline bg-panel p-3 transition-colors hover:border-brand/40 hover:bg-slate-50"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><FileSpreadsheet className="size-4" /></span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-sm font-medium text-slate-800">{e.label} <Download className="size-3 opacity-0 transition-opacity group-hover:opacity-60" /></span>
                  <span className="block text-xs text-slate-400">{e.hint}</span>
                </span>
              </a>
            ))}
          </div>
        </CardBody>
      </Card>

      {report ? (
        <>
          <Card>
            <CardHeader title="Payroll by employee" subtitle={`${report.from} → ${report.to} · ${report.totals.cycleCount} cycle${report.totals.cycleCount === 1 ? "" : "s"}`} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-slate-500">
                    <th className="px-5 py-3 text-left font-medium">Employee</th>
                    <th className="px-5 py-3 text-right font-medium">Cycles</th>
                    <th className="px-5 py-3 text-right font-medium">Regular</th>
                    <th className="px-5 py-3 text-right font-medium">Overtime</th>
                    <th className="px-5 py-3 text-right font-medium">Gross pay</th>
                  </tr>
                </thead>
                <tbody>
                  {report.employees.map((e) => (
                    <tr key={e.employeeId} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-900">{e.employeeName}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-500">{e.cycles}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600">{fmtHours(e.regularMinutes)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600">{e.overtimeMinutes ? fmtHours(e.overtimeMinutes) : "—"}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-900">{money(e.grossPayCents, report.currency)}</td>
                    </tr>
                  ))}
                  {report.employees.length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No payroll in this range.</td></tr>
                  ) : null}
                </tbody>
                {report.employees.length ? (
                  <tfoot>
                    <tr className="border-t border-hairline">
                      <td className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Total</td>
                      <td />
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">{fmtHours(report.totals.regularMinutes)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">{fmtHours(report.totals.overtimeMinutes)}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold text-slate-900">{money(report.totals.grossPayCents, report.currency)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Payroll history" subtitle="Every cycle in range" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-slate-500">
                    <th className="px-5 py-3 text-left font-medium">Period</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">Employees</th>
                    <th className="px-5 py-3 text-right font-medium">Overtime</th>
                    <th className="px-5 py-3 text-right font-medium">Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {report.history.map((c) => (
                    <tr key={c.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3 tabular-nums text-slate-700">{c.periodStart} → {c.periodEnd}</td>
                      <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS[c.status] ?? STATUS.DRAFT}`}>{c.status.toLowerCase()}</span></td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-500">{c.employeeCount}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600">{c.overtimeMinutes ? fmtHours(c.overtimeMinutes) : "—"}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-800">{money(c.grossPayCents, report.currency)}</td>
                    </tr>
                  ))}
                  {report.history.length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No cycles in this range.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
