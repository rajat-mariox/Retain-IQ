import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { NotificationWorkspace } from "@/components/notifications/NotificationWorkspace";
import { getNotificationOrgFeed, getSession } from "@/lib/api";

const EMPTY = { items: [], total: 0, page: 1, pageSize: 20, summary: { categories: {}, priorities: {} } };

export default async function NotificationWorkspacePage() {
  const session = await getSession().catch(() => null);
  const isOwner = session?.role.name === "Owner";
  const canRead = Boolean(session && (isOwner || session.role.permissions.includes("employee.read")));

  if (!canRead) {
    return (
      <>
        <Topbar title="Alert workspace" subtitle="Team & organisation alerts" />
        <PageBody>
          <p className="rounded-lg bg-panel px-5 py-12 text-center text-sm text-slate-500 ring-1 ring-hairline">
            You don&apos;t have access to the organisation alert feed.
          </p>
        </PageBody>
      </>
    );
  }

  const feed = await getNotificationOrgFeed(1, 20).catch(() => EMPTY);

  return (
    <>
      <Topbar
        title={isOwner ? "Org alert workspace" : "Team alert workspace"}
        subtitle={isOwner ? "Organisation-wide alerts, rules & delivery policy" : "Alerts raised across your team"}
      />
      <PageBody>
        <Link href="/notifications" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
          <ChevronLeft className="size-3.5" /> Back to my notifications
        </Link>
        <NotificationWorkspace initial={feed} isOwner={isOwner} />
      </PageBody>
    </>
  );
}
