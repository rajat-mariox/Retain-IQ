import { Activity, Database, HardDrive, Layers, Server, Users } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { RefreshButton } from "@/components/health/RefreshButton";
import { getSystemHealth, getUsageAnalytics, type HealthStatus } from "@/lib/admin-api";
import { formatBytes, formatCompact, formatNumber, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const TONE: Record<HealthStatus, { dot: string; text: string; bg: string; label: string }> = {
  up: { dot: "#16a34a", text: "text-emerald-700", bg: "bg-emerald-50 ring-emerald-200", label: "Operational" },
  degraded: { dot: "#d97706", text: "text-amber-700", bg: "bg-amber-50 ring-amber-200", label: "Degraded" },
  down: { dot: "#e5484d", text: "text-rose-700", bg: "bg-rose-50 ring-rose-200", label: "Down" },
};

function StatusPill({ status }: { status: HealthStatus }) {
  const t = TONE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${t.bg} ${t.text}`}>
      <span className="size-1.5 rounded-full" style={{ backgroundColor: t.dot }} />
      {t.label}
    </span>
  );
}

function lat(ms: number | null) {
  return ms == null ? "—" : `${ms} ms`;
}

export default async function HealthPage() {
  const [health, usage] = await Promise.all([
    getSystemHealth().catch(() => null),
    getUsageAnalytics().catch(() => null),
  ]);
  const now = Date.now();
  // Bars stack browser + agent, so the scale is the tallest combined day.
  const maxUsers = Math.max(1, ...(usage?.loginTrend.map((p) => p.users + p.agentUsers) ?? [0]));
  const activeDays = usage?.loginTrend.filter((p) => p.users + p.agentUsers > 0).length ?? 0;
  const maxFeature = Math.max(1, ...(usage?.featureUsage.map((f) => f.orgs) ?? [0]));
  const storagePct =
    health && health.storage.limitBytes ? Math.min(100, (health.storage.usedBytes / health.storage.limitBytes) * 100) : null;

  return (
    <>
      <Topbar title="Platform Health" subtitle="System metrics & platform engagement · live" />
      <PageBody>
        {/* ---- SYSTEM METRICS ---- */}
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-700">System metrics</h2>
          <div className="flex items-center gap-3">
            {health ? (
              <span className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
                <StatusPill status={health.api} />
                checked {timeAgo(health.checkedAt, now)}
              </span>
            ) : null}
            <RefreshButton />
          </div>
        </div>

        {!health ? (
          <Card><p className="px-5 py-8 text-center text-sm text-slate-500">Health checks are unavailable.</p></Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Services (API + Service health) */}
            <Card>
              <CardHeader title="Service health" subtitle="API & background services" />
              <ul className="divide-y divide-hairline/60">
                {health.services.map((s) => (
                  <li key={s.name} className="flex items-center justify-between px-5 py-3">
                    <span className="flex items-center gap-2.5 text-sm text-slate-800">
                      <Server className="size-4 text-slate-400" />
                      {s.name}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs tabular-nums text-slate-400">{lat(s.latencyMs)}</span>
                      <StatusPill status={s.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {/* Databases + Queue */}
            <div className="space-y-6">
              <Card>
                <CardHeader title="Database health" subtitle="Connectivity & latency" />
                <ul className="divide-y divide-hairline/60">
                  {health.databases.map((d) => (
                    <li key={d.name} className="flex items-center justify-between px-5 py-3">
                      <span className="flex items-center gap-2.5 text-sm text-slate-800">
                        <Database className="size-4 text-slate-400" />
                        {d.name}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-xs tabular-nums text-slate-400">{lat(d.latencyMs)}</span>
                        <StatusPill status={d.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <CardHeader title="Queue health" subtitle={`Broker · ${health.queue.driver}`} />
                <div className="flex items-center justify-between px-5 py-3">
                  <span className="flex items-center gap-2.5 text-sm text-slate-800">
                    <Layers className="size-4 text-slate-400" />
                    {health.queue.driver} stream
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs tabular-nums text-slate-400">{lat(health.queue.latencyMs)}</span>
                    <StatusPill status={health.queue.status} />
                  </span>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* Storage usage (platform-wide) */}
        {health ? (
          <Card>
            <CardHeader title="Storage usage" subtitle="Screenshots across all organizations" />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <p className="text-2xl font-semibold text-slate-900">
                  {formatBytes(health.storage.usedBytes)}
                  <span className="ml-2 text-sm font-normal text-slate-400">
                    of {health.storage.limitBytes == null ? "∞" : formatBytes(health.storage.limitBytes)}
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  <HardDrive className="mr-1 inline size-3.5 align-text-bottom" />
                  {formatNumber(health.storage.objects)} objects · {health.storage.orgs} orgs
                </p>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${storagePct ?? Math.min(100, health.storage.usedBytes > 0 ? 8 : 0)}%` }}
                />
              </div>
              {storagePct != null ? <p className="text-xs text-slate-400">{storagePct.toFixed(1)}% of provisioned quota used</p> : null}
            </CardBody>
          </Card>
        ) : null}

        {/* ---- PLATFORM ENGAGEMENT ----
             How much the tenants use RetainIQ itself (sessions in identity-db).
             Distinct from Workforce Analytics (/usage), which measures how much
             their EMPLOYEES work (EmployeeDayFact in analytics-db). Both are
             "usage"; only this one is a liveness signal for the platform. */}
        <div className="pt-2">
          <h2 className="text-sm font-semibold text-slate-700">Platform engagement</h2>
          <p className="mt-0.5 text-xs text-slate-400">How much organizations use RetainIQ — not how much their employees work</p>
        </div>
        {!usage ? (
          <Card><p className="px-5 py-8 text-center text-sm text-slate-500">Engagement metrics are unavailable.</p></Card>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Daily active users" value={formatCompact(usage.dau)} icon={Users} accent="#166534" hint="last 24 hours" />
              <StatTile label="Weekly active users" value={formatCompact(usage.wau)} icon={Users} accent="#1f883d" hint="last 7 days" />
              <StatTile label="Monthly active users" value={formatCompact(usage.mau)} icon={Users} accent="#0d9488" hint="last 30 days" />
              <StatTile label="Signed in today" value={formatCompact(usage.loginsToday)} icon={Activity} accent="#16a34a" hint="from a browser" />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              {/* Daily sign-ins — people, not sessions. A token refresh mints a
                  session too, so bars track DISTINCT USERS instead of rows. */}
              <Card>
                <CardHeader title="Who signs in" subtitle="People per day · browser & desktop agent · 30 days" />
                <CardBody>
                  <div className="flex h-44 items-end gap-1">
                    {usage.loginTrend.map((p) => {
                      const total = p.users + p.agentUsers;
                      const parts = [
                        p.users > 0 ? `${p.users} from a browser` : null,
                        p.agentUsers > 0 ? `${p.agentUsers} via the desktop agent` : null,
                      ].filter(Boolean);
                      return (
                        <div
                          key={p.date}
                          className="group relative flex h-full flex-1 flex-col justify-end"
                          title={total === 0 ? `${p.date}: nobody signed in` : `${p.date}: ${parts.join(" · ")}`}
                        >
                          {/* Browser sits on top of agent so the human signal reads first. */}
                          <div className="w-full rounded-t bg-brand/80 transition-colors group-hover:bg-brand" style={{ height: `${(p.users / maxUsers) * 100}%` }} />
                          <div className="w-full bg-sky-400/70 transition-colors group-hover:bg-sky-400" style={{ height: `${(p.agentUsers / maxUsers) * 100}%` }} />
                          {/* A day with nobody still gets a visible floor, so "zero"
                              reads as measured rather than missing. */}
                          {total === 0 ? <div className="h-0.75 w-full rounded-sm bg-slate-200" /> : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] text-slate-400">
                    <span>{usage.loginTrend.at(0)?.date.slice(5)}</span>
                    <span>{usage.loginTrend.at(-1)?.date.slice(5)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-brand/80" /> Browser</span>
                    <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-sky-400/70" /> Desktop agent</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-0.75 w-2 rounded-sm bg-slate-200" /> No sign-ins</span>
                    <span className="ml-auto">{activeDays} of 30 days had activity</span>
                  </div>
                </CardBody>
              </Card>

              {/* Feature usage */}
              <Card>
                <CardHeader title="Feature usage" subtitle="Adoption across organizations" />
                <CardBody className="space-y-3">
                  {usage.featureUsage.map((f) => (
                    <div key={f.feature}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-slate-800">{f.feature}</span>
                        <span className="text-xs text-slate-500">
                          {f.orgs} orgs · {formatCompact(f.events)} events
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand/70" style={{ width: `${(f.orgs / maxFeature) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
