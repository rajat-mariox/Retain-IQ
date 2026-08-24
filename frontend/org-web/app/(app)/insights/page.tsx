import { Activity, AlertTriangle, HeartPulse, Sparkles } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { RiskBadge } from "@/components/ui/badges";
import { PaginatedTable } from "@/components/ui/Pagination";
import { ProductivityTargetCard } from "@/components/insights/ProductivityTargetCard";
import { InsightsExport } from "@/components/insights/InsightsExport";
import { getInsightsByGroup, getInsightsTeam, getSession, type ProductivityGroupRow } from "@/lib/api";

/** Productivity rolled up by department or team. */
function GroupProductivityCard({ title, subtitle, unitLabel, rows }: { title: string; subtitle: string; unitLabel: string; rows: ProductivityGroupRow[] }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-slate-500">
              <th className="px-5 py-3 text-left font-medium">{unitLabel}</th>
              <th className="px-5 py-3 text-right font-medium">People</th>
              <th className="px-5 py-3 text-right font-medium">Productivity</th>
              <th className="px-5 py-3 text-right font-medium">Focus</th>
              <th className="px-5 py-3 text-right font-medium">Avg hrs/day</th>
              <th className="px-5 py-3 text-right font-medium">At risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">No {unitLabel.toLowerCase()} with activity yet.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{r.name}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.trackedEmployees}/{r.headcount}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-700">{r.avgProductivity}%</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.avgFocus}%</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.avgActiveHours}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{r.burnoutRisk > 0 ? <span className="text-rose-600">{r.burnoutRisk}</span> : <span className="text-slate-400">0</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default async function InsightsPage() {
  const [data, groups, session] = await Promise.all([
    getInsightsTeam().catch(() => null),
    getInsightsByGroup().catch(() => null),
    getSession().catch(() => null),
  ]);
  const s = data?.summary;
  const canManageTarget = Boolean(session && (session.role.permissions.includes("employee.write") || session.role.name === "Owner"));

  return (
    <>
      <Topbar title="AI Insights" subtitle="Workforce analytics · derived from activity · last 30 days" />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Workforce health" value={`${s?.workforceHealth ?? 0}`} icon={HeartPulse} accent="#16a34a" hint={`${s?.trackedEmployees ?? 0} employees tracked`} />
          <StatTile label="Avg productivity" value={`${s?.avgProductivity ?? 0}%`} icon={Activity} accent="#1f883d" />
          <StatTile label="Burnout risk" value={`${s?.burnoutRisk ?? 0}`} icon={AlertTriangle} accent="#e5484d" hint="High hours · low focus" />
          <StatTile label="Low engagement" value={`${s?.lowEngagement ?? 0}`} icon={Sparkles} accent="#d97706" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ProductivityTargetCard
            avgProductivity={s?.avgProductivity ?? 0}
            initialTarget={s?.productivityTarget ?? null}
            onTargetCount={s?.onTargetCount ?? null}
            trackedEmployees={s?.trackedEmployees ?? 0}
            canManage={canManageTarget}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Workforce" subtitle="Per-employee productivity, focus and risk" action={<InsightsExport people={data?.people ?? []} />} />
            <PaginatedTable
              minWidth="min-w-[640px]"
              head={
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Employee</th>
                  <th className="px-5 py-3 text-right font-medium">Productivity</th>
                  <th className="px-5 py-3 text-right font-medium">Focus</th>
                  <th className="px-5 py-3 text-right font-medium">Active hrs</th>
                  <th className="px-5 py-3 text-left font-medium">Signal</th>
                </tr>
              }
              empty={<tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No activity data yet.</td></tr>}
              rows={(data?.people ?? []).map((p) => (
                <tr key={p.employeeId} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{p.name}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-700">{p.productivity}%</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{p.focus}%</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{p.activeHours}</td>
                  <td className="px-5 py-3"><RiskBadge risk={p.risk} /></td>
                </tr>
              ))}
            />
          </Card>

          <Card>
            <CardHeader title="Top performers" subtitle="By productivity" />
            <ul className="divide-y divide-hairline/60">
              {(data?.topPerformers ?? []).map((p, i) => (
                <li key={p.employeeId} className="flex items-center justify-between px-5 py-3">
                  <span className="flex items-center gap-3">
                    <span className="grid size-6 place-items-center rounded-full bg-panel-2 text-xs font-semibold text-slate-600">{i + 1}</span>
                    <span className="text-sm font-medium text-slate-800">{p.name}</span>
                  </span>
                  <span className="tabular-nums text-sm text-slate-600">{p.productivity}%</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <GroupProductivityCard title="By department" subtitle="Productivity rolled up per department" unitLabel="Department" rows={groups?.byDepartment ?? []} />
          <GroupProductivityCard title="By team" subtitle="Productivity rolled up per team" unitLabel="Team" rows={groups?.byTeam ?? []} />
        </div>

        <p className="text-xs text-slate-400">
          Signals are heuristic (derived from activity facts) — a placeholder for the future ML burnout/attrition models.
        </p>
      </PageBody>
    </>
  );
}
