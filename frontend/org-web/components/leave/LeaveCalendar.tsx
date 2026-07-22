"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import type { LeaveCalendar as CalendarData } from "@/lib/api";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function LeaveCalendar({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const todayStr = new Date().toISOString().slice(0, 10);

  // Re-fetches on month change AND whenever refreshSignal bumps (a leave was
  // applied/cancelled/decided), so new leaves appear with their status live.
  useEffect(() => {
    setLoading(true);
    fetch(`/api/leave/calendar?month=${month}`)
      .then((r) => r.json())
      .then((d: CalendarData) => setData(d))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [month, refreshSignal]);

  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const workingSet = new Set(data?.workingDays ?? [1, 2, 3, 4, 5]);
  const holidayByDate = new Map((data?.holidays ?? []).map((h) => [h.date, h]));
  const leaveByDate = new Map((data?.leaves ?? []).map((l) => [l.date, l]));

  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <Card>
      <CardHeader
        title="My calendar"
        subtitle={data?.shiftName ? `Week-offs from your shift · ${data.shiftName}` : "Working days, holidays & leave"}
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
          {DOW.map((d, i) => (
            <div key={d} className={`pb-1 text-center text-[11px] font-semibold uppercase tracking-wide ${workingSet.has(i) ? "text-slate-500" : "text-slate-400"}`}>{d}</div>
          ))}
          {cells.map((day, idx) => {
            if (day === null) return <div key={`e${idx}`} />;
            const dateStr = `${month}-${pad(day)}`;
            const weekday = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
            const weekOff = !workingSet.has(weekday);
            const holiday = holidayByDate.get(dateStr);
            const leave = leaveByDate.get(dateStr);
            const isToday = dateStr === todayStr;

            let bg = "bg-panel";
            if (holiday) bg = "bg-rose-50 ring-1 ring-inset ring-rose-100";
            else if (leave) bg = leave.status === "APPROVED" ? "bg-emerald-50 ring-1 ring-inset ring-emerald-100" : "bg-amber-50 ring-1 ring-inset ring-amber-100";
            else if (weekOff) bg = "bg-slate-50";

            return (
              <div key={dateStr} className={`relative flex min-h-[64px] flex-col gap-1 rounded-lg border border-hairline/70 p-1.5 ${bg} ${loading ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between">
                  <span className={`text-xs font-medium ${weekOff && !holiday && !leave ? "text-slate-400" : "text-slate-700"} ${isToday ? "grid size-5 place-items-center rounded-full bg-brand text-white" : ""}`}>{day}</span>
                  {weekOff && !holiday ? <span className="text-[9px] font-medium uppercase text-slate-400">off</span> : null}
                </div>
                {holiday ? <span className="truncate text-[10px] font-medium text-rose-700" title={holiday.name}>{holiday.name}</span> : null}
                {leave ? (
                  <span className="inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${leave.color ?? "#64748b"}20`, color: leave.color ?? "#475569" }} title={`${leave.typeName} (${leave.status.toLowerCase()})`}>
                    {leave.code}{leave.status === "PENDING" ? " ·?" : ""}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
          <Legend cls="bg-slate-100" label="Week-off" />
          <Legend cls="bg-rose-100" label="Holiday" />
          <Legend cls="bg-emerald-100" label="On leave" />
          <Legend cls="bg-amber-100" label="Leave pending" />
          <span className="inline-flex items-center gap-1.5"><span className="grid size-3 place-items-center rounded-full bg-brand text-[8px] text-white" /> Today</span>
        </div>
      </div>
    </Card>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-3 rounded ${cls} ring-1 ring-inset ring-black/5`} />
      {label}
    </span>
  );
}
