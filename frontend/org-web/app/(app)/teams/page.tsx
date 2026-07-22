import { redirect } from "next/navigation";
import { Users, FolderKanban, ListChecks } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { StatTile } from "@/components/ui/StatTile";
import { ProjectsTabs } from "@/components/projects/ProjectsTabs";
import { TeamsManager } from "@/components/projects/TeamsManager";
import { getDepartmentsOverview, getProjectPeople, getProjects, getSession, getTeamsOverview } from "@/lib/api";

export default async function TeamsPage() {
  const [teams, session, people, depts, projects] = await Promise.all([
    getTeamsOverview().catch(() => []),
    getSession().catch(() => null),
    getProjectPeople().catch(() => []),
    getDepartmentsOverview().catch(() => []),
    getProjects(1, 100).catch(() => ({ items: [], total: 0, page: 1, pageSize: 100 })),
  ]);
  const perms = session?.role.permissions ?? [];
  const canManageTabs = perms.includes("project.write");
  if (!canManageTabs) redirect("/projects"); // employees don't see Teams
  const canManageStructure = perms.includes("employee.write");
  const totalMembers = teams.reduce((s, t) => s + t.size, 0);
  const totalActive = teams.reduce((s, t) => s + t.activeProjects, 0);
  const avgProgress = teams.length ? Math.round(teams.reduce((s, t) => s + t.progress, 0) / teams.length) : 0;
  const deptOptions = depts.map((d) => ({ id: d.id, name: d.name }));
  const projectOptions = projects.items.map((p) => ({ id: p.id, name: p.name, teamId: p.teamId }));

  return (
    <>
      <Topbar title="Teams" subtitle="Team size, projects & performance" />
      <PageBody>
        <ProjectsTabs canManage={canManageTabs} roleName={session?.role.name} />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Teams" value={String(teams.length)} icon={Users} />
          <StatTile label="Members" value={String(totalMembers)} icon={Users} accent="#7c3aed" />
          <StatTile label="Active projects" value={String(totalActive)} icon={FolderKanban} accent="#16a34a" />
          <StatTile label="Avg completion" value={`${avgProgress}%`} icon={ListChecks} accent="#0d9488" />
        </div>

        <TeamsManager teams={teams} people={people} departments={deptOptions} projects={projectOptions} canManage={canManageStructure} />
      </PageBody>
    </>
  );
}
