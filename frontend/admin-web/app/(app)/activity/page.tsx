import Link from "next/link";
import {
  AlertTriangle, Ban, Building2, CreditCard, Pencil, RefreshCw, Trash2, UserPlus, XCircle, CircleCheck,
  type LucideIcon,
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { PageNav } from "@/components/ui/PageNav";
import { getActivity, type ApiActivityItem } from "@/lib/admin-api";
import { timeAgo } from "@/lib/format";

const PAGE_SIZE = 25;

const META: Record<string, { icon: LucideIcon; color: string }> = {
  "org.created": { icon: Building2, color: "#16a34a" },
  "org.activated": { icon: CircleCheck, color: "#16a34a" },
  "org.suspended": { icon: Ban, color: "#d97706" },
  "org.deleted": { icon: Trash2, color: "#e5484d" },
  "org.updated": { icon: Pencil, color: "#64748b" },
  "org.member_added": { icon: UserPlus, color: "#0d9488" },
  "subscription.created": { icon: CreditCard, color: "#1f883d" },
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

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const feed = await getActivity(page, PAGE_SIZE).catch(() => ({ items: [], total: 0, page, pageSize: PAGE_SIZE }));
  const now = Date.now();

  return (
    <>
      <Topbar title="Activity" subtitle="Everything happening across all organizations · live" />
      <PageBody>
        <Card>
          {feed.items.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">No activity yet.</p>
          ) : (
            <div className="divide-y divide-hairline/60">
              {feed.items.map((e) => (
                <Row key={`${e.source}:${e.id}`} e={e} now={now} />
              ))}
            </div>
          )}
          <PageNav page={feed.page} pageSize={feed.pageSize} total={feed.total} basePath="/activity" />
        </Card>
      </PageBody>
    </>
  );
}
