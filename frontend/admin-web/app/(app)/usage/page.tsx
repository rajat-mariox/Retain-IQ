import Link from "next/link";
import { Building2, HardDrive, TrendingUp, Users } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { GrowthAreaChart, NewOrgsBars, SeatUtilizationBars, StorageAreaChart } from "@/components/charts/GrowthCharts";
import { getGrowth } from "@/lib/admin-api";
import { formatBytes, formatCompact } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Platform Growth — the SaaS business itself.
 *
 * This page used to be "Workforce Analytics": active/idle hours and productivity
 * across tenants. That was the CUSTOMERS' operational data — a super-admin can't
 * act on how hard Acme's staff work. What they can act on is whether tenants are
 * arriving, using the seats they bought, and what storage is costing.
 */
export default async function PlatformGrowthPage() {
  const g = await getGrowth().catch(() => null);

  if (!g) {
    return (
      <>
        <Topbar title="Platform Growth" subtitle="Tenants, seats & storage over time" />
        <PageBody>
          <Card>
            <p className="px-5 py-12 text-center text-sm text-slate-500">Growth data is unavailable right now.</p>
          </Card>
        </PageBody>
      </>
    );
  }

  const t = g.totals;
  const seatPct = t.seatsSold > 0 ? Math.round((t.seatsUsed / t.seatsSold) * 100) : 0;

  return (
    <>
      <Topbar title="Platform Growth" subtitle="Tenants, seats & storage · last 12 months · live" />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Organizations"
            value={formatCompact(t.orgs)}
            icon={Building2}
            accent="#1f883d"
            hint={`+${t.newOrgsThisMonth} this month${t.orgGrowthPct != null ? ` · ${t.orgGrowthPct > 0 ? "+" : ""}${t.orgGrowthPct}% vs last` : ""}`}
          />
          <StatTile label="Users" value={formatCompact(t.users)} icon={Users} accent="#0d9488" hint={`+${t.newUsersThisMonth} this month`} />
          <StatTile label="Seats in use" value={`${seatPct}%`} icon={TrendingUp} accent="#16a34a" hint={`${t.seatsUsed} of ${t.seatsSold} sold`} />
          <StatTile label="Storage" value={formatBytes(t.storageBytes)} icon={HardDrive} accent="#6366f1" hint="screenshots across all tenants" />
        </div>

        <Card>
          <CardHeader title="Platform growth" subtitle="Cumulative organizations & users · last 12 months" />
          <CardBody>
            <GrowthAreaChart data={g.growth} />
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="New organizations" subtitle="Signups per month" />
            <CardBody>
              <NewOrgsBars data={g.growth} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Storage growth" subtitle="What the platform is holding — and paying for" />
            <CardBody>
              <StorageAreaChart data={g.storage} />
            </CardBody>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Seat utilization by plan" subtitle="A wide gap is churn risk; a full plan is an upsell" />
            <CardBody>
              <SeatUtilizationBars data={g.seats} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Biggest tenants" subtitle="By people actually using the product" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-slate-500">
                    <th className="px-5 py-3 text-left font-medium">Organization</th>
                    <th className="px-5 py-3 text-right font-medium">Active</th>
                    <th className="px-5 py-3 text-right font-medium">Users</th>
                    <th className="px-5 py-3 text-right font-medium">Seats</th>
                  </tr>
                </thead>
                <tbody>
                  {g.topOrgs.map((o) => (
                    <tr key={o.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link href={`/organizations/${o.id}`} className="font-medium text-slate-900 hover:text-brand">
                          {o.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700">{o.activeUsers}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-500">{o.users}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-500">{o.seats ?? "—"}</td>
                    </tr>
                  ))}
                  {g.topOrgs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-500">No organizations yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
