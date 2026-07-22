import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { PerformanceWorkspace } from "@/components/performance/PerformanceWorkspace";
import { getEmployees, getReviewCycles } from "@/lib/api";

export default async function PerformancePage() {
  const [cycles, employeePage] = await Promise.all([
    getReviewCycles().catch(() => []),
    getEmployees(1, 100).catch(() => ({ items: [], total: 0, page: 1, pageSize: 100 })),
  ]);
  const employees = employeePage.items
    .filter((e) => e.status !== "EXITED")
    .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim() }));

  return (
    <>
      <Topbar title="Performance" subtitle="Review cycles, appraisals & recognition" />
      <PageBody>
        <PerformanceWorkspace cycles={cycles} employees={employees} />
      </PageBody>
    </>
  );
}
