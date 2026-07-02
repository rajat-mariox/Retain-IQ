import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { LeaveWorkspace } from "@/components/leave/LeaveWorkspace";
import { getAllLeaveRequests, getDepartments, getHolidays, getLeaveTypes, getMyLeaveBalances, getMyLeaveRequests, getSession } from "@/lib/api";

export default async function LeavePage() {
  const session = await getSession().catch(() => null);
  const isAdmin = Boolean(session && (session.role.permissions.includes("attendance.approve") || session.role.name === "Owner"));

  const [types, balances, myRequests, holidays, departments, allRequests] = await Promise.all([
    getLeaveTypes().catch(() => []),
    getMyLeaveBalances().catch(() => ({ year: new Date().getFullYear(), employeeId: "", balances: [] })),
    getMyLeaveRequests().catch(() => []),
    getHolidays().catch(() => []),
    isAdmin ? getDepartments().catch(() => []) : Promise.resolve([]),
    isAdmin ? getAllLeaveRequests().catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <>
      <Topbar title="Leave & Holidays" subtitle="Requests, balances, approvals & holidays" />
      <PageBody>
        <LeaveWorkspace isAdmin={isAdmin} types={types} balances={balances} myRequests={myRequests} allRequests={allRequests} holidays={holidays} departments={departments} />
      </PageBody>
    </>
  );
}
