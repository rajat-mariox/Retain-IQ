import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { EmployeeManagement } from "@/components/employees/EmployeeManagement";
import { getDepartments, getDesignations, getEmployees, getLifecycleSummary, getOrgChart, getRoles, getShifts, getTeams } from "@/lib/api";

const PAGE_SIZE = 10;

export default async function EmployeesPage() {
  const [employees, departments, teams, designations, shifts, roles, lifecycle, orgChart] = await Promise.all([
    getEmployees(1, PAGE_SIZE).catch(() => ({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE })),
    getDepartments().catch(() => []),
    getTeams().catch(() => []),
    getDesignations().catch(() => []),
    getShifts().catch(() => []),
    getRoles().catch(() => []),
    getLifecycleSummary().catch(() => ({ onboarding: 0, probation: 0, confirmed: 0, exited: 0 })),
    getOrgChart().catch(() => ({ roots: [], total: 0 })),
  ]);

  return (
    <>
      <Topbar title="Employee Management" subtitle="Directory, org chart & lifecycle" />
      <PageBody>
        <EmployeeManagement initialEmployees={employees} departments={departments} teams={teams} designations={designations} shifts={shifts} roles={roles} lifecycle={lifecycle} orgChart={orgChart} />
      </PageBody>
    </>
  );
}
