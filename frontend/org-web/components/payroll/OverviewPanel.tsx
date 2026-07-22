"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Receipt, TrendingUp, Users, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import type { PayrollDashboard } from "@/lib/api";

const fmtHours = (m: number) => `${(m / 60).toFixed(1)}h`;
const money = (c: number, cur = "USD") =>
  `${cur === "USD" ? "$" : ""}${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const STATUS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
  LOCKED: "bg-amber-50 text-amber-700 ring-amber-200",
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

/** Spec §1 — the Payroll & Timesheets dashboard. */
export function OverviewPanel({ data, onGoto }: { data: PayrollDashboard; onGoto: (tab: "cycles" | "invoices") => void }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Users} label="Employees" value={String(data.employeeCount)} />
        <StatTile icon={Clock} label="Pending timesheets" value={String(data.pendingTimesheets)} />
        <StatTile icon={CheckCircle2} label="Approved timesheets" value={String(data.approvedTimesheets)} />
        <StatTile icon={TrendingUp} label={`Utilization · ${data.month}`} value={`${data.utilization}%`} />
      </div>

      {data.missingRates > 0 ? (
        <div className="flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium">{data.missingRates} employee{data.missingRates === 1 ? " has" : "s have"} tracked hours but no cost rate.</span>{" "}
            They will be skipped by payroll until a rate is set in Settings.
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Hours this month" subtitle={`Work vs billable · ${data.month}`} />
          <CardBody className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-slate-500">Total work</span>
              <span className="text-lg font-semibold tabular-nums text-slate-900">{fmtHours(data.totalWorkMinutes)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-slate-500">Billable</span>
              <span className="text-lg font-semibold tabular-nums text-emerald-700">{fmtHours(data.totalBillableMinutes)}</span>
            </div>
            <span className="flex h-2 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full bg-brand" style={{ width: `${data.utilization}%` }} />
            </span>
            <p className="text-xs text-slate-400">{data.utilization}% of tracked time is billable.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Payroll" subtitle="Latest cycle & what's next" />
          <CardBody className="space-y-3">
            {data.payroll.lastCycle ? (
              <button onClick={() => onGoto("cycles")} className="flex w-full items-center justify-between rounded-lg bg-panel-2 px-3 py-2.5 text-left hover:bg-slate-100">
                <span>
                  <span className="block text-sm font-medium text-slate-800">{data.payroll.lastCycle.periodStart} → {data.payroll.lastCycle.periodEnd}</span>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS[data.payroll.lastCycle.status] ?? STATUS.DRAFT}`}>
                    {data.payroll.lastCycle.status.toLowerCase()}
                  </span>
                </span>
                <span className="text-lg font-semibold tabular-nums text-slate-900">{money(data.payroll.lastCycle.grossPayCents, data.currency)}</span>
              </button>
            ) : (
              <p className="rounded-lg bg-panel-2 px-3 py-4 text-center text-sm text-slate-500">No payroll has been run yet.</p>
            )}
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <CalendarClock className="size-3.5" />
              Next cycle starts {data.payroll.upcoming.periodStart} · {data.payroll.upcoming.frequency.toLowerCase()}
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Receipt} label="Draft invoices" value={String(data.invoices.draft)} />
        <StatTile icon={Wallet} label="Sent" value={String(data.invoices.sent)} />
        <StatTile icon={Clock} label="Outstanding" value={money(data.invoices.outstandingCents, data.currency)} />
        <StatTile icon={CheckCircle2} label="Collected" value={money(data.invoices.collectedCents, data.currency)} />
      </div>

      {data.payroll.recent.length > 1 ? (
        <Card>
          <CardHeader title="Recent cycles" subtitle="Last six payroll periods" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Period</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Gross</th>
                </tr>
              </thead>
              <tbody>
                {data.payroll.recent.map((c) => (
                  <tr key={c.id} className="border-b border-hairline/60 last:border-0">
                    <td className="px-5 py-3 tabular-nums text-slate-700">{c.periodStart} → {c.periodEnd}</td>
                    <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS[c.status] ?? STATUS.DRAFT}`}>{c.status.toLowerCase()}</span></td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-800">{money(c.grossPayCents, data.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
