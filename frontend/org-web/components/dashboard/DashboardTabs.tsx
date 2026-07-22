"use client";

import { useState } from "react";
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Briefcase, CalendarOff, Gauge, HeartPulse, LogOut, Target, TrendingUp, UserCheck, UserPlus, Users } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { AttendanceBadge } from "@/components/ui/badges";
import { LocalTime } from "@/components/ui/LocalTime";
import { formatCompact } from "@/lib/format";
import type { AttendanceRoster, ExecutiveOverview } from "@/lib/api";

const PILLARS: { key: keyof ExecutiveOverview["health"]["pillars"]; label: string }[] = [
  { key: "productivity", label: "Productivity" },
  { key: "attendance", label: "Attendance" },
  { key: "engagement", label: "Engagement" },
  { key: "risk", label: "Risk" },
  { key: "burnout", label: "Burnout" },
];

const TABS = ["Workforce", "Productivity", "Attendance"] as const;
type Tab = (typeof TABS)[number];

function tone(v: number) {
  return v >= 75 ? "#16a34a" : v >= 55 ? "#d97706" : "#e5484d";
}

export function DashboardTabs({ exec, roster }: { exec: ExecutiveOverview; roster: AttendanceRoster | null }) {
  const [tab, setTab] = useState<Tab>("Workforce");
  const { workforce: w, health, attrition: a, productivity: p } = exec;
  const trendUp = a.trend === "improving";
  const trendDown = a.trend === "worsening";

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === t ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Workforce */}
      {tab === "Workforce" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Total employees" value={formatCompact(w.total)} icon={Users} accent="#1f883d" />
            <StatTile label="Active" value={formatCompact(w.active)} icon={UserCheck} accent="#16a34a" />
            <StatTile label="New joinees" value={formatCompact(w.newJoinees)} icon={UserPlus} accent="#0d9488" hint="last 30 days" />
            <StatTile label="On leave" value={formatCompact(w.onLeave)} icon={CalendarOff} accent="#0284c7" />
            <StatTile label="Notice period" value={formatCompact(w.noticePeriod)} icon={LogOut} accent="#d97706" />
            <StatTile label="Open positions" value={formatCompact(w.openPositions)} icon={Briefcase} accent="#64748b" />
          </div>
          <Card>
            <CardHeader title="Workforce health score" subtitle="Composite of productivity, attendance, engagement, risk & burnout" />
            <CardBody className="space-y-4">
              <div className="flex items-end gap-3">
                <span className="text-4xl font-semibold tabular-nums" style={{ color: tone(health.score) }}>{health.score}</span>
                <span className="pb-1 text-sm text-slate-400">/ 100</span>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {PILLARS.map((pl) => {
                  const v = health.pillars[pl.key];
                  return (
                    <div key={pl.key}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-slate-600">{pl.label}</span>
                        <span className="tabular-nums text-slate-500">{v}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: tone(v) }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* Productivity */}
      {tab === "Productivity" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatTile label="Company productivity" value={`${p.companyProductivity}%`} icon={Gauge} accent="#16a34a" />
            <StatTile label="Focus score" value={`${p.focusScore}%`} icon={Target} accent="#0d9488" />
            <StatTile label="Active hours (30d)" value={formatCompact(p.activeHours)} icon={Activity} accent="#166534" />
            <StatTile label="Utilization" value={`${p.utilization}%`} icon={HeartPulse} accent="#1f883d" />
          </div>
          <Card>
            <CardHeader
              title="Attrition overview"
              subtitle="Derived risk signals"
              action={
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${trendDown ? "bg-rose-50 text-rose-700 ring-rose-200" : trendUp ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-600 ring-slate-200"}`}>
                  {trendDown ? <ArrowDownRight className="size-3" /> : trendUp ? <ArrowUpRight className="size-3" /> : <TrendingUp className="size-3" />}
                  {a.trend}
                </span>
              }
            />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <RiskCard label="High risk" value={a.high} tone="text-amber-700 bg-amber-50 ring-amber-200" />
                <RiskCard label="Medium risk" value={a.medium} tone="text-sky-700 bg-sky-50 ring-sky-200" />
                <RiskCard label="Critical risk" value={a.critical} tone="text-rose-700 bg-rose-50 ring-rose-200" />
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <AlertTriangle className="size-3.5 text-slate-400" />
                {a.atRiskPct}% of tracked employees flagged at risk · productivity trend {a.trendDelta >= 0 ? "+" : ""}{a.trendDelta} over 15 days
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* Attendance (all employees) */}
      {tab === "Attendance" ? (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Attendance overview" subtitle={roster ? `${roster.summary.total} employees · today` : "Today"} />
            <div className="grid grid-cols-2 divide-x divide-y divide-hairline/70 sm:grid-cols-5 sm:divide-y-0">
              <TeamStat label="Present" value={roster?.summary.present ?? 0} cls="text-emerald-700" />
              <TeamStat label="Late" value={roster?.summary.late ?? 0} cls="text-amber-700" />
              <TeamStat label="Absent" value={roster?.summary.absent ?? 0} cls="text-rose-700" />
              <TeamStat label="On leave" value={roster?.summary.onLeave ?? 0} cls="text-sky-700" />
              <TeamStat label="Attendance rate" value={`${roster?.summary.attendanceRate ?? 0}%`} cls="text-slate-800" />
            </div>
          </Card>
          <Card>
            <CardHeader title="All employees" subtitle="Today's attendance across your organization" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-slate-500">
                    <th className="px-5 py-3 text-left font-medium">Employee</th>
                    <th className="px-5 py-3 text-left font-medium">Department</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">In</th>
                    <th className="px-5 py-3 text-right font-medium">Out</th>
                    <th className="px-5 py-3 text-right font-medium">Worked</th>
                  </tr>
                </thead>
                <tbody>
                  {(roster?.rows ?? []).map((r) => (
                    <tr key={r.employeeId} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-900">{r.name}</td>
                      <td className="px-5 py-3 text-slate-600">{r.department ?? "—"}</td>
                      <td className="px-5 py-3"><AttendanceBadge status={r.status} /></td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600"><LocalTime iso={r.checkInAt} /></td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600"><LocalTime iso={r.checkOutAt} /></td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.workMinutes > 0 ? `${Math.floor(r.workMinutes / 60)}h ${r.workMinutes % 60}m` : "—"}</td>
                    </tr>
                  ))}
                  {(roster?.rows ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">No employees to show.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function RiskCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl px-3 py-3 text-center ring-1 ring-inset ${tone}`}>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs font-medium opacity-80">{label}</p>
    </div>
  );
}

function TeamStat({ label, value, cls }: { label: string; value: number | string; cls: string }) {
  return (
    <div className="px-5 py-5">
      <p className={`text-2xl font-semibold tabular-nums ${cls}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}
