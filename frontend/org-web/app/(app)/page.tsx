import Link from "next/link";
import { Clock } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { AttendanceBadge } from "@/components/ui/badges";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { getAttendanceRoster, getExecutiveOverview, getMyAttendance, getSession } from "@/lib/api";

function clock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export default async function DashboardPage() {
  const session = await getSession().catch(() => null);
  // Admin/manager view (needs employee.read) gets the org tabs; everyone else a
  // read-only personal summary (check-in/out lives in My Time).
  const isAdmin = Boolean(session && (session.role.permissions.includes("employee.read") || session.role.name === "Owner"));

  if (isAdmin) {
    const [exec, roster] = await Promise.all([
      getExecutiveOverview().catch(() => null),
      getAttendanceRoster().catch(() => null),
    ]);
    return (
      <>
        <Topbar title="Dashboard" subtitle="Your organization at a glance" />
        <PageBody>{exec ? <DashboardTabs exec={exec} roster={roster} /> : <Empty />}</PageBody>
      </>
    );
  }

  const mine = await getMyAttendance().catch(() => null);
  const myToday = mine?.today ?? null;
  return (
    <>
      <Topbar title="Dashboard" subtitle="Your day at a glance" />
      <PageBody>
        <Card>
          <CardHeader
            title="Your attendance"
            subtitle="Today"
            action={
              <Link href="/time" className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Clock className="size-4 text-slate-500" /> My Time
              </Link>
            }
          />
          <CardBody className="space-y-4">
            <Row label="Status"><AttendanceBadge status={myToday?.status ?? null} /></Row>
            <Row label="Checked in"><span className="tabular-nums text-sm font-medium text-slate-900">{clock(myToday?.checkInAt ?? null)}</span></Row>
            <Row label="Checked out"><span className="tabular-nums text-sm font-medium text-slate-900">{clock(myToday?.checkOutAt ?? null)}</span></Row>
            <p className="text-xs text-slate-400">Check in and out from the My Time page.</p>
          </CardBody>
        </Card>

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
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.workMinutes > 0 ? `${Math.floor(r.workMinutes / 60)}h ${r.workMinutes % 60}m` : "—"}</td>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-600">{label}</span>
      {children}
    </div>
  );
}

function Empty() {
  return (
    <Card>
      <CardBody className="py-12 text-center text-sm text-slate-500">Analytics are warming up — check back once activity data is available.</CardBody>
    </Card>
  );
}
