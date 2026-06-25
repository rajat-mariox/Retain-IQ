import Link from "next/link";
import { Activity, Building2, TrendingUp, Users } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { StatusBadge } from "@/components/ui/badges";
import { UsageAreaChart } from "@/components/charts/UsageAreaChart";
import { PlanDonut } from "@/components/charts/PlanDonut";
import { getKpiSummary, getOrganizations } from "@/lib/data/orgs";
import { getUsageSeries } from "@/lib/data/analytics";
import { getPlanDistribution, getRevenueSummary } from "@/lib/data/billing";
import { formatCompact, formatCurrency, formatPercent } from "@/lib/format";

export default async function OverviewPage() {
  const [kpi, orgs, usage, plans, revenue] = await Promise.all([
    getKpiSummary(),
    getOrganizations(),
    getUsageSeries(),
    getPlanDistribution(),
    getRevenueSummary(),
  ]);

  const topOrgs = [...orgs].sort((a, b) => b.activeHours - a.activeHours).slice(0, 6);

  return (
    <>
      <Topbar title="Overview" subtitle="Live platform health across all organizations" />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Total organizations"
            value={formatCompact(kpi.totalOrgs)}
            icon={Building2}
            hint={`${kpi.activeOrgs} active · ${kpi.newOrgsThisMonth ?? 0} new this month`}
            accent="#1f883d"
          />
          <StatTile
            label="Total users"
            value={formatCompact(kpi.totalUsers)}
            icon={Users}
            hint={`${formatCompact(kpi.totalEmployees)} employees monitored`}
            accent="#0d9488"
          />
          <StatTile
            label="Tracked orgs (30d)"
            value={formatCompact(kpi.trackedOrgs ?? 0)}
            icon={Activity}
            hint="Orgs with activity data"
            accent="#166534"
          />
          <StatTile
            label="Avg productivity"
            value={`${kpi.avgProductivity}%`}
            icon={TrendingUp}
            hint="Across tracked orgs (30d)"
            accent="#16a34a"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Platform usage" subtitle="Active vs. idle hours · last 30 days · live" />
            <CardBody>
              <UsageAreaChart data={usage} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Plan mix" subtitle="Organizations by plan · live" />
            <CardBody>
              <PlanDonut data={plans} metric="orgs" />
              <ul className="mt-4 space-y-2">
                {plans.map((p) => (
                  <li key={p.plan} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-700">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                      {p.name}
                    </span>
                    <span className="tabular-nums text-slate-600">{p.orgs} orgs</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Top organizations" subtitle="By active hours (30d) · live" />
            <ul className="divide-y divide-hairline/60">
              {topOrgs.map((o) => (
                <li key={o.id} className="px-5 py-3">
                  <Link href={`/organizations/${o.id}`} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="grid size-8 place-items-center rounded-lg bg-panel-2 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-hairline">
                        {o.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <span className="font-medium text-slate-900">{o.name}</span>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {o.users} users · {o.employees} employees
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="tabular-nums font-medium text-slate-900">{formatCompact(o.activeHours)} h</p>
                      <div className="mt-1 flex justify-end">
                        <StatusBadge status={o.status} />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
              {topOrgs.length === 0 ? (
                <li className="px-5 py-6 text-center text-sm text-slate-500">No activity yet.</li>
              ) : null}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Revenue snapshot" subtitle="Run-rate · live" />
            <CardBody className="space-y-4">
              <SnapshotRow label="MRR" value={formatCurrency(revenue.mrr)} />
              <SnapshotRow label="ARR" value={formatCurrency(revenue.arr)} />
              <SnapshotRow label="ARPA" value={formatCurrency(Math.round(revenue.arpa))} />
              <SnapshotRow
                label="Net revenue retention"
                value={formatPercent(revenue.netRevenueRetentionPct).replace("+", "")}
                tone="emerald"
              />
              <SnapshotRow label="Monthly churn" value={`${revenue.churnRatePct.toFixed(1)}%`} tone="rose" />
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

function SnapshotRow({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "rose" }) {
  const color = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="flex items-center justify-between border-b border-hairline/50 pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`tabular-nums text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}
