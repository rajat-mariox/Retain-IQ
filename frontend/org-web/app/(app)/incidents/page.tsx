import { redirect } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { IncidentsWorkspace } from "@/components/incidents/IncidentsWorkspace";
import { getEmployees, getSession } from "@/lib/api";

export default async function IncidentsPage() {
  const session = await getSession().catch(() => null);
  const canView = Boolean(session && (session.role.permissions.includes("incident.manage") || session.role.name === "Owner"));
  if (!canView) redirect("/");

  const page = await getEmployees(1, 500).catch(() => null);
  const employees = (page?.items ?? []).map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim() }));

  return (
    <>
      <Topbar title="Incidents" subtitle="Formal case management — investigate, resolve and close" />
      <PageBody>
        <IncidentsWorkspace employees={employees} />
      </PageBody>
    </>
  );
}
