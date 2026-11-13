"use client";

import { useState } from "react";
import { BarChart3, GraduationCap, ShieldAlert } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import type { HrAnalyticsOverview, HrDist, TalentRisk } from "@/lib/api";

type Tab = "workforce" | "performance" | "risk";

const RISK_TINT: Record<string, string> = {
  healthy: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  elevated: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  critical: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
};
const btn = "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors";

function pill(map: Record<string, string>, k: string) {
  return cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", map[k] ?? "bg-panel-2 text-slate-600 ring-hairline");
}
function Tile({ k, v, sub }: { k: string; v: string | number; sub?: string }) {
  return (
    <Card>
      <CardBody className="p-4">
        <p className="text-xs text-slate-500">{k}</p>
        <p className="mt-1 truncate text-2xl font-semibold text-slate-900">{v}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
      </CardBody>
    </Card>
  );
}

/** Horizontal labelled bars for a distribution. */
function BarList({ items, tint = "bg-slate-900", empty = "No data" }: { items: HrDist[]; tint?: string; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (items.length === 0) return <p className="py-3 text-center text-xs text-slate-400">{empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={i.name} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-xs text-slate-600" title={i.name}>{i.name}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
            <div className={cn("h-full rounded-full", tint)} style={{ width: `${(i.count / max) * 100}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right text-xs font-medium text-slate-700">{i.count}</span>
        </div>
      ))}
    </div>
  );
}

export function HrAnalyticsWorkspace({ overview, risk }: { overview: HrAnalyticsOverview; risk: TalentRisk }) {
  const [tab, setTab] = useState<Tab>("workforce");
  const tenureYears = (overview.tenure.avgMonths / 12).toFixed(1);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile k="Headcount" v={overview.headcount.current} sub="active employees" />
        <Tile k="Attrition (12m)" v={`${overview.attrition.ratePct}%`} sub={`${overview.attrition.exits12m} exits`} />
        <Tile k="Avg tenure" v={`${tenureYears} yrs`} sub={`${overview.tenure.avgMonths} months`} />
        <Tile k="At-risk depts" v={risk.summary.atRiskDepartments} sub={`${risk.summary.burnoutPct}% burnout signal`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ["workforce", "Workforce", BarChart3],
          ["performance", "Performance & Onboarding", GraduationCap],
          ["risk", "Talent Risk", ShieldAlert],
        ] as const).map(([key, text, Icon]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={cn(btn, tab === key ? "border-slate-900 bg-slate-900 text-white" : "border-hairline bg-panel text-slate-600 hover:bg-panel-2")}>
            <Icon className="size-3.5" /> {text}
          </button>
        ))}
      </div>

      {tab === "workforce" && <WorkforceTab overview={overview} />}
      {tab === "performance" && <PerformanceTab overview={overview} />}
      {tab === "risk" && <RiskTab risk={risk} />}
    </div>
  );
}

/* ------------------------------ Workforce ------------------------------ */
function WorkforceTab({ overview }: { overview: HrAnalyticsOverview }) {
  const series = overview.headcount.series;
  const maxHc = Math.max(1, ...series.map((s) => s.headcount));
  const lifecycle = [
    { label: "Onboarding", count: overview.lifecycle.onboarding, tint: "bg-sky-500" },
    { label: "Probation", count: overview.lifecycle.probation, tint: "bg-amber-500" },
    { label: "Confirmed", count: overview.lifecycle.confirmed, tint: "bg-emerald-500" },
    { label: "Exited", count: overview.lifecycle.exited, tint: "bg-slate-400" },
  ];
  const maxLc = Math.max(1, ...lifecycle.map((l) => l.count));
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Headcount & growth" subtitle="Net active headcount with joins vs exits, last 12 months" />
        <CardBody className="overflow-x-auto">
          <div className="flex min-w-[640px] items-end gap-2" style={{ height: 180 }}>
            {series.map((s) => (
              <div key={s.month} className="flex flex-1 flex-col items-center justify-end gap-1">
                <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 140 }}>
                  <div className="w-1/3 rounded-t bg-slate-900" style={{ height: `${(s.headcount / maxHc) * 100}%` }} title={`Headcount ${s.headcount}`} />
                  <div className="w-1/4 rounded-t bg-emerald-400" style={{ height: `${(s.joins / maxHc) * 100}%` }} title={`Joins ${s.joins}`} />
                  <div className="w-1/4 rounded-t bg-rose-400" style={{ height: `${(s.exits / maxHc) * 100}%` }} title={`Exits ${s.exits}`} />
                </div>
                <span className="text-[10px] text-slate-400">{s.month}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-slate-900" /> Headcount</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-emerald-400" /> Joins</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-rose-400" /> Exits</span>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Tenure distribution" subtitle={`Avg ${overview.tenure.avgMonths} months`} />
          <CardBody><BarList items={overview.tenure.buckets.map((b) => ({ name: b.label, count: b.count }))} tint="bg-violet-500" /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Lifecycle funnel" subtitle="Employees by lifecycle stage" />
          <CardBody>
            <div className="space-y-2">
              {lifecycle.map((l) => (
                <div key={l.label} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-slate-600">{l.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2"><div className={cn("h-full rounded-full", l.tint)} style={{ width: `${(l.count / maxLc) * 100}%` }} /></div>
                  <span className="w-8 shrink-0 text-right text-xs font-medium text-slate-700">{l.count}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="By department" />
          <CardBody><BarList items={overview.distribution.byDepartment} tint="bg-sky-500" /></CardBody>
        </Card>
        <Card>
          <CardHeader title="By team" />
          <CardBody><BarList items={overview.distribution.byTeam} tint="bg-teal-500" /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Employment type" />
          <CardBody><BarList items={overview.distribution.byEmploymentType} tint="bg-amber-500" /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Gender diversity" />
          <CardBody><BarList items={overview.distribution.byGender} tint="bg-fuchsia-500" /></CardBody>
        </Card>
      </div>
    </div>
  );
}

/* --------------------------- Performance/Onb --------------------------- */
function PerformanceTab({ overview }: { overview: HrAnalyticsOverview }) {
  const { performance, onboarding } = overview;
  const maxR = Math.max(1, ...performance.distribution.map((d) => d.count));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Rating distribution" subtitle={performance.avgRating != null ? `Avg ${performance.avgRating}★ across ${performance.rated} reviews` : "No rated reviews yet"} />
          <CardBody>
            {performance.rated === 0 ? (
              <p className="py-3 text-center text-xs text-slate-400">No rated reviews yet.</p>
            ) : (
              <div className="space-y-2">
                {[...performance.distribution].reverse().map((d) => (
                  <div key={d.rating} className="flex items-center gap-3">
                    <span className="w-10 shrink-0 text-xs text-amber-500">{"★".repeat(d.rating)}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2"><div className="h-full rounded-full bg-amber-500" style={{ width: `${(d.count / maxR) * 100}%` }} /></div>
                    <span className="w-8 shrink-0 text-right text-xs font-medium text-slate-700">{d.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Average rating by department" />
          <CardBody>
            {performance.byDepartment.length === 0 ? (
              <p className="py-3 text-center text-xs text-slate-400">No data.</p>
            ) : (
              <div className="space-y-2">
                {performance.byDepartment.map((d) => (
                  <div key={d.name} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 truncate text-xs text-slate-600" title={d.name}>{d.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${(d.avg / 5) * 100}%` }} /></div>
                    <span className="w-14 shrink-0 text-right text-xs font-medium text-slate-700">{d.avg}★ ({d.rated})</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Onboarding completion" subtitle="New-hire journey progress" />
        <CardBody>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><p className="text-xs text-slate-500">Journeys</p><p className="mt-1 text-2xl font-semibold text-slate-900">{onboarding.total}</p></div>
            <div><p className="text-xs text-slate-500">Completed</p><p className="mt-1 text-2xl font-semibold text-emerald-600">{onboarding.completed}</p></div>
            <div><p className="text-xs text-slate-500">In progress</p><p className="mt-1 text-2xl font-semibold text-slate-900">{onboarding.inProgress}</p></div>
            <div><p className="text-xs text-slate-500">Avg days to complete</p><p className="mt-1 text-2xl font-semibold text-slate-900">{onboarding.avgDaysToComplete ?? "—"}</p></div>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Completion rate</span><span>{onboarding.completionPct}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-panel-2"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${onboarding.completionPct}%` }} /></div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------ Talent Risk ---------------------------- */
function RiskTab({ risk }: { risk: TalentRisk }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile k="Active headcount" v={risk.summary.headcount} />
        <Tile k="At-risk departments" v={risk.summary.atRiskDepartments} />
        <Tile k="Burnout signal" v={risk.summary.burnoutEmployees} sub={`${risk.summary.burnoutPct}% of workforce`} />
        <Tile k="Tracked for activity" v={risk.summary.trackedForActivity} sub="have recent activity data" />
      </div>
      <Card>
        <CardHeader title="Department risk hotspots" subtitle="Real attrition + activity burnout signal, ranked by composite risk" />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Department</th>
                <th className="px-5 py-3">Headcount</th>
                <th className="px-5 py-3">Attrition (12m)</th>
                <th className="px-5 py-3">Avg tenure</th>
                <th className="px-5 py-3">Burnout</th>
                <th className="px-5 py-3">Risk</th>
              </tr>
            </thead>
            <tbody>
              {risk.departments.map((d) => (
                <tr key={d.name} className="border-b border-hairline/60 last:border-0">
                  <td className="px-5 py-3 font-medium text-slate-900">{d.name}</td>
                  <td className="px-5 py-3 text-slate-600">{d.headcount}</td>
                  <td className="px-5 py-3 text-slate-600">{d.attritionPct}% <span className="text-xs text-slate-400">({d.exits12m})</span></td>
                  <td className="px-5 py-3 text-slate-600">{(d.avgTenureMonths / 12).toFixed(1)} yrs</td>
                  <td className="px-5 py-3 text-slate-600">{d.burnoutPct}% <span className="text-xs text-slate-400">({d.burnoutCount})</span></td>
                  <td className="px-5 py-3"><span className={pill(RISK_TINT, d.riskLevel)}>{d.riskLevel} · {d.riskScore}</span></td>
                </tr>
              ))}
              {risk.departments.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">No departments to assess.</td></tr>}
            </tbody>
          </table>
        </CardBody>
      </Card>
      <p className="text-xs text-slate-400">Burnout signal is derived from recent activity (sustained &gt;8.5h/day with focus &lt;70%). Attrition is real, from recorded employee exits over the last 12 months.</p>
    </div>
  );
}
