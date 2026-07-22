import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { ProjectsTabs } from "@/components/projects/ProjectsTabs";
import { GoalsWorkspace } from "@/components/projects/GoalsWorkspace";
import { getGoals, getProjectPeople, getProjects, getSession } from "@/lib/api";

export default async function GoalsPage() {
  const [goals, people, projects, session] = await Promise.all([
    getGoals().catch(() => []),
    getProjectPeople().catch(() => []),
    getProjects(1, 100).catch(() => ({ items: [], total: 0, page: 1, pageSize: 100 })),
    getSession().catch(() => null),
  ]);
  const canManage = Boolean(session?.role.permissions.includes("project.write"));
  const projectOptions = projects.items.map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <Topbar title="Goals" subtitle="Set goals & track achievement" />
      <PageBody>
        <ProjectsTabs canManage={canManage} roleName={session?.role.name} />
        <GoalsWorkspace goals={goals} canManage={canManage} people={people} projects={projectOptions} />
      </PageBody>
    </>
  );
}
