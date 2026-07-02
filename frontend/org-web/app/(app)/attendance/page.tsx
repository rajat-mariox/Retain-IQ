import { CalendarCheck, DoorOpen, Timer, UserCheck, UserX } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { AttendanceBadge } from "@/components/ui/badges";
import { PaginatedTable } from "@/components/ui/Pagination";
import { CheckInOut } from "@/components/attendance/CheckInOut";
import { AttendanceReports } from "@/components/attendance/AttendanceReports";
import { getAttendanceToday, getMyAttendance, getSession } from "@/lib/api";

function clock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export default async function AttendancePage() {
  const session = await getSession().catch(() => null);
  const isAdmin = Boolean(session && (session.role.permissions.includes("attendance.read") || session.role.name === "Owner"));

  if (isAdmin) {
    const today = await getAttendanceToday().catch(() => null);
    const now = new Date();
    const dayStr = now.toISOString().slice(0, 10);
    const monthStr = now.toISOString().slice(0, 7);
    return (
      <>
        <Topbar title="Attendance" subtitle="Attendance dashboard & reports" />
        <PageBody>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            <StatTile label="Present today" value={String(today?.present ?? 0)} icon={UserCheck} accent="#16a34a" />
            <StatTile label="Absent today" value={String(today?.absent ?? 0)} icon={UserX} accent="#e5484d" />
            <StatTile label="Late arrivals" value={String(today?.late ?? 0)} icon={Timer} accent="#d97706" />
            <StatTile label="Early exits" value={String(today?.earlyExits ?? 0)} icon={DoorOpen} accent="#ea580c" />
            <StatTile label="Attendance %" value={`${today?.attendanceRate ?? 0}%`} icon={CalendarCheck} accent="#0d9488" />
          </div>
          <AttendanceReports today={dayStr} month={monthStr} />
        </PageBody>
      </>
    );
  }

  const mine = await getMyAttendance().catch(() => null);
  const myToday = mine?.today ?? null;
  return (
    <>
      <Topbar title="Attendance" subtitle="Check in/out and your history" />
      <PageBody>
        <Card>
          <CardHeader title="Today" subtitle={myToday?.checkInAt ? `Checked in at ${clock(myToday.checkInAt)}` : "You haven't checked in yet"} />
          <CardBody>
            <CheckInOut checkedIn={Boolean(myToday?.checkInAt)} checkedOut={Boolean(myToday?.checkOutAt)} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Your attendance history" subtitle="Recent attendance" />
          <PaginatedTable
            minWidth="min-w-[520px]"
            head={
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Day</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">In</th>
                <th className="px-5 py-3 text-right font-medium">Out</th>
                <th className="px-5 py-3 text-right font-medium">Worked</th>
              </tr>
            }
            empty={
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No attendance yet.</td>
              </tr>
            }
            rows={(mine?.history ?? []).map((r) => (
              <tr key={r.id} className="border-b border-hairline/60 last:border-0">
                <td className="px-5 py-3 tabular-nums text-slate-700">{r.day.slice(0, 10)}</td>
                <td className="px-5 py-3"><AttendanceBadge status={r.status} /></td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{clock(r.checkInAt)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{clock(r.checkOutAt)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                  {r.workMinutes > 0 ? `${Math.floor(r.workMinutes / 60)}h ${r.workMinutes % 60}m` : "—"}
                </td>
              </tr>
            ))}
          />
        </Card>
      </PageBody>
    </>
  );
}
