import { Activity, Gauge, Hourglass, Timer } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { UsageAreaChart } from "@/components/charts/UsageAreaChart";
import { ProductivityLineChart } from "@/components/charts/ProductivityLineChart";
import { PaginatedList } from "@/components/ui/Pagination";
import { getTopOrgsByUsage, getUsageSeries, getUsageTotals } from "@/lib/data/analytics";
import { formatCompact } from "@/lib/format";

export default async function UsagePage() {
  const [usage, totals, topOrgs] = await Promise.all([
    getUsageSeries(),
    getUsageTotals(),
    getTopOrgsByUsage(8),
  ]);

  const productiveRatio = Math.round((totals.productiveHours / Math.max(1, totals.activeHours)) * 100);
  const maxHours = Math.max(1, ...topOrgs.map((o) => o.activeHours));

  return (
    <>
      <Topbar title="Usage & Analytics" subtitle="Cross-org activity · last 30 days · live" />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Active hours" value={formatCompact(totals.activeHours)} icon={Activity} accent="#1f883d" />
          <StatTile label="Idle hours" value={formatCompact(totals.idleHours)} icon={Hourglass} accent="#0d9488" />
          <StatTile label="Productive ratio" value={`${productiveRatio}%`} icon={Timer} accent="#16a34a" />
          <StatTile label="Avg productivity" value={`${totals.avgProductivity}%`} icon={Gauge} accent="#166534" />
        </div>

        <Card>
          <CardHeader title="Active vs. idle hours" subtitle="Aggregated across all active organizations" />
          <CardBody>
            <UsageAreaChart data={usage} />
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Productivity trend" subtitle="Average focus/productivity score" />
            <CardBody>
              <ProductivityLineChart data={usage} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Top orgs by usage" subtitle="Active hours (30d)" />
            <PaginatedList
              pageSize={8}
              empty={<li className="px-5 py-8 text-center text-sm text-slate-500">No usage data yet.</li>}
              items={topOrgs.map((o) => (
                <li key={o.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-slate-800">{o.name}</span>
                    <span className="tabular-nums text-xs text-slate-600">
                      {formatCompact(o.activeHours)} h · {o.avgProductivity}%
                    </span>
                  </div>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-panel-2">
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${(o.activeHours / maxHours) * 100}%` }} />
                  </span>
                </li>
              ))}
            />
          </Card>
        </div>
      </PageBody>
    </>
  );
}
