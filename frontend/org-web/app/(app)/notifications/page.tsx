import { Bell } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { PageNav } from "@/components/ui/PageNav";
import { getNotifications } from "@/lib/api";
import { timeAgo } from "@/lib/format";

const PAGE_SIZE = 10;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const data = await getNotifications(page, PAGE_SIZE).catch(() => ({ items: [], total: 0, page, pageSize: PAGE_SIZE }));
  const now = Date.now();

  return (
    <>
      <Topbar title="Notifications" subtitle="Your in-app inbox" />
      <PageBody>
        <Card>
          <ul className="divide-y divide-hairline/60">
            {data.items.map((n) => {
              const unread = !n.readAt;
              return (
                <li key={n.id} className="flex items-start gap-3 px-5 py-4">
                  <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset ${unread ? "bg-brand/10 text-brand ring-brand/20" : "bg-panel-2 text-slate-400 ring-hairline"}`}>
                    <Bell className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className={`text-sm ${unread ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>{n.title}</p>
                      <span className="shrink-0 text-xs text-slate-400">{timeAgo(n.createdAt, now)}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">{n.body}</p>
                  </div>
                  {unread ? <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" /> : null}
                </li>
              );
            })}
            {data.items.length === 0 ? (
              <li className="px-5 py-12 text-center text-sm text-slate-500">You're all caught up — no notifications.</li>
            ) : null}
          </ul>
          <PageNav page={data.page} pageSize={data.pageSize} total={data.total} basePath="/notifications" />
        </Card>
      </PageBody>
    </>
  );
}
