import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { PlanDonut } from "@/components/charts/PlanDonut";
import { SubscriptionsTabs } from "@/components/plans/SubscriptionsTabs";
import { SubscriptionLifecycle } from "@/components/plans/SubscriptionLifecycle";
import { getPlanDistribution } from "@/lib/data/billing";
import { getSubscriptionsView, getChangeRequests } from "@/lib/admin-api";
import { getPlans } from "@/lib/plans-api";
import { formatCompact, formatCurrency, formatNumber } from "@/lib/format";

export default async function SubscriptionsPage() {
  const [plans, catalog, lifecycle, changeRequests] = await Promise.all([
    getPlanDistribution(),
    getPlans().catch(() => []),
    getSubscriptionsView().catch(() => null),
    getChangeRequests().then((d) => d.items).catch(() => []),
  ]);

  const totalOrgs = plans.reduce((s, p) => s + p.orgs, 0);
  const totalSeats = plans.reduce((s, p) => s + p.seats, 0);
  const totalMrr = plans.reduce((s, p) => s + p.mrr, 0);
  const paidOrgs = plans.filter((p) => p.plan !== "free").reduce((s, p) => s + p.orgs, 0);

  const overview = (
    <div className="space-y-6">
        {/* Subscription health (status counts) + actionable lists (renewals / failed payments). */}
        {lifecycle ? <SubscriptionLifecycle data={lifecycle} /> : null}

        {/* Plan distribution: how the book splits across plans. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Orgs by plan" subtitle={`${formatCompact(paidOrgs)} of ${formatCompact(totalOrgs)} paid`} />
            <CardBody><PlanDonut data={plans} metric="orgs" /></CardBody>
          </Card>
          <Card>
            <CardHeader title="MRR by plan" subtitle={`${formatCompact(totalSeats)} active seats`} />
            <CardBody><PlanDonut data={plans} metric="mrr" /></CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Plan breakdown" subtitle="Organizations, seats and revenue per plan" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Plan</th>
                  <th className="px-5 py-3 text-right font-medium">Organizations</th>
                  <th className="px-5 py-3 text-right font-medium">Active seats</th>
                  <th className="px-5 py-3 text-right font-medium">MRR</th>
                  <th className="px-5 py-3 text-right font-medium">% of revenue</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.plan} className="border-b border-hairline/60 last:border-0">
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2.5 font-medium text-slate-900">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                        {p.name}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(p.orgs)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(p.seats)}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-900">{formatCurrency(p.mrr)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{((p.mrr / Math.max(1, totalMrr)) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                <tr className="bg-panel-2/40 font-medium">
                  <td className="px-5 py-3 text-slate-800">Total</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-800">{formatNumber(totalOrgs)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-800">{formatNumber(totalSeats)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-900">{formatCurrency(totalMrr)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
    </div>
  );

  return (
    <>
      <Topbar title="Subscriptions" subtitle="Plan distribution, seats & plan catalog · live" />
      <PageBody>
        <SubscriptionsTabs overview={overview} plans={catalog} changeRequests={changeRequests} />
      </PageBody>
    </>
  );
}
