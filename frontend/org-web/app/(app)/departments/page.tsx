import { redirect } from "next/navigation";
import { Building2, Users, FolderKanban, Gauge } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { StatTile } from "@/components/ui/StatTile";
import { ProjectsTabs } from "@/components/projects/ProjectsTabs";
import { DepartmentsManager } from "@/components/projects/DepartmentsManager";
import { getDepartmentsOverview, getProjectPeople, getSession } from "@/lib/api";

export default async function DepartmentsPage() {
  const [depts, session, people] = await Promise.all([
    getDepartmentsOverview().catch(() => []),
    getSession().catch(() => null),
    getProjectPeople().catch(() => []),
  ]);
  const perms = session?.role.permissions ?? [];
  const canManageTabs = perms.includes("project.write");
  if (!canManageTabs) redirect("/projects"); // employees don't see Departments
  const canManageStructure = perms.includes("employee.write");
  const totalEmployees = depts.reduce((s, d) => s + d.employees, 0);
  const totalProjects = depts.reduce((s, d) => s + d.projects, 0);
  const avgProd = depts.length ? Math.round(depts.reduce((s, d) => s + d.productivity, 0) / depts.length) : 0;

  return (
    <>
      <Topbar title="Departments" subtitle="Department overview & productivity" />
      <PageBody>
        <ProjectsTabs canManage={canManageTabs} roleName={session?.role.name} />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Departments" value={String(depts.length)} icon={Building2} />
          <StatTile label="Employees" value={String(totalEmployees)} icon={Users} accent="#7c3aed" />
          <StatTile label="Projects" value={String(totalProjects)} icon={FolderKanban} accent="#16a34a" />
          <StatTile label="Avg productivity" value={`${avgProd}%`} icon={Gauge} accent="#0d9488" />
        </div>

        <DepartmentsManager departments={depts} people={people} canManage={canManageStructure} />
      </PageBody>
    </>
  );
}
