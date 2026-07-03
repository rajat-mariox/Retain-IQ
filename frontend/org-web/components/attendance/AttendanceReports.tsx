"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { AttendanceBadge } from "@/components/ui/badges";
import type { DailyReport, DepartmentReport, MonthlyReport } from "@/lib/api";

type Tab = "daily" | "monthly" | "department";
const TABS: { key: Tab; label: string }[] = [
  { key: "daily", label: "Daily Attendance" },
  { key: "monthly", label: "Monthly Attendance" },
  { key: "department", label: "Department Attendance" },
];

const inputCls = "rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm text-slate-900 focus:border-brand focus:outline-none";

function clock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}
function worked(min: number): string {
  return min > 0 ? `${Math.floor(min / 60)}h ${min % 60}m` : "—";
}

export function AttendanceReports({ today, month }: { today: string; month: string }) {
  const [tab, setTab] = useState<Tab>("daily");
  const [day, setDay] = useState(today);
  const [mon, setMon] = useState(month);
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [monthly, setMonthly] = useState<MonthlyReport | null>(null);
  const [dept, setDept] = useState<DepartmentReport | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchJson = useCallback(async (url: string) => {
    setLoading(true);
    try {
      const r = await fetch(url);
      return await r.json();
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "daily") fetchJson(`/api/attendance/report/daily?day=${day}`).then(setDaily);
  }, [tab, day, fetchJson]);
  useEffect(() => {
    if (tab === "monthly") fetchJson(`/api/attendance/report/monthly?month=${mon}`).then(setMonthly);
  }, [tab, mon, fetchJson]);
  useEffect(() => {
    if (tab === "department") fetchJson(`/api/attendance/report/department?day=${day}`).then(setDept);
  }, [tab, day, fetchJson]);

  return (
    <Card>
      <CardHeader
        title="Reports"
        subtitle="Attendance breakdowns"
        action={
          tab === "monthly" ? (
            <input type="month" className={inputCls} value={mon} onChange={(e) => setMon(e.target.value)} />
          ) : (
            <input type="date" className={inputCls} value={day} onChange={(e) => setDay(e.target.value)} />
          )
        }
      />
      <div className="flex flex-wrap gap-x-1 border-b border-hairline px-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${tab === t.key ? "border-brand text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
        {tab === "daily" ? <DailyTable data={daily} /> : null}
        {tab === "monthly" ? <MonthlyTable data={monthly} /> : null}
        {tab === "department" ? <DeptTable data={dept} /> : null}
      </div>
    </Card>
  );
}

function SummaryStrip({ s }: { s: { present: number; late: number; earlyExits: number; absent: number; onLeave: number; weeklyOff: number; attendanceRate: number } }) {
  const items = [
    ["Present", s.present, "text-emerald-700"],
    ["Late", s.late, "text-amber-700"],
    ["Early exits", s.earlyExits, "text-orange-700"],
    ["Absent", s.absent, "text-rose-700"],
    ["On leave", s.onLeave, "text-sky-700"],
    ["Weekly off", s.weeklyOff, "text-slate-500"],
    ["Rate", `${s.attendanceRate}%`, "text-slate-800"],
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-px border-b border-hairline bg-hairline/60 sm:grid-cols-7">
      {items.map(([label, value, cls]) => (
        <div key={label} className="bg-panel px-4 py-3 text-center">
          <p className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</p>
          <p className="text-[11px] text-slate-500">{label}</p>
        </div>
      ))}
    </div>
  );
}

function DailyTable({ data }: { data: DailyReport | null }) {
  return (
    <>
      {data ? <SummaryStrip s={data.summary} /> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-slate-500">
              <th className="px-5 py-3 text-left font-medium">Employee</th>
              <th className="px-5 py-3 text-left font-medium">Department</th>
              <th className="px-5 py-3 text-left font-medium">Status</th>
              <th className="px-5 py-3 text-right font-medium">In</th>
              <th className="px-5 py-3 text-right font-medium">Out</th>
              <th className="px-5 py-3 text-right font-medium">Break</th>
              <th className="px-5 py-3 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.employeeId} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-900">{r.name}</td>
                <td className="px-5 py-3 text-slate-600">{r.department ?? "—"}</td>
                <td className="px-5 py-3">
                  <AttendanceBadge status={r.status} />
                  {r.earlyExit ? <span className="ml-1.5 rounded bg-orange-50 px-1.5 py-0.5 text-[11px] font-medium text-orange-700 ring-1 ring-inset ring-orange-200">early exit</span> : null}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{clock(r.checkInAt)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{clock(r.checkOutAt)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-500">{r.breakMinutes > 0 ? worked(r.breakMinutes) : "—"}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-700" title={`Gross ${worked(r.workMinutes)}`}>{worked(r.netWorkMinutes)}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-500">No employees.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MonthlyTable({ data }: { data: MonthlyReport | null }) {
  return (
    <>
      {data ? <p className="border-b border-hairline px-5 py-2.5 text-xs text-slate-500">{data.month} · working days are counted per each employee's shift</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-slate-500">
              <th className="px-5 py-3 text-left font-medium">Employee</th>
              <th className="px-5 py-3 text-left font-medium">Department</th>
              <th className="px-5 py-3 text-right font-medium">Working days</th>
              <th className="px-5 py-3 text-right font-medium">Present</th>
              <th className="px-5 py-3 text-right font-medium">Late</th>
              <th className="px-5 py-3 text-right font-medium">Absent</th>
              <th className="px-5 py-3 text-right font-medium">Leave</th>
              <th className="px-5 py-3 text-right font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.employeeId} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-900">{r.name}</td>
                <td className="px-5 py-3 text-slate-600">{r.department ?? "—"}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-500">{r.workingDays}</td>
                <td className="px-5 py-3 text-right tabular-nums text-emerald-700">{r.present}</td>
                <td className="px-5 py-3 text-right tabular-nums text-amber-700">{r.late}</td>
                <td className="px-5 py-3 text-right tabular-nums text-rose-700">{r.absent}</td>
                <td className="px-5 py-3 text-right tabular-nums text-sky-700">{r.onLeave}</td>
                <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-800">{r.attendanceRate}%</td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? <tr><td colSpan={8} className="px-5 py-8 text-center text-sm text-slate-500">No employees.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DeptTable({ data }: { data: DepartmentReport | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="border-b border-hairline text-xs text-slate-500">
            <th className="px-5 py-3 text-left font-medium">Department</th>
            <th className="px-5 py-3 text-right font-medium">Headcount</th>
            <th className="px-5 py-3 text-right font-medium">Present</th>
            <th className="px-5 py-3 text-right font-medium">Late</th>
            <th className="px-5 py-3 text-right font-medium">Absent</th>
            <th className="px-5 py-3 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody>
          {(data?.departments ?? []).map((d) => (
            <tr key={d.departmentId ?? "none"} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
              <td className="px-5 py-3 font-medium text-slate-900">{d.name}</td>
              <td className="px-5 py-3 text-right tabular-nums text-slate-600">{d.total}</td>
              <td className="px-5 py-3 text-right tabular-nums text-emerald-700">{d.present}</td>
              <td className="px-5 py-3 text-right tabular-nums text-amber-700">{d.late}</td>
              <td className="px-5 py-3 text-right tabular-nums text-rose-700">{d.absent}</td>
              <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-800">{d.attendanceRate}%</td>
            </tr>
          ))}
          {data && data.departments.length === 0 ? <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">No departments.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
