import { Activity, Gauge, Timer, TrendingUp } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { PaginatedTable } from "@/components/ui/Pagination";
import { getInsightsMe } from "@/lib/api";

export default async function TimePage() {
  const data = await getInsightsMe().catch(() => null);
  const totals = data?.totals;
  const recent = [...(data?.series ?? [])].reverse();
  const productiveRatio = totals && totals.activeHours > 0 ? Math.round((totals.productiveHours / totals.activeHours) * 100) : 0;
  const momentum = data?.momentum;

  return (
    <>
      <Topbar title="My Time" subtitle="Your tracked time & productivity · last 30 days" />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Active hours" value={String(totals?.activeHours ?? 0)} icon={Activity} accent="#1f883d" hint={`${totals?.trackedDays ?? 0} days tracked`} />
          <StatTile label="Productive hours" value={String(totals?.productiveHours ?? 0)} icon={Timer} accent="#16a34a" hint={`${productiveRatio}% of active`} />
          <StatTile label="Avg productivity" value={`${totals?.avgProductivity ?? 0}%`} icon={Gauge} accent="#0d9488" hint={momentum ? `momentum ${momentum.direction}` : undefined} />
          <StatTile label="Avg focus" value={`${totals?.avgFocus ?? 0}%`} icon={TrendingUp} accent="#166534" />
        </div>

        <Card>
          <CardHeader title="Recent days" subtitle="Hours and scores per day" />
          <PaginatedTable
            minWidth="min-w-[560px]"
            head={
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Day</th>
                <th className="px-5 py-3 text-right font-medium">Active</th>
                <th className="px-5 py-3 text-right font-medium">Productive</th>
                <th className="px-5 py-3 text-right font-medium">Productivity</th>
                <th className="px-5 py-3 text-right font-medium">Focus</th>
              </tr>
            }
            empty={
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No tracked time yet.</td>
              </tr>
            }
            rows={recent.map((d) => (
              <tr key={d.date} className="border-b border-hairline/60 last:border-0">
                <td className="px-5 py-3 tabular-nums text-slate-700">{d.date}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-700">{d.activeHours}h</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{d.productiveHours}h</td>
                <td className="px-5 py-3 text-right">
                  <Bar value={d.productivity} />
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{d.focus}%</td>
              </tr>
            ))}
          />
        </Card>
      </PageBody>
    </>
  );
}

function Bar({ value }: { value: number }) {
  const tone = value >= 80 ? "#16a34a" : value >= 65 ? "#d97706" : "#e5484d";
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-2">
        <span className="block h-full rounded-full" style={{ width: `${value}%`, backgroundColor: tone }} />
      </span>
      <span className="w-8 tabular-nums text-slate-700">{value}%</span>
    </span>
  );
}
