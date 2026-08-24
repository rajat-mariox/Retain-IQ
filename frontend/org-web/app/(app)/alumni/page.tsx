import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { AlumniWorkspace } from "@/components/employees/AlumniWorkspace";
import { getSession } from "@/lib/api";

export default async function AlumniPage() {
  const session = await getSession().catch(() => null);
  const canManage = Boolean(session && (session.role.permissions.includes("employee.write") || session.role.name === "Owner"));
  return (
    <>
      <Topbar title="Alumni" subtitle="Former employees & rehire eligibility" />
      <PageBody>
        <AlumniWorkspace canManage={canManage} />
      </PageBody>
    </>
  );
}
