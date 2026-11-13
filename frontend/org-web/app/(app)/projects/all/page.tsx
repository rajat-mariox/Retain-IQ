import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { ProjectsExplorer } from "@/components/projects/ProjectsExplorer";
import { ProjectsTabs } from "@/components/projects/ProjectsTabs";
import { getProjectPeople, getProjectSettings, getProjectTeams, getProjects, getSession } from "@/lib/api";

export default async function ProjectsListPage() {
  const [projects, session, people, teams, settings] = await Promise.all([
    getProjects(1, 100).catch(() => ({ items: [], total: 0, page: 1, pageSize: 100 })),
    getSession().catch(() => null),
    getProjectPeople().catch(() => []),
    getProjectTeams().catch(() => []),
    getProjectSettings().catch(() => null),
  ]);
  const canManage = Boolean(session?.role.permissions.includes("project.write"));

  return (
    <>
      <Topbar title="Projects" subtitle="Browse, filter & manage projects" />
      <PageBody>
        <ProjectsTabs canManage={canManage} roleName={session?.role.name} />
        <ProjectsExplorer projects={projects.items} canManage={canManage} people={people} teams={teams} settings={settings} />
      </PageBody>
    </>
  );
}
