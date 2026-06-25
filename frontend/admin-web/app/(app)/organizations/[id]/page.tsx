import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, CalendarOff, Gauge, Timer, UserCheck, Users, UserX, type LucideIcon } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { StatusBadge } from "@/components/ui/badges";
import { adminFetch } from "@/lib/admin-api";
import { formatCompact, formatDate, formatNumber } from "@/lib/format";
import type { OrgStatus } from "@/lib/data/types";

interface AdminEmployee {
  id: string;
  name: string;
  email: string | null;
  status: string;
  avgProductivity: number;
  activeHours: number;
  productiveHours: number;
  lastActiveDay: string | null;
  attendanceRate: number;
  daysPresent: number;
  todayStatus: string | null;
}

interface AdminAttendanceToday {
  totalEmployees: number;
  present: number;
  late: number;
  absent: number;
  onLeave: number;
  attendanceRate: number;
}

interface AdminOrgDetail {
  org: {
    id: string;
    name: string;
    slug: string;
    status: string;
    users: number;
    employees: number;
    avgProductivity: number;
    activeHours: number;
    createdAt: string;
    lastActiveAt: string | null;
  };
  employees: AdminEmployee[];
  attendanceToday: AdminAttendanceToday;
}

const ATT_TONE: Record<string, string> = {
  PRESENT: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  LATE: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  ABSENT: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
  ON_LEAVE: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
};

function AttendancePill({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const tone = ATT_TONE[status] ?? "bg-panel-2 text-slate-600 ring-hairline";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      {status.replace("_", " ").toLowerCase()}
    </span>
  );
}

const STATUS_MAP: Record<string, OrgStatus> = {
  ACTIVE: "active",
  INVITED: "trialing",
  SUSPENDED: "suspended",
  DELETED: "churned",
};

export default async function OrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data: AdminOrgDetail;
  try {
    data = await adminFetch<AdminOrgDetail>(`organizations/${id}`);
  } catch {
    notFound();
  }
  const { org, employees, attendanceToday } = data;
  const att = attendanceToday;

  return (
    <>
      <Topbar title={org.name} subtitle={`Organization · created ${formatDate(org.createdAt)}`} />
      <PageBody>
        <div className="flex items-center justify-between">
          <Link href="/organizations" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" />
            All organizations
          </Link>
          <StatusBadge status={STATUS_MAP[org.status] ?? "active"} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Users" value={formatCompact(org.users)} icon={Users} accent="#0d9488" />
          <StatTile label="Employees" value={formatCompact(org.employees)} icon={Users} accent="#1f883d" />
          <StatTile label="Avg productivity" value={org.avgProductivity > 0 ? `${org.avgProductivity}%` : "—"} icon={Gauge} accent="#16a34a" />
          <StatTile label="Active hours (30d)" value={formatCompact(org.activeHours)} icon={Activity} accent="#166534" />
        </div>

        <Card>
          <CardHeader title="Attendance · today" subtitle={`${att.attendanceRate}% checked in · ${att.totalEmployees} employees · live`} />
          <div className="grid grid-cols-2 divide-x divide-y divide-hairline/70 sm:grid-cols-4 sm:divide-y-0">
            <AttStat label="Present" value={att.present} tone="text-emerald-700" icon={UserCheck} />
            <AttStat label="Late" value={att.late} tone="text-amber-700" icon={Timer} />
            <AttStat label="Absent" value={att.absent} tone="text-rose-700" icon={UserX} />
            <AttStat label="On leave" value={att.onLeave} tone="text-sky-700" icon={CalendarOff} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Employees" subtitle={`${employees.length} in this organization · productivity & attendance · last 30 days · live`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Employee</th>
                  <th className="px-5 py-3 text-left font-medium">Today</th>
                  <th className="px-5 py-3 text-right font-medium">Attendance (30d)</th>
                  <th className="px-5 py-3 text-right font-medium">Productivity</th>
                  <th className="px-5 py-3 text-right font-medium">Active hrs</th>
                  <th className="px-5 py-3 text-right font-medium">Productive hrs</th>
                  <th className="px-5 py-3 text-right font-medium">Last active</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-panel-2 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-hairline">
                          {e.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <span className="block truncate font-medium text-slate-900">{e.name}</span>
                          {e.email ? <span className="block truncate text-xs text-slate-500">{e.email}</span> : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <AttendancePill status={e.todayStatus} />
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                      {e.daysPresent > 0 ? (
                        <>
                          {e.attendanceRate}%<span className="text-slate-400"> · {e.daysPresent}d</span>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {e.avgProductivity > 0 ? <ProductivityCell value={e.avgProductivity} /> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(e.activeHours)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(e.productiveHours)}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500">{e.lastActiveDay ?? "—"}</td>
                  </tr>
                ))}
                {employees.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-sm text-slate-500">No employees yet.</td>
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

function AttStat({ label, value, tone, icon: Icon }: { label: string; value: number; tone: string; icon: LucideIcon }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className="grid size-9 place-items-center rounded-xl bg-panel-2 text-slate-500 ring-1 ring-inset ring-hairline">
        <Icon className="size-4.5" />
      </span>
      <div>
        <p className={`text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function ProductivityCell({ value }: { value: number }) {
  const tone = value >= 80 ? "#16a34a" : value >= 65 ? "#d97706" : "#e5484d";
  return (
    <div className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-2">
        <span className="block h-full rounded-full" style={{ width: `${value}%`, backgroundColor: tone }} />
      </span>
      <span className="w-8 tabular-nums text-slate-700">{value}%</span>
    </div>
  );
}
