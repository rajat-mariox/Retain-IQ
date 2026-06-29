import Link from "next/link";
import { AlertTriangle, Gauge, HeartHandshake, MoonStar, TrendingDown } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { PageNav } from "@/components/ui/PageNav";
import { getCustomerSuccess, type ApiOrgHealth, type ChurnReason, type HealthBand } from "@/lib/admin-api";
import { formatCompact } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;

const BAND: Record<HealthBand, { text: string; bg: string; dot: string; label: string }> = {
  healthy: { text: "text-emerald-700", bg: "bg-emerald-50 ring-emerald-200", dot: "#16a34a", label: "Healthy" },
  attention: { text: "text-amber-700", bg: "bg-amber-50 ring-amber-200", dot: "#d97706", label: "Needs attention" },
  at_risk: { text: "text-rose-700", bg: "bg-rose-50 ring-rose-200", dot: "#e5484d", label: "At risk" },
};

const RISK: Record<ChurnReason, string> = {
  low_usage: "Low usage",
  inactive: "Inactive",
  renewal_risk: "Renewal risk",
};

function BandPill({ band }: { band: HealthBand }) {
  const b = BAND[band];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${b.bg} ${b.text}`}>
      <span className="size-1.5 rounded-full" style={{ backgroundColor: b.dot }} />
      {b.label}
    </span>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const tone = value >= 70 ? "#16a34a" : value >= 40 ? "#d97706" : "#e5484d";
  return (
    <div className="min-w-[84px]">
      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: tone }} />
      </div>
    </div>
  );
}

function activityLabel(o: ApiOrgHealth) {
  if (o.daysSinceActive == null) return "never active";
  if (o.daysSinceActive === 0) return "active today";
  return `${o.daysSinceActive}d since active`;
}

export default async function CustomerSuccessPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const data = await getCustomerSuccess(page, PAGE_SIZE).catch(() => null);

  if (!data) {
    return (
      <>
        <Topbar title="Customer Success" subtitle="Organization health & churn risk · live" />
        <PageBody>
          <Card><p className="px-5 py-12 text-center text-sm text-slate-500">Customer success data is unavailable.</p></Card>
        </PageBody>
      </>
    );
  }

  const { summary, churn, organizations } = data;
  const rankOffset = (organizations.page - 1) * organizations.pageSize;

  return (
    <>
      <Topbar title="Customer Success" subtitle="Organization health score & churn risk · live" />
      <PageBody>
        {/* Health summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Avg health score" value={String(summary.avgHealthScore)} icon={HeartHandshake} accent="#166534" hint={`${summary.total} organizations`} />
          <StatTile label="Healthy" value={formatCompact(summary.healthy)} icon={Gauge} accent="#16a34a" hint="score ≥ 70" />
          <StatTile label="Needs attention" value={formatCompact(summary.attention)} icon={Gauge} accent="#d97706" hint="score 40–69" />
          <StatTile label="At risk" value={formatCompact(summary.atRisk)} icon={AlertTriangle} accent="#e5484d" hint="score < 40" />
        </div>

        {/* Churn risk */}
        <h2 className="pt-2 text-sm font-semibold text-slate-700">Churn risk</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="Low usage organizations" value={formatCompact(churn.lowUsage)} icon={TrendingDown} accent="#d97706" hint="<30% of seats active" />
          <StatTile label="Inactive organizations" value={formatCompact(churn.inactive)} icon={MoonStar} accent="#e5484d" hint="no activity in 14 days" />
          <StatTile label="Renewal risk" value={formatCompact(churn.renewalRisk)} icon={AlertTriangle} accent="#e5484d" hint="renewing ≤30d at risk / past due" />
        </div>

        {/* Per-org health table — worst first */}
        <Card>
          <CardHeader title="Organization health" subtitle={`Ranked by health score · lowest first · ${formatCompact(organizations.total)} organizations`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Organization</th>
                  <th className="px-5 py-3 text-left font-medium">Plan</th>
                  <th className="px-5 py-3 text-left font-medium">Adoption</th>
                  <th className="px-5 py-3 text-left font-medium">Frequency</th>
                  <th className="px-5 py-3 text-left font-medium">Utilization</th>
                  <th className="px-5 py-3 text-left font-medium">Health</th>
                  <th className="px-5 py-3 text-left font-medium">Risk</th>
                </tr>
              </thead>
              <tbody>
                {organizations.items.map((o, i) => (
                  <tr key={o.orgId} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <span className="float-left mr-2.5 mt-0.5 text-xs tabular-nums text-slate-300">{rankOffset + i + 1}</span>
                      <Link href={`/organizations/${o.orgId}`} className="font-medium text-slate-900 hover:text-brand">
                        {o.name}
                      </Link>
                      <p className="text-xs text-slate-400">
                        {o.activeEmployees}/{o.seats} seats · {activityLabel(o)}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{o.plan ?? "—"}</td>
                    <td className="px-5 py-3"><Meter label="features" value={o.adoption} /></td>
                    <td className="px-5 py-3"><Meter label="cadence" value={o.frequency} /></td>
                    <td className="px-5 py-3"><Meter label="seats·prod" value={o.utilization} /></td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-7 text-right text-base font-semibold tabular-nums text-slate-900">{o.healthScore}</span>
                        <BandPill band={o.band} />
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {o.risks.length === 0 ? (
                        <span className="text-xs text-slate-300">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {o.risks.map((r) => (
                            <span key={r} className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
                              {RISK[r]}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {organizations.items.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">No organizations yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <PageNav page={organizations.page} pageSize={organizations.pageSize} total={organizations.total} basePath="/customer-success" />
        </Card>
      </PageBody>
    </>
  );
}
