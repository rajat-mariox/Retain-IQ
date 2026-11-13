import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody } from "@/components/ui/Card";
import { MonitoringWorkspace } from "@/components/monitoring/MonitoringWorkspace";
import { getEmployees, getSession } from "@/lib/api";

export default async function MonitoringPage() {
  const session = await getSession().catch(() => null);
  const isAdmin = Boolean(session && (session.role.permissions.includes("employee.read") || session.role.name === "Owner"));

  if (!isAdmin) {
    return (
      <>
        <Topbar title="Employee Monitoring" subtitle="Activity & productivity" />
        <PageBody>
          <Card>
            <CardBody className="py-12 text-center text-sm text-slate-500">Monitoring insights are available to managers and administrators.</CardBody>
          </Card>
        </PageBody>
      </>
    );
  }

  const employees = await getEmployees(1, 200).catch(() => ({ items: [], total: 0, page: 1, pageSize: 200 }));
  const options = employees.items.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim() }));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Topbar title="Employee Monitoring" subtitle="Activity timeline, applications, websites & work sessions" />
      <PageBody>
        <MonitoringWorkspace employees={options} today={today} />
      </PageBody>
    </>
  );
}
