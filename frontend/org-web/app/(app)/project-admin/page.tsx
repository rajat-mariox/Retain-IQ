import { ShieldAlert } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { ProjectsTabs } from "@/components/projects/ProjectsTabs";
import { AdminWorkspace } from "@/components/projects/AdminWorkspace";
import { getProjectDashboard, getProjectSettings, getSession } from "@/lib/api";

export default async function ProjectAdminPage() {
  const session = await getSession().catch(() => null);
  const canManage = Boolean(session?.role.permissions.includes("project.write"));
  // Workspace configuration (statuses, workflow, permissions) is an Owner-only
  // surface — Managers use it read-nothing; they get the Manager view instead.
  const isOwner = session?.role.name === "Owner";

  return (
    <>
      <Topbar title="Projects Admin" subtitle="Settings, workflow & permissions" />
      <PageBody>
        <ProjectsTabs canManage={canManage} roleName={session?.role.name} />

        {!isOwner ? (
          <Card>
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <ShieldAlert className="size-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">Owner access only</p>
              <p className="text-sm text-slate-500">Workspace configuration is available to the organization Owner.</p>
            </div>
          </Card>
        ) : (
          <AdminContent />
        )}
      </PageBody>
    </>
  );
}

async function AdminContent() {
  const [settings, dashboard] = await Promise.all([getProjectSettings().catch(() => null), getProjectDashboard().catch(() => null)]);
  if (!settings) {
    return (
      <Card><p className="px-5 py-12 text-center text-sm text-slate-500">Settings are unavailable right now.</p></Card>
    );
  }
  return <AdminWorkspace settings={settings} dashboard={dashboard} />;
}
