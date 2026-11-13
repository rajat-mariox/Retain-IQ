import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { LeaveWorkspace } from "@/components/leave/LeaveWorkspace";
import { getAllLeaveRequests, getDepartments, getHolidays, getLeaveAnalytics, getLeaveTypes, getMyLeaveBalances, getMyLeaveRequests, getSession, getTeams } from "@/lib/api";

export default async function LeavePage() {
  const session = await getSession().catch(() => null);
  const isAdmin = Boolean(session && (session.role.permissions.includes("attendance.approve") || session.role.name === "Owner"));

  const [types, balances, myRequests, holidays, departments, teams, allRequests, analytics] = await Promise.all([
    getLeaveTypes().catch(() => []),
    getMyLeaveBalances().catch(() => ({ year: new Date().getFullYear(), employeeId: "", balances: [] })),
    getMyLeaveRequests().catch(() => []),
    getHolidays().catch(() => []),
    isAdmin ? getDepartments().catch(() => []) : Promise.resolve([]),
    isAdmin ? getTeams().catch(() => []) : Promise.resolve([]),
    isAdmin ? getAllLeaveRequests().catch(() => []) : Promise.resolve([]),
    isAdmin ? getLeaveAnalytics().catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <>
      <Topbar title="Leave & Holidays" subtitle="Requests, balances, approvals & holidays" />
      <PageBody>
        <LeaveWorkspace isAdmin={isAdmin} types={types} balances={balances} myRequests={myRequests} allRequests={allRequests} holidays={holidays} departments={departments} teams={teams} analytics={analytics} />
      </PageBody>
    </>
  );
}
