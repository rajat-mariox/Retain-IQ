"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";

interface MonthPoint { month: string; approvedMinutes: number }
interface EmpRow { employeeId: string; name: string; department: string | null; approvedMinutes: number; measuredMinutes: number }
interface Trends { months: number; from: string; to: string; totalApprovedMinutes: number; byMonth: MonthPoint[]; byEmployee: EmpRow[] }

function hm(min: number): string {
  if (min <= 0) return "0h";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function monthShort(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

export function OvertimeTrends() {
  const [data, setData] = useState<Trends | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/attendance/overtime/trends?months=6`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Trends | null) => setData(d && Array.isArray(d.byMonth) ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const byMonth = data?.byMonth ?? [];
  const peak = Math.max(1, ...byMonth.map((m) => m.approvedMinutes));
  const top = (data?.byEmployee ?? []).slice(0, 8);
  const topPeak = Math.max(1, ...top.map((e) => e.approvedMinutes));

  return (
    <Card>
      <CardHeader
        title="Overtime trends"
        subtitle="Approved overtime over the last 6 months"
        action={<span className="inline-flex items-center gap-1.5 text-sm text-slate-500"><Timer className="size-4" /> {hm(data?.totalApprovedMinutes ?? 0)} total</span>}
      />
      <div className={`p-4 ${loading ? "opacity-50 transition-opacity" : "transition-opacity"}`}>
        {byMonth.length === 0 || (data?.totalApprovedMinutes ?? 0) === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">{loading ? "Loading…" : "No approved overtime in this window."}</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Per-month column chart */}
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">By month</p>
              <div className="flex h-40 items-end gap-2">
                {byMonth.map((m) => {
                  const pct = Math.round((m.approvedMinutes / peak) * 100);
                  return (
                    <div key={m.month} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="text-[10px] font-medium tabular-nums text-slate-500">{m.approvedMinutes > 0 ? hm(m.approvedMinutes) : ""}</span>
                      <div className="flex w-full flex-1 items-end">
                        <div className="w-full rounded-t bg-indigo-500/80" style={{ height: `${Math.max(pct, m.approvedMinutes > 0 ? 4 : 0)}%` }} title={`${m.month}: ${hm(m.approvedMinutes)}`} />
                      </div>
                      <span className="text-[10px] text-slate-400">{monthShort(m.month)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top employees by approved OT */}
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Top employees</p>
              {top.length === 0 ? (
                <p className="text-sm text-slate-500">Nobody logged approved overtime.</p>
              ) : (
                <ul className="space-y-2">
                  {top.map((e) => (
                    <li key={e.employeeId} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 truncate text-sm text-slate-700" title={e.name}>{e.name}</span>
                      <span className="block h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
                        <span className="block h-full rounded-full bg-indigo-500/80" style={{ width: `${Math.round((e.approvedMinutes / topPeak) * 100)}%` }} />
                      </span>
                      <span className="w-16 shrink-0 text-right text-xs font-medium tabular-nums text-slate-600">{hm(e.approvedMinutes)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
