import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { EmployeeProfileWorkspace } from "@/components/employees/EmployeeProfileWorkspace";
import { getDepartments, getDesignations, getEmployeeDocuments, getEmployeeHistory, getEmployeeProfile, getEmployees, getSession, getShiftRotations, getShifts, getTeams, type EmployeeProfile } from "@/lib/api";

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let profile: EmployeeProfile;
  try {
    profile = await getEmployeeProfile(id);
  } catch {
    notFound();
  }
  const [history, documents, departments, teams, designations, shifts, rotations, people, session] = await Promise.all([
    getEmployeeHistory(id).catch(() => []),
    getEmployeeDocuments(id).catch(() => []),
    getDepartments().catch(() => []),
    getTeams().catch(() => []),
    getDesignations().catch(() => []),
    getShifts().catch(() => []),
    getShiftRotations().catch(() => []),
    getEmployees(1, 100).catch(() => ({ items: [], total: 0, page: 1, pageSize: 100 })),
    getSession().catch(() => null),
  ]);
  const canManage = Boolean(session?.role.permissions.includes("employee.write"));
  const canSeeCases = Boolean(session && (session.role.permissions.includes("observation.read") || session.role.name === "Owner"));
  const canAudit = Boolean(session && (session.role.permissions.includes("audit.read") || session.role.name === "Owner"));
  const managerOptions = people.items.filter((e) => e.id !== id).map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim() }));

  return (
    <>
      <Topbar title={`${profile.firstName} ${profile.lastName}`} subtitle={profile.title ?? profile.designationRef?.title ?? "Employee profile"} />
      <PageBody>
        <EmployeeProfileWorkspace
          profile={profile}
          history={history}
          documents={documents}
          canManage={canManage}
          canSeeCases={canSeeCases}
          canAudit={canAudit}
          options={{
            departments: departments.filter((d) => d.status !== "ARCHIVED").map((d) => ({ id: d.id, name: d.name })),
            teams: teams.map((t) => ({ id: t.id, name: t.name })),
            designations: designations.filter((d) => d.status !== "ARCHIVED").map((d) => ({ id: d.id, title: d.title, level: d.level })),
            shifts: shifts.filter((s) => s.status !== "ARCHIVED").map((s) => ({ id: s.id, name: s.name })),
            rotations: rotations.filter((r) => r.status !== "ARCHIVED").map((r) => ({ id: r.id, name: r.name })),
            managers: managerOptions,
          }}
        />
      </PageBody>
    </>
  );
}
