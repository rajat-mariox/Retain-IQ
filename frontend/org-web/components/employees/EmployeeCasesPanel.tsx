"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, ArrowUpNarrowWide } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { LocalTime } from "@/components/ui/LocalTime";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
interface Obs { id: string; source: "AI" | "MANUAL"; type: string; severity: Severity; status: string; title: string; createdAt: string }
interface Esc { id: string; title: string; severity: Severity; level: number; levelLabel: string; status: string; overdue: boolean; createdAt: string }

const SEV: Record<Severity, string> = {
  LOW: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  MEDIUM: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  HIGH: "bg-orange-500/10 text-orange-700 ring-orange-600/20",
  CRITICAL: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
};
const pill = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset";
const TYPE_LABEL: Record<string, string> = {
  PRODUCTIVITY_DROP: "Productivity drop", BURNOUT_RISK: "Burnout risk", LOW_ENGAGEMENT: "Low engagement",
  ATTENDANCE_ANOMALY: "Attendance anomaly", LATE_PATTERN: "Late pattern", BEHAVIOUR: "Behaviour", OTHER: "Other",
};
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * The "cases" tab on an employee profile — their observations and escalations
 * history. Read-only here (act on them from the Observations page); this is the
 * per-person rollup. Fetched lazily; hidden gracefully if the caller lacks reach.
 */
export function EmployeeCasesPanel({ employeeId }: { employeeId: string }) {
  const [obs, setObs] = useState<Obs[] | null>(null);
  const [esc, setEsc] = useState<Esc[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/observations?employeeId=${employeeId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setObs(d?.items ?? []); }).catch(() => { if (alive) setObs([]); });
    fetch(`/api/escalations?employeeId=${employeeId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setEsc(d?.items ?? []); }).catch(() => { if (alive) setEsc([]); });
    return () => { alive = false; };
  }, [employeeId]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Observations" subtitle="AI-detected & manually raised concerns" />
        <div className="divide-y divide-hairline/60">
          {obs === null ? <p className="px-5 py-6 text-sm text-slate-400">Loading…</p>
            : obs.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">No observations for this person.</p>
            : obs.map((o) => (
              <div key={o.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div>
                  <div className="text-sm text-slate-800">{o.title}</div>
                  <div className="text-[11px] text-slate-400">{TYPE_LABEL[o.type] ?? o.type} · {o.source === "AI" ? "AI" : "Manual"} · {cap(o.status)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`${pill} ${SEV[o.severity]}`}>{cap(o.severity)}</span>
                  <span className="text-[11px] text-slate-400"><LocalTime iso={o.createdAt} /></span>
                </div>
              </div>
            ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Escalations" subtitle="Concerns raised up the authority ladder" />
        <div className="divide-y divide-hairline/60">
          {esc === null ? <p className="px-5 py-6 text-sm text-slate-400">Loading…</p>
            : esc.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">No escalations for this person.</p>
            : esc.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div>
                  <div className="text-sm text-slate-800">{e.title}</div>
                  <div className="inline-flex items-center gap-1 text-[11px] text-slate-400"><ArrowUpNarrowWide className="size-3" /> L{e.level} · {e.levelLabel} · {cap(e.status)}{e.overdue ? <span className="text-rose-500"> · overdue</span> : null}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`${pill} ${SEV[e.severity]}`}>{cap(e.severity)}</span>
                  <ShieldAlert className="size-3.5 text-orange-400" />
                </div>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}
