import Link from "next/link";
import {
  AlertTriangle, ArrowLeftRight, Ban, Building2, CreditCard, Pencil, RefreshCw, RotateCcw, ToggleLeft, ToggleRight,
  Trash2, UserMinus, UserPlus, XCircle, CircleCheck,
  type LucideIcon,
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { PageNav } from "@/components/ui/PageNav";
import { ActivityFilters } from "@/components/activity/ActivityFilters";
import { getActivity, getActivityFilters, type ApiActivityItem } from "@/lib/admin-api";
import { timeAgo } from "@/lib/format";

const PAGE_SIZE = 25;

const META: Record<string, { icon: LucideIcon; color: string }> = {
  "org.created": { icon: Building2, color: "#16a34a" },
  "org.activated": { icon: CircleCheck, color: "#16a34a" },
  "org.suspended": { icon: Ban, color: "#d97706" },
  "org.deleted": { icon: Trash2, color: "#e5484d" },
  "org.updated": { icon: Pencil, color: "#64748b" },
  "org.member_added": { icon: UserPlus, color: "#0d9488" },
  "user.invited": { icon: UserPlus, color: "#0d9488" },
  "user.removed": { icon: UserMinus, color: "#d97706" },
  "feature.enabled": { icon: ToggleRight, color: "#16a34a" },
  "feature.disabled": { icon: ToggleLeft, color: "#d97706" },
  "feature.reset": { icon: RotateCcw, color: "#64748b" },
  "subscription.created": { icon: CreditCard, color: "#1f883d" },
  "subscription.plan_changed": { icon: ArrowLeftRight, color: "#0d9488" },
  "subscription.renewed": { icon: RefreshCw, color: "#16a34a" },
  "subscription.canceled": { icon: XCircle, color: "#64748b" },
  "subscription.suspended": { icon: Ban, color: "#e5484d" },
  "payment.failed": { icon: AlertTriangle, color: "#e5484d" },
};

function Row({ e, now }: { e: ApiActivityItem; now: number }) {
  const meta = META[e.type] ?? { icon: CircleCheck, color: "#64748b" };
  const Icon = meta.icon;
  const body = (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset" style={{ color: meta.color, backgroundColor: `${meta.color}14`, borderColor: `${meta.color}33` }}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-800">{e.summary}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {e.orgName ? <span className="font-medium text-slate-600">{e.orgName}</span> : null}
          {e.orgName ? " · " : ""}
          <span className="capitalize">{e.source}</span> · {timeAgo(e.createdAt, now)}
        </p>
      </div>
    </div>
  );
  return e.orgId ? (
    <Link href={`/organizations/${e.orgId}`} className="block transition-colors hover:bg-slate-50">{body}</Link>
  ) : (
    body
  );
}

type Search = { page?: string; orgId?: string; type?: string; from?: string; to?: string };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const filter = { orgId: sp.orgId, type: sp.type, from: sp.from, to: sp.to };
  const filtered = Object.values(filter).some(Boolean);

  const [feed, filters] = await Promise.all([
    getActivity(page, PAGE_SIZE, filter).catch(() => ({ items: [], total: 0, page, pageSize: PAGE_SIZE })),
    getActivityFilters().catch(() => ({ types: [], organizations: [] })),
  ]);
  const now = Date.now();

  // Carry the filters through pagination — page 2 of a filtered view must stay filtered.
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) if (v) query.set(k, v);
  const basePath = `/activity${query.toString() ? `?${query}` : ""}`;

  return (
    <>
      <Topbar title="Activity" subtitle="Everything happening across all organizations · live" />
      <PageBody>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
            <ActivityFilters types={filters.types} organizations={filters.organizations} />
            <span className="text-xs text-slate-400">
              {feed.total} {feed.total === 1 ? "event" : "events"}
              {filtered ? " match" : ""}
            </span>
          </div>
          {feed.items.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">
              {filtered ? "No activity matches these filters." : "No activity yet."}
            </p>
          ) : (
            <div className="divide-y divide-hairline/60">
              {feed.items.map((e) => (
                <Row key={`${e.source}:${e.id}`} e={e} now={now} />
              ))}
            </div>
          )}
          <PageNav page={feed.page} pageSize={feed.pageSize} total={feed.total} basePath={basePath} />
        </Card>
      </PageBody>
    </>
  );
}
