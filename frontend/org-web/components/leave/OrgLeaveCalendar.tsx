"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import type { OrgDepartment, OrgLeaveCalendar as OrgCalData, OrgLeaveEntry, OrgTeam } from "@/lib/api";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const select = "rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
/** Every YYYY-MM-DD in [start,end] that falls inside the given month. */
function daysInRangeForMonth(entry: OrgLeaveEntry, month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const monthStart = Date.UTC(y, m - 1, 1);
  const monthEnd = Date.UTC(y, m, 1); // exclusive
  const [sy, sm, sd] = entry.startDate.split("-").map(Number);
  const [ey, em, ed] = entry.endDate.split("-").map(Number);
  let t = Math.max(Date.UTC(sy, sm - 1, sd), monthStart);
  const last = Math.min(Date.UTC(ey, em - 1, ed), monthEnd - 86400000);
  const out: string[] = [];
  for (; t <= last; t += 86400000) {
    const d = new Date(t);
    out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  return out;
}

export function OrgLeaveCalendar({ departments, teams }: { departments: OrgDepartment[]; teams: OrgTeam[] }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<OrgCalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [team, setTeam] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/leave/org-calendar?month=${month}`)
      .then((r) => r.json())
      .then((d: OrgCalData) => setData(d))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [month]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.entries ?? []).filter(
      (e) =>
        (!needle || e.employeeName.toLowerCase().includes(needle)) &&
        (!dept || e.departmentName === dept) &&
        (!team || e.teamName === team),
    );
  }, [data, q, dept, team]);

  // Map each in-month date → the leave entries active that day (post-filter).
  const byDate = useMemo(() => {
    const map = new Map<string, OrgLeaveEntry[]>();
    for (const e of filtered) {
      for (const d of daysInRangeForMonth(e, month)) {
        if (!map.has(d)) map.set(d, []);
        map.get(d)!.push(e);
      }
    }
    return map;
  }, [filtered, month]);

  const holidayByDate = new Map((data?.holidays ?? []).map((h) => [h.date, h]));
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const peopleOnLeaveThisMonth = new Set(filtered.map((e) => e.employeeId)).size;
  const activeDepts = departments.filter((d) => d.status !== "ARCHIVED");
  const selectedEntries = selectedDate ? (byDate.get(selectedDate) ?? []) : [];

  return (
    <div className="space-y-4">
      {/* Filter bar — mirrors the employee directory */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee…" className="w-56 rounded-lg border border-hairline bg-panel py-1.5 pl-8 pr-3 text-sm text-slate-900 focus:border-brand focus:outline-none" />
        </div>
        <select value={dept} onChange={(e) => setDept(e.target.value)} className={select}>
          <option value="">All departments</option>
          {activeDepts.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
        <select value={team} onChange={(e) => setTeam(e.target.value)} className={select}>
          <option value="">All teams</option>
          {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
        </select>
        {(q || dept || team) ? <button onClick={() => { setQ(""); setDept(""); setTeam(""); }} className="text-xs text-slate-500 hover:text-slate-800">Clear</button> : null}
        <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-slate-500"><Users className="size-4" /> {peopleOnLeaveThisMonth} on leave this month</span>
      </div>

      <Card>
        <CardHeader
          title="Org leave calendar"
          subtitle="Everyone's approved & pending leave"
          action={
            <div className="flex items-center gap-1">
              <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg border border-hairline bg-panel p-1.5 text-slate-500 hover:bg-slate-50"><ChevronLeft className="size-4" /></button>
              <span className="min-w-32 text-center text-sm font-medium text-slate-800">{monthLabel(month)}</span>
              <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg border border-hairline bg-panel p-1.5 text-slate-500 hover:bg-slate-50"><ChevronRight className="size-4" /></button>
            </div>
          }
        />
        <div className="p-4">
          <div className="grid grid-cols-7 gap-1.5">
            {DOW.map((d) => <div key={d} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">{d}</div>)}
            {cells.map((day, idx) => {
              if (day === null) return <div key={`e${idx}`} />;
              const dateStr = `${month}-${pad(day)}`;
              const holiday = holidayByDate.get(dateStr);
              const entries = byDate.get(dateStr) ?? [];
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                  className={`relative flex min-h-[84px] flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors ${isSelected ? "border-brand ring-1 ring-brand" : "border-hairline/70 hover:border-hairline"} ${holiday ? "bg-rose-50" : "bg-panel"} ${loading ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start justify-between">
                    <span className={`text-xs font-medium ${isToday ? "grid size-5 place-items-center rounded-full bg-brand text-white" : "text-slate-700"}`}>{day}</span>
                    {entries.length > 0 ? <span className="rounded-full bg-slate-900/5 px-1.5 text-[10px] font-medium tabular-nums text-slate-600">{entries.length}</span> : null}
                  </div>
                  {holiday ? <span className="truncate text-[10px] font-medium text-rose-700" title={holiday.name}>{holiday.name}</span> : null}
                  <div className="flex flex-col gap-0.5">
                    {entries.slice(0, 3).map((e) => (
                      <span key={e.id} className="inline-flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${e.color ?? "#64748b"}20`, color: e.color ?? "#475569" }} title={`${e.employeeName} · ${e.typeName} (${e.status.toLowerCase()})`}>
                        <span className="truncate">{e.employeeName.split(" ")[0]}</span>{e.status === "PENDING" ? <span className="opacity-70">?</span> : null}
                      </span>
                    ))}
                    {entries.length > 3 ? <span className="pl-1 text-[10px] text-slate-500">+{entries.length - 3} more</span> : null}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-rose-100 ring-1 ring-inset ring-black/5" /> Holiday</span>
            <span className="inline-flex items-center gap-1.5"><span className="rounded px-1 text-[9px]" style={{ backgroundColor: "#64748b20", color: "#475569" }}>Name</span> On leave</span>
            <span className="inline-flex items-center gap-1.5"><span className="opacity-70">?</span> Pending approval</span>
          </div>
        </div>
      </Card>

      {/* Selected-day detail */}
      {selectedDate ? (
        <Card>
          <CardHeader title={`On leave · ${new Date(`${selectedDate}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}`} subtitle={`${selectedEntries.length} ${selectedEntries.length === 1 ? "person" : "people"}`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-2.5 text-left font-medium">Employee</th><th className="px-5 py-2.5 text-left font-medium">Department</th><th className="px-5 py-2.5 text-left font-medium">Team</th><th className="px-5 py-2.5 text-left font-medium">Type</th><th className="px-5 py-2.5 text-left font-medium">Status</th>
              </tr></thead>
              <tbody>
                {selectedEntries.map((e) => (
                  <tr key={e.id} className="border-b border-hairline/60 last:border-0">
                    <td className="px-5 py-2.5 font-medium text-slate-900">{e.employeeName}</td>
                    <td className="px-5 py-2.5 text-slate-600">{e.departmentName ?? "—"}</td>
                    <td className="px-5 py-2.5 text-slate-600">{e.teamName ?? "—"}</td>
                    <td className="px-5 py-2.5"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ backgroundColor: e.color ?? "#64748b" }} />{e.typeName}</span></td>
                    <td className="px-5 py-2.5 text-slate-600">{e.status.toLowerCase()}</td>
                  </tr>
                ))}
                {selectedEntries.length === 0 ? <tr><td colSpan={5} className="px-5 py-6 text-center text-sm text-slate-500">Nobody on leave this day.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
