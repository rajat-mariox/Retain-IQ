import { AlertTriangle, Ban, CircleCheck, Clock, RefreshCw } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import type { ApiSubscriptions } from "@/lib/admin-api";
import { formatDate } from "@/lib/format";

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const SUB_TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  TRIALING: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  PAST_DUE: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  SUSPENDED: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
  CANCELED: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
};
const title = (s: string) =>
  s.split("_").map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(" ");

function SubBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${SUB_TONE[status] ?? "bg-panel-2 text-slate-600 ring-hairline"}`}>
      {title(status)}
    </span>
  );
}

export function SubscriptionLifecycle({ data }: { data: ApiSubscriptions }) {
  const { counts, upcoming, failed } = data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Active" value={String(counts.active)} icon={CircleCheck} accent="#16a34a" />
        <StatTile label="Trialing" value={String(counts.trialing)} icon={Clock} accent="#0284c7" />
        <StatTile label="Expiring ≤14d" value={String(counts.expiringSoon)} icon={RefreshCw} accent="#d97706" />
        <StatTile label="Past due" value={String(counts.pastDue)} icon={AlertTriangle} accent="#d97706" />
        <StatTile label="Suspended" value={String(counts.suspended)} icon={Ban} accent="#e5484d" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Renewals & expirations */}
        <Card>
          <CardHeader title="Renewals & expirations" subtitle="Subscriptions ending within 14 days" />
          <div className="divide-y divide-hairline/60">
            {upcoming.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing renewing or expiring soon.</p>
            ) : (
              upcoming.map((u) => (
                <div key={u.orgId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{u.orgName}</p>
                    <p className="text-xs text-slate-500">{u.plan} · {formatDate(u.currentPeriodEnd)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <SubBadge status={u.status} />
                    <span className={`text-xs font-medium ${u.autoRenew ? "text-emerald-700" : "text-amber-700"}`}>
                      {u.autoRenew ? "Renews" : "Expires"} in {u.daysLeft}d
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Failed payments */}
        <Card>
          <CardHeader title="Failed payments" subtitle="Past-due & suspended for non-payment" />
          <div className="divide-y divide-hairline/60">
            {failed.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No failed payments. 🎉</p>
            ) : (
              failed.map((f) => (
                <div key={f.orgId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{f.orgName}</p>
                    <p className="text-xs text-slate-500">{f.plan} · {f.daysOverdue}d overdue</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <SubBadge status={f.status} />
                    <span className="text-sm font-medium tabular-nums text-slate-900">{usd(f.amountDue)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
