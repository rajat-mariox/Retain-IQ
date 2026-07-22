import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { ProjectsTabs } from "@/components/projects/ProjectsTabs";
import { ReportsWorkspace } from "@/components/projects/ReportsWorkspace";
import { getProjectReports, getProjectSettings, getSession } from "@/lib/api";

export default async function ReportsPage() {
  const [reports, settings, session] = await Promise.all([getProjectReports().catch(() => null), getProjectSettings().catch(() => null), getSession().catch(() => null)]);
  const canManage = Boolean(session?.role.permissions.includes("project.write"));

  return (
    <>
      <Topbar title="Reports" subtitle="Project, task, team & progress reports" />
      <PageBody>
        <ProjectsTabs canManage={canManage} roleName={session?.role.name} />
        {reports ? (
          <ReportsWorkspace reports={reports} settings={settings} />
        ) : (
          <Card><p className="px-5 py-12 text-center text-sm text-slate-500">Reports are unavailable right now.</p></Card>
        )}
      </PageBody>
    </>
  );
}
