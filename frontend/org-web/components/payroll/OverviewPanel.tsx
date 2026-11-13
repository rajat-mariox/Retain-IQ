"use client";

import {
  AlertTriangle, ArrowRight, BadgeDollarSign, Building2, CalendarRange, CircleDollarSign,
  Clock, Landmark, PauseCircle, Receipt, TrendingDown, Users, Wallet, XCircle,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { LocalTime } from "@/components/ui/LocalTime";
import { formatDate } from "@/lib/format";
import type { PayoutDashboard } from "@/lib/api";
import { DistributionBar, EmployeeRef, EmptyState, PayoutStatusBadge, money } from "./payout-ui";

const AMBER = "#d97706";
const ROSE = "#e11d48";
const SLATE = "#64748b";

function shortRange(start: string, end: string): string {
  const s = formatDate(start).replace(/, \d{4}$/, "");
  const e = formatDate(end);
  return `${s} – ${e}`;
}

/**
 * §6 payout dashboard. Scoped, owner-excluded aggregates for the current period:
 * eligibility + money totals, attention counters (approvals / holds / failed
 * payments), status distributions, department cost and recent activity. Shows an
 * honest empty state when there's no payroll data yet.
 */
export function OverviewPanel({
  data,
  currency = "USD",
  onGoto,
}: {
  data: PayoutDashboard | null;
  currency?: string;
  onGoto?: (tab: string) => void;
}) {
  // Defensive: an unconfigured org (or a legacy-shaped payload) yields no period.
  const hasData = Boolean(data && (data.period || (data.eligibleEmployees ?? 0) > 0));
  if (!data || !hasData) {
    return (
      <Card>
        <EmptyState
          icon={<Wallet className="size-5" />}
          title="No payroll data yet"
          hint="Once a pay period and a batch exist for the employees you manage, this dashboard fills with gross, net, tax and payout status."
          action={
            onGoto ? (
              <button onClick={() => onGoto("batches")} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft">
                Go to batches <ArrowRight className="size-4" />
              </button>
            ) : null
          }
        />
      </Card>
    );
  }

  const t = data.totals ?? { gross: 0, deductions: 0, tax: 0, net: 0, employerCost: 0, employeeCount: 0 };
  const validationFailed = data.recordStatusDistribution?.VALIDATION_FAILED ?? 0;
  const toEntries = (m: Record<string, number> | undefined) =>
    Object.entries(m ?? {}).map(([label, count]) => ({ label, count })).filter((e) => e.count > 0);
  const batchDist = toEntries(data.batchStatusDistribution);
  const recordDist = toEntries(data.recordStatusDistribution);
  const paymentDist = toEntries(data.paymentStatusDistribution);

  return (
    <div className="space-y-6">
      {/* Context */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Users} label="Eligible employees" value={String(data.eligibleEmployees ?? 0)} hint="In your scope, excluding the owner" />
        <StatTile
          icon={CalendarRange}
          label="Current period"
          value={data.period ? shortRange(data.period.start, data.period.end) : "—"}
          hint={data.period ? data.period.status.replace(/_/g, " ").toLowerCase() : "no open period"}
        />
        <StatTile icon={Receipt} label="Employees in run" value={String(t.employeeCount ?? 0)} hint="Records calculated this period" />
        <StatTile icon={CircleDollarSign} label="Net payout" value={money(t.net, currency)} hint="Take-home this period" />
      </div>

      {/* Money */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={BadgeDollarSign} label="Gross earnings" value={money(t.gross, currency)} />
        <StatTile icon={TrendingDown} label="Deductions" value={money(t.deductions, currency)} accent={SLATE} />
        <StatTile icon={Landmark} label="Tax" value={money(t.tax, currency)} accent={SLATE} />
        <StatTile icon={Building2} label="Employer cost" value={money(t.employerCost, currency)} hint="Net + employer contributions" />
      </div>

      {/* Attention */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={Clock} label="Pending approvals" value={String(data.pendingApprovals ?? 0)} accent={AMBER} />
        <StatTile icon={PauseCircle} label="On hold" value={String(data.onHold ?? 0)} accent={AMBER} />
        <StatTile icon={XCircle} label="Failed payments" value={String(data.failedPayments ?? 0)} accent={ROSE} />
      </div>

      {validationFailed > 0 ? (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">
            <span className="font-medium">{validationFailed} record{validationFailed === 1 ? "" : "s"} failed validation.</span>{" "}
            These are usually missing pay profiles or negative net — fix them in the batch before submitting for approval.
          </span>
          {onGoto ? (
            <button onClick={() => onGoto("batches")} className="shrink-0 text-xs font-semibold text-amber-900 underline underline-offset-2">
              Review batches
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Distributions */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Batch status" subtitle="This period" />
          <CardBody>{batchDist.length ? <DistributionBar entries={batchDist} /> : <p className="text-xs text-slate-400">No batches yet.</p>}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Record status" subtitle="Across your scope" />
          <CardBody>{recordDist.length ? <DistributionBar entries={recordDist} /> : <p className="text-xs text-slate-400">No records yet.</p>}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Payment status" subtitle="Payouts" />
          <CardBody>{paymentDist.length ? <DistributionBar entries={paymentDist} /> : <p className="text-xs text-slate-400">No payments yet.</p>}</CardBody>
        </Card>
      </div>

      {/* Department cost + recent activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Cost by department" subtitle="Net & employer cost this period" />
          {data.departmentCost?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-slate-500">
                    <th className="px-5 py-3 text-left font-medium">Department</th>
                    <th className="px-5 py-3 text-right font-medium">People</th>
                    <th className="px-5 py-3 text-right font-medium">Net</th>
                    <th className="px-5 py-3 text-right font-medium">Employer cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.departmentCost.map((d) => (
                    <tr key={d.departmentId ?? d.department} className="border-b border-hairline/60 last:border-0">
                      <td className="px-5 py-3 font-medium text-slate-800">{d.department}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600">{d.headcount}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">{money(d.net, currency)}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-900">{money(d.employerCost, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <CardBody><p className="text-xs text-slate-400">No cost recorded yet.</p></CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="Latest record changes" />
          {data.recentActivity?.length ? (
            <ul className="divide-y divide-hairline/60">
              {data.recentActivity.map((a) => (
                <li key={a.recordId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{a.employeeName || <EmployeeRef id={a.employeeId} />}</p>
                    <p className="text-xs text-slate-400"><LocalTime iso={a.at} mode="datetime" /></p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <PayoutStatusBadge status={a.status} />
                    <span className="w-24 text-right tabular-nums text-sm font-medium text-slate-800">{money(a.net, currency)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody><p className="text-xs text-slate-400">Nothing has changed yet.</p></CardBody>
          )}
        </Card>
      </div>
    </div>
  );
}
