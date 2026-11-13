import { Banknote, Building2, DollarSign, Repeat, TrendingUp } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { MrrAreaChart } from "@/components/charts/MrrAreaChart";
import { NetMrrBars } from "@/components/charts/NetMrrBars";
import { PlanDonut } from "@/components/charts/PlanDonut";
import { getMrrTrend, getPlanDistribution, getRevenueSummary, getTopCustomers } from "@/lib/data/billing";
import { formatCompact, formatCurrency, formatCurrencyCompact, formatPercent } from "@/lib/format";

export default async function RevenuePage() {
  const [revenue, trend, plans, topCustomers] = await Promise.all([
    getRevenueSummary(),
    getMrrTrend(),
    getPlanDistribution(),
    getTopCustomers(),
  ]);
  const totalMrr = plans.reduce((s, p) => s + p.mrr, 0);

  return (
    <>
      <Topbar title="Revenue" subtitle="MRR, ARR, trend, plan mix & top customers · live" />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="MRR" value={formatCurrencyCompact(revenue.mrr)} icon={DollarSign} deltaPct={revenue.growthRatePct} accent="#166534" />
          <StatTile label="ARR" value={formatCurrencyCompact(revenue.arr)} icon={Banknote} accent="#1f883d" />
          <StatTile label="ARPA" value={formatCurrency(Math.round(revenue.arpa))} icon={TrendingUp} accent="#0d9488" />
          <StatTile label="Net revenue retention" value={formatPercent(revenue.netRevenueRetentionPct).replace("+", "")} icon={Repeat} accent="#16a34a" hint={`${revenue.churnRatePct.toFixed(1)}% monthly churn`} />
        </div>

        <Card>
          <CardHeader title="MRR growth" subtitle="Trailing 12 months" />
          <CardBody>
            <MrrAreaChart data={trend} />
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="New vs. churned MRR" subtitle="Monthly expansion against contraction" />
            <CardBody>
              <NetMrrBars data={trend} />
            </CardBody>
          </Card>

          {/* Revenue by plan */}
          <Card>
            <CardHeader title="Revenue by plan" subtitle="Share of MRR per plan" />
            <CardBody className="space-y-4">
              <PlanDonut data={plans} metric="mrr" />
              <ul className="space-y-2">
                {[...plans].sort((a, b) => b.mrr - a.mrr).map((p) => (
                  <li key={p.plan} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2.5 text-slate-800">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                      {p.name}
                    </span>
                    <span className="tabular-nums text-slate-600">
                      {formatCurrency(p.mrr)}
                      <span className="ml-2 text-xs text-slate-400">{((p.mrr / Math.max(1, totalMrr)) * 100).toFixed(0)}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        {/* Top paying customers (revenue by organization) */}
        <Card>
          <CardHeader title="Top paying organization" subtitle="Organizations ranked by monthly revenue · live" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">#</th>
                  <th className="px-5 py-3 text-left font-medium">Organization</th>
                  <th className="px-5 py-3 text-left font-medium">Plan</th>
                  <th className="px-5 py-3 text-right font-medium">Seats</th>
                  <th className="px-5 py-3 text-right font-medium">MRR</th>
                  <th className="px-5 py-3 text-right font-medium">% of MRR</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((c, i) => (
                  <tr key={c.orgId} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 tabular-nums text-slate-400">{i + 1}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2.5 font-medium text-slate-900">
                        <Building2 className="size-4 text-slate-400" />
                        {c.orgName}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{c.plan}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatCompact(c.seats)}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-900">{formatCurrency(c.mrr)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{((c.mrr / Math.max(1, totalMrr)) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                {topCustomers.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">No paying customers yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
