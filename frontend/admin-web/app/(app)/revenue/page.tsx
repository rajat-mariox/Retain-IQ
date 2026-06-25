import { Banknote, DollarSign, Repeat, TrendingUp } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { MrrAreaChart } from "@/components/charts/MrrAreaChart";
import { NetMrrBars } from "@/components/charts/NetMrrBars";
import { getMrrTrend, getRevenueSummary } from "@/lib/data/billing";
import { formatCurrency, formatCurrencyCompact, formatPercent } from "@/lib/format";

export default async function RevenuePage() {
  const [revenue, trend] = await Promise.all([getRevenueSummary(), getMrrTrend()]);

  return (
    <>
      <Topbar title="Revenue" subtitle="MRR, growth and retention · live" />
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

        <Card>
          <CardHeader title="New vs. churned MRR" subtitle="Monthly expansion against contraction" />
          <CardBody>
            <NetMrrBars data={trend} />
          </CardBody>
        </Card>
      </PageBody>
    </>
  );
}
