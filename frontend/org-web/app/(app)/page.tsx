import { CalendarCheck, CreditCard, UserCheck, Users } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { AttendanceBadge } from "@/components/ui/badges";
import { CheckInOut } from "@/components/attendance/CheckInOut";
import { getAttendanceToday, getBilling, getMyAttendance } from "@/lib/api";
import { formatCompact } from "@/lib/format";

function clock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export default async function DashboardPage() {
  const [today, billing, mine] = await Promise.all([
    getAttendanceToday().catch(() => null),
    getBilling().catch(() => null),
    getMyAttendance().catch(() => null),
  ]);

  const myToday = mine?.today ?? null;
  const checkedIn = Boolean(myToday?.checkInAt);
  const checkedOut = Boolean(myToday?.checkOutAt);
  const planName = billing?.subscription?.planName ?? "Free";

  return (
    <>
      <Topbar title="Dashboard" subtitle="Your organization at a glance" />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Employees" value={formatCompact(today?.totalEmployees ?? 0)} icon={Users} accent="#1f883d" />
          <StatTile label="Present today" value={formatCompact(today?.checkedIn ?? 0)} icon={UserCheck} accent="#16a34a" />
          <StatTile label="Attendance rate" value={`${today?.attendanceRate ?? 0}%`} icon={CalendarCheck} accent="#0d9488" />
          <StatTile label="Current plan" value={planName} icon={CreditCard} accent="#166534" />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-1">
            <CardHeader title="Your attendance" subtitle="Today" />
            <CardBody className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Status</span>
                <AttendanceBadge status={myToday?.status ?? null} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Checked in</span>
                <span className="tabular-nums text-sm font-medium text-slate-900">{clock(myToday?.checkInAt ?? null)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Checked out</span>
                <span className="tabular-nums text-sm font-medium text-slate-900">{clock(myToday?.checkOutAt ?? null)}</span>
              </div>
              <div className="pt-1">
                <CheckInOut checkedIn={checkedIn} checkedOut={checkedOut} />
              </div>
            </CardBody>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader title="Team attendance" subtitle="Today across your organization" />
            <div className="grid grid-cols-2 divide-x divide-y divide-hairline/70 sm:grid-cols-4 sm:divide-y-0">
              <TeamStat label="Present" value={today?.present ?? 0} tone="text-emerald-700" />
              <TeamStat label="Late" value={today?.late ?? 0} tone="text-amber-700" />
              <TeamStat label="Absent" value={today?.absent ?? 0} tone="text-rose-700" />
              <TeamStat label="On leave" value={today?.onLeave ?? 0} tone="text-sky-700" />
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Your recent attendance" subtitle="Last 14 days" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Day</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">In</th>
                  <th className="px-5 py-3 text-right font-medium">Out</th>
                  <th className="px-5 py-3 text-right font-medium">Worked</th>
                </tr>
              </thead>
              <tbody>
                {(mine?.history ?? []).map((r) => (
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
                {(mine?.history ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No attendance yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>
    </>
  );
}

function TeamStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="px-5 py-5">
      <p className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}
