"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Gauge, Camera, Clock, Plane, Lock, Wallet } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { LocalTime } from "@/components/ui/LocalTime";

interface Data {
  window: { from: string; to: string };
  authorizedSections: string[];
  attendance?: { presentDays: number; lateDays: number; absentDays: number; leaveDays: number; attendanceRate: number; workHours: number; overtimeHours: number; avgLateMinutes: number; earlyExits: number };
  productivity?: { trackedDays: number; activeHours: number; idleHours: number; avgProductivity: number; avgFocus: number };
  monitoring?: { screenshotCount: number; lastCapturedAt: string | null };
  timesheets?: { loggedHours: number; billableHours: number; utilization: number };
  leave?: { daysTakenThisYear: number; pendingRequests: number };
  compensation?: { onFile: boolean; currency: string; unit: string; costRate: number | string | null; masked: boolean; effectiveFrom: string | null };
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-panel p-3">
      <p className="text-lg font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="text-xs font-medium text-slate-600">{label}</p>
      {sub ? <p className="text-[11px] text-slate-400">{sub}</p> : null}
    </div>
  );
}
function Section({ icon: Icon, title, children }: { icon: typeof Gauge; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-700"><Icon className="size-4 text-slate-400" /> {title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>
    </div>
  );
}

/**
 * Employee 360 — an aggregated, server-authorization-filtered snapshot of the
 * employee's operational data. Only the sections the backend returns (the caller
 * is authorized for) are shown; the rest are hidden. The frontend never receives
 * data the actor can't see.
 */
export function Employee360Panel({ employeeId }: { employeeId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/employees/${employeeId}/360`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [employeeId]);

  const a = data?.attendance, p = data?.productivity, m = data?.monitoring, t = data?.timesheets, l = data?.leave, c = data?.compensation;
  const hidden = data ? ["attendance", "productivity", "monitoring", "timesheets", "leave"].filter((s) => !data.authorizedSections.includes(s)) : [];

  return (
    <Card>
      <CardHeader title="360 overview" subtitle={data ? `Aggregated across services · ${data.window.from} → ${data.window.to}` : "Attendance, productivity, monitoring & more"} />
      <div className="space-y-5 p-4">
        {loading ? <p className="py-6 text-center text-sm text-slate-500">Loading…</p> : null}
        {!loading && !data ? <p className="py-6 text-center text-sm text-slate-500">No data available.</p> : null}

        {a ? (
          <Section icon={CalendarCheck} title="Attendance">
            <Stat label="Attendance rate" value={`${a.attendanceRate}%`} sub={`${a.presentDays}P · ${a.lateDays}L · ${a.absentDays}A`} />
            <Stat label="Work hours" value={`${a.workHours}h`} sub={a.overtimeHours ? `+${a.overtimeHours}h OT` : undefined} />
            <Stat label="Leave days" value={String(a.leaveDays)} />
            <Stat label="Avg late" value={a.avgLateMinutes ? `${a.avgLateMinutes}m` : "—"} sub={a.earlyExits ? `${a.earlyExits} early exits` : undefined} />
          </Section>
        ) : null}

        {p ? (
          <Section icon={Gauge} title="Productivity">
            <Stat label="Productivity" value={`${p.avgProductivity}%`} />
            <Stat label="Focus" value={`${p.avgFocus}%`} />
            <Stat label="Active hours" value={`${p.activeHours}h`} sub={`${p.idleHours}h idle`} />
            <Stat label="Tracked days" value={String(p.trackedDays)} />
          </Section>
        ) : null}

        {t ? (
          <Section icon={Clock} title="Timesheets">
            <Stat label="Logged" value={`${t.loggedHours}h`} />
            <Stat label="Billable" value={`${t.billableHours}h`} />
            <Stat label="Utilization" value={`${t.utilization}%`} />
          </Section>
        ) : null}

        {m ? (
          <Section icon={Camera} title="Monitoring">
            <Stat label="Screenshots" value={String(m.screenshotCount)} sub="in window" />
            <div className="col-span-2 rounded-xl border border-hairline bg-panel p-3">
              <p className="text-xs font-medium text-slate-600">Last capture</p>
              <p className="text-sm text-slate-800">{m.lastCapturedAt ? <LocalTime iso={m.lastCapturedAt} /> : "—"}</p>
            </div>
          </Section>
        ) : null}

        {l ? (
          <Section icon={Plane} title="Leave">
            <Stat label="Taken this year" value={String(l.daysTakenThisYear)} />
            <Stat label="Pending requests" value={String(l.pendingRequests)} />
          </Section>
        ) : null}

        {c ? (
          <Section icon={Wallet} title="Compensation">
            <div className="col-span-2 rounded-xl border border-hairline bg-panel p-3">
              <p className="text-xs font-medium text-slate-600">Cost rate {c.masked ? <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400"><Lock className="size-2.5" /> restricted</span> : null}</p>
              {c.onFile ? (
                <p className="text-lg font-semibold tabular-nums text-slate-900">
                  {c.masked ? <span className="tracking-widest text-slate-400">{String(c.costRate)}</span> : `${c.currency} ${(Number(c.costRate) / 100).toFixed(2)}`}
                  <span className="ml-1 text-xs font-normal text-slate-400">{c.currency} · {c.unit}</span>
                </p>
              ) : <p className="text-sm text-slate-500">Not on file</p>}
              {c.masked && c.onFile ? <p className="text-[11px] text-slate-400">You don't have payroll access — the amount is hidden.</p> : c.effectiveFrom ? <p className="text-[11px] text-slate-400">Effective {c.effectiveFrom}</p> : null}
            </div>
          </Section>
        ) : null}

        {hidden.length > 0 ? (
          <p className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
            <Lock className="size-3.5" /> {hidden.length} section{hidden.length > 1 ? "s" : ""} hidden — you don't have permission to view {hidden.join(", ")}.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
