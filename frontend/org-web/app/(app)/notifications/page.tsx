import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { getNotificationStats, getNotifications, getSession } from "@/lib/api";

const PAGE_SIZE = 15;

export default async function NotificationsPage() {
  const [data, stats, session] = await Promise.all([
    getNotifications(1, PAGE_SIZE).catch(() => ({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE })),
    getNotificationStats().catch(() => ({ total: 0, unread: 0, critical: 0, archived: 0, categories: {} })),
    getSession().catch(() => null),
  ]);
  // Managers/Owners get the org-wide alert workspace (§9/§10).
  const canViewWorkspace = Boolean(
    session && (session.role.name === "Owner" || session.role.permissions.includes("employee.read")),
  );

  return (
    <>
      <Topbar title="Notifications" subtitle="Your alerts, updates & recommendations" />
      <PageBody>
        <NotificationCenter initialItems={data.items} initialTotal={data.total} initialStats={stats} canViewWorkspace={canViewWorkspace} />
      </PageBody>
    </>
  );
}
