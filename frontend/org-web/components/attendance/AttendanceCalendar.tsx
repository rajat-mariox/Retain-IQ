"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Users, CalendarRange } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";

const pad = (n: number) => String(n).padStart(2, "0");

/** One status cell's visual treatment. Empty string = future / not-yet day. */
const STATUS: Record<string, { label: string; cell: string; dot: string }> = {
  PRESENT: { label: "Present", cell: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  LATE: { label: "Late", cell: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  ABSENT: { label: "Absent", cell: "bg-rose-100 text-rose-800", dot: "bg-rose-500" },
  ON_LEAVE: { label: "On leave", cell: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  HALF_LEAVE: { label: "Half-day leave", cell: "bg-indigo-100 text-indigo-800", dot: "bg-indigo-500" },
  HOLIDAY: { label: "Holiday", cell: "bg-violet-100 text-violet-800", dot: "bg-violet-500" },
  WEEKLY_OFF: { label: "Weekly off", cell: "bg-slate-100 text-slate-400", dot: "bg-slate-300" },
};
const GLYPH: Record<string, string> = {
  PRESENT: "P", LATE: "L", ABSENT: "A", ON_LEAVE: "V", HALF_LEAVE: "½", HOLIDAY: "H", WEEKLY_OFF: "·",
};

interface Cell { date: string; status: string }
interface Row { employeeId: string; name: string; department: string | null; cells: Cell[] }
interface CalData { month: string; days: string[]; rows: Row[] }

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
/** Sun/Mon/... single-letter header + the day-of-month, for a YYYY-MM-DD. */
function dayHeader(date: string): { dow: string; dom: string; weekend: boolean } {
  const d = new Date(`${date}T00:00:00Z`);
  const wd = d.getUTCDay();
  return { dow: "SMTWTFS"[wd], dom: String(d.getUTCDate()), weekend: wd === 0 || wd === 6 };
}

export function AttendanceCalendar() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<CalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/attendance/calendar?month=${month}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CalData | null) => setData(d && Array.isArray(d.rows) ? d : { month, days: [], rows: [] }))
      .catch(() => setData({ month, days: [], rows: [] }))
      .finally(() => setLoading(false));
  }, [month]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.rows ?? []) if (r.department) set.add(r.department);
    return [...set].sort();
  }, [data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (r) => (!needle || r.name.toLowerCase().includes(needle)) && (!dept || r.department === dept),
    );
  }, [data, q, dept]);

  // "Out this week": anyone ON_LEAVE / HALF_LEAVE on a day within the current
  // Mon–Sun week that also falls in the shown month.
  const outThisWeek = useMemo(() => {
    const now = new Date();
    const dow = (now.getUTCDay() + 6) % 7; // 0 = Monday
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
    const weekKeys = new Set<string>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime() + i * 86400000);
      weekKeys.add(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
    }
    const out: { name: string; days: string[] }[] = [];
    for (const r of rows) {
      const days = r.cells.filter((c) => weekKeys.has(c.date) && (c.status === "ON_LEAVE" || c.status === "HALF_LEAVE")).map((c) => c.date);
      if (days.length > 0) out.push({ name: r.name, days });
    }
    return out;
  }, [rows]);

  const days = data?.days ?? [];
  const selectCls = "rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Attendance calendar"
          subtitle="Every person's day-by-day status across the month"
          action={
            <div className="flex items-center gap-1">
              <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg border border-hairline bg-panel p-1.5 text-slate-500 hover:bg-slate-50"><ChevronLeft className="size-4" /></button>
              <span className="min-w-32 text-center text-sm font-medium text-slate-800">{monthLabel(month)}</span>
              <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg border border-hairline bg-panel p-1.5 text-slate-500 hover:bg-slate-50"><ChevronRight className="size-4" /></button>
            </div>
          }
        />

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee…" className="w-52 rounded-lg border border-hairline bg-panel py-1.5 pl-8 pr-3 text-sm text-slate-900 focus:border-brand focus:outline-none" />
          </div>
          <select value={dept} onChange={(e) => setDept(e.target.value)} className={selectCls}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {(q || dept) ? <button onClick={() => { setQ(""); setDept(""); }} className="text-xs text-slate-500 hover:text-slate-800">Clear</button> : null}
          <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-slate-500"><Users className="size-4" /> {rows.length} {rows.length === 1 ? "person" : "people"}</span>
        </div>

        {/* Matrix: sticky employee column + one column per day */}
        <div className={`overflow-x-auto ${loading ? "opacity-50 transition-opacity" : "transition-opacity"}`}>
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-hairline bg-panel px-4 py-2 text-left text-xs font-medium text-slate-500">Employee</th>
                {days.map((d) => {
                  const h = dayHeader(d);
                  const isToday = d === todayStr;
                  return (
                    <th key={d} className={`border-b border-hairline px-0 py-2 text-center text-[10px] font-medium ${h.weekend ? "bg-slate-50 text-slate-400" : "text-slate-500"}`}>
                      <div className={`mx-auto flex size-6 flex-col items-center justify-center leading-none ${isToday ? "rounded-full bg-brand text-white" : ""}`}>
                        <span className="text-[8px] opacity-70">{h.dow}</span>
                        <span className="tabular-nums">{h.dom}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId} className="hover:bg-slate-50/60">
                  <td className="sticky left-0 z-10 whitespace-nowrap border-b border-hairline/60 bg-panel px-4 py-2">
                    <div className="font-medium text-slate-900">{r.name}</div>
                    {r.department ? <div className="text-[11px] text-slate-400">{r.department}</div> : null}
                  </td>
                  {r.cells.map((c) => {
                    const s = STATUS[c.status];
                    return (
                      <td key={c.date} className="border-b border-hairline/60 px-0.5 py-1 text-center">
                        {s ? (
                          <span className={`mx-auto grid size-6 place-items-center rounded text-[10px] font-semibold ${s.cell}`} title={`${c.date} · ${s.label}`}>
                            {GLYPH[c.status] ?? "?"}
                          </span>
                        ) : (
                          <span className="mx-auto block size-6" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={days.length + 1} className="px-5 py-10 text-center text-sm text-slate-500">{loading ? "Loading…" : "No employees in range."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-hairline px-4 py-3 text-[11px] text-slate-500">
          {Object.entries(STATUS).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={`grid size-4 place-items-center rounded text-[9px] font-semibold ${v.cell}`}>{GLYPH[k]}</span>
              {v.label}
            </span>
          ))}
        </div>
      </Card>

      {/* Who's out this week */}
      <Card>
        <CardHeader title="Out this week" subtitle="People on approved leave in the current Mon–Sun week" />
        <div className="p-4">
          {outThisWeek.length === 0 ? (
            <p className="inline-flex items-center gap-2 text-sm text-slate-500"><CalendarRange className="size-4" /> Everyone's in this week.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {outThisWeek.map((o) => (
                <li key={o.name} className="inline-flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-1.5 text-sm text-sky-800 ring-1 ring-inset ring-sky-100">
                  <span className="font-medium">{o.name}</span>
                  <span className="tabular-nums text-sky-600">{o.days.length} {o.days.length === 1 ? "day" : "days"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
