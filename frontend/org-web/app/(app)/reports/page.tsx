import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { ReportsHub } from "@/components/reports/ReportsHub";
import { AsyncReportJobs } from "@/components/reports/AsyncReportJobs";
import { ReportsWorkspace } from "@/components/projects/ReportsWorkspace";
import { getProjectReports, getProjectSettings, getSession } from "@/lib/api";
import { getPublicConfig } from "@/lib/config";

export default async function ReportsPage() {
  const [reports, settings, session, config] = await Promise.all([
    getProjectReports().catch(() => null),
    getProjectSettings().catch(() => null),
    getSession().catch(() => null),
    getPublicConfig(),
  ]);
  // Org-resolved flags (global ∩ this org's override), same source the sidebar uses.
  const featureFlags = session?.featureFlags ?? config.featureFlags;
  const permissions = session?.role.permissions ?? [];
  const showProjectReports = Boolean(reports) && featureFlags["projects"] !== false;

  return (
    <>
      <Topbar title="Reports" subtitle="Every report area in your organization, in one place" />
      <PageBody>
        <ReportsHub featureFlags={featureFlags} permissions={permissions} roleName={session?.role.name} />

        {(permissions.includes("attendance.read") || session?.role.name === "Owner") && featureFlags["attendance"] !== false ? <AsyncReportJobs /> : null}

        {showProjectReports ? (
          <div id="project-reports" className="scroll-mt-20 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">Project &amp; task reports</h2>
            <ReportsWorkspace reports={reports!} settings={settings} />
          </div>
        ) : reports === null ? (
          <Card><p className="px-5 py-12 text-center text-sm text-slate-500">Some reports are unavailable right now.</p></Card>
        ) : null}
      </PageBody>
    </>
  );
}
