import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { TimeTrackingWorkspace } from "@/components/time/TimeTrackingWorkspace";
import { getInsightsMe, getProjects, getSession } from "@/lib/api";

export default async function TimePage() {
  const [insights, session, projects] = await Promise.all([
    getInsightsMe().catch(() => null),
    getSession().catch(() => null),
    getProjects(1, 100).catch(() => ({ items: [], total: 0, page: 1, pageSize: 100 })),
  ]);
  const isOwner = session?.role.name === "Owner";
  const isManager = Boolean(session && (session.role.permissions.includes("attendance.approve") || isOwner));
  const projectOptions = projects.items.map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <Topbar
        title={isOwner ? "Timesheet Approvals" : "Time Tracking"}
        subtitle={isOwner ? "Review and approve your team's timesheets" : "Timesheets, tracked time & approvals"}
      />
      <PageBody>
        <TimeTrackingWorkspace insights={insights} projects={projectOptions} isManager={isManager} isOwner={isOwner} />
      </PageBody>
    </>
  );
}
