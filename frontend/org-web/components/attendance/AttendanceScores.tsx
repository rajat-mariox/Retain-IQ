"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Users, ShieldAlert, HeartPulse, CalendarX, ArrowDownRight, ArrowUpRight, Info, Search, Download, MoreVertical, UserRound, NotebookPen, Loader2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { PaginatedTable } from "@/components/ui/Pagination";
import { Avatar } from "@/components/ui/Avatar";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { downloadCsv } from "@/lib/export";

type RiskLevel = "low" | "medium" | "high" | "critical";
interface ScoreRow {
  employeeId: string;
  name: string;
  department: string | null;
  scheduledDays: number;
  presentDays: number;
  lateDays: number;
  leaveDays: number;
  absentDays: number;
  avgLateMinutes: number;
  hasData: boolean;
  attendanceRate: number;
  punctuality: number | null;
  consistency: number | null;
  score: number;
  grade: string;
  risk: RiskLevel;
  reason: string;
}
interface Distribution {
  excellent: number; good: number; fair: number; needsAttention: number;
  excellentPct: number; goodPct: number; fairPct: number; needsAttentionPct: number;
}
interface Scores {
  months: number;
  from: string;
  to: string;
  summary: {
    employees: number; avgScore: number; avgAttendanceRate: number; avgDaysMissed: number;
    atRisk: number; risk: Record<RiskLevel, number>; distribution: Distribution;
    deltaScore: number; deltaDaysMissed: number;
  };
  rows: ScoreRow[];
}

// Status = risk level. Reserved status colours, always shown WITH the word +
// a one-line reason — never colour alone.
const RISK_STYLE: Record<RiskLevel, { pill: string; label: string }> = {
  low: { pill: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20", label: "On track" },
  medium: { pill: "bg-amber-500/10 text-amber-700 ring-amber-600/20", label: "Watch" },
  high: { pill: "bg-orange-500/10 text-orange-700 ring-orange-600/20", label: "At risk" },
  critical: { pill: "bg-rose-500/10 text-rose-700 ring-rose-600/20", label: "Critical" },
};

// A 0–100 score's band → the same four-step ramp the ring uses. Fixed CSS vars
// so light/dark stay in step; each always sits beside its number (secondary encoding).
function bandBar(v: number): string {
  if (v >= 85) return "bg-[var(--score-excellent,#059669)]";
  if (v >= 70) return "bg-[var(--score-good,#65a30d)]";
  if (v >= 55) return "bg-[var(--score-fair,#f59e0b)]";
  return "bg-[var(--score-poor,#f43f5e)]";
}

const GRADE_STYLE: Record<string, string> = {
  Excellent: "text-emerald-700",
  Good: "text-lime-700",
  Fair: "text-amber-700",
  "Needs attention": "text-rose-700",
  "No check-ins": "text-slate-400",
};

/** A 0–100 bar + number. "—" for a missing (null) pillar. */
function ScoreBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-sm text-slate-300" title="Not enough attendance to measure yet">—</span>;
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-9 text-sm font-medium tabular-nums text-slate-700">{value}</span>
      <span className="block h-1.5 w-20 overflow-hidden rounded-full bg-panel-2">
        <span className={`block h-full rounded-full ${bandBar(value)}`} style={{ width: `${Math.max(3, value)}%` }} />
      </span>
    </div>
  );
}

// A header cell with an on-hover plain-English explanation.
function Th({ children, hint, align = "left" }: { children: React.ReactNode; hint: string; align?: "left" | "right" }) {
  return (
    <th className={`px-5 py-3 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <span className="inline-flex items-center gap-1" title={hint}>
        {children}
        <Info className="size-3 text-slate-300" />
      </span>
    </th>
  );
}

// Row's risk → the observation severity a note inherits by default.
const RISK_TO_SEVERITY: Record<RiskLevel, "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"> = {
  low: "LOW", medium: "MEDIUM", high: "HIGH", critical: "CRITICAL",
};

/** Per-row ⋮ menu: jump to the person's profile, or add a note about them. */
function RowActions({ row, canNote, onNote }: { row: ScoreRow; canNote: boolean; onNote: (r: ScoreRow) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative flex justify-end">
      <button onClick={() => setOpen((o) => !o)} aria-label="Row actions" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
        <MoreVertical className="size-4" />
      </button>
      {open ? (
        <div className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-xl border border-hairline bg-panel py-1 shadow-lg">
          <Link href={`/employees/${row.employeeId}`} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <UserRound className="size-4 text-slate-400" /> View profile
          </Link>
          {canNote ? (
            <button onClick={() => { setOpen(false); onNote(row); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <NotebookPen className="size-4 text-slate-400" /> Add note
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A summary card with an optional signed delta chip (absolute units, not %). */
function SummaryCard({
  icon: Icon, label, value, sub, accent, delta, deltaGoodWhenDown,
}: {
  icon: typeof Users; label: string; value: string; sub?: string; accent: string;
  delta?: number; deltaGoodWhenDown?: boolean;
}) {
  const showDelta = delta !== undefined && delta !== 0;
  // "Good" = green chip. For most metrics up is good; for days-missed, down is good.
  const good = showDelta ? (deltaGoodWhenDown ? delta! < 0 : delta! > 0) : true;
  const down = (delta ?? 0) < 0;
  return (
    <div className="rounded-2xl border border-hairline bg-panel/70 p-5">
      <div className="flex items-center justify-between">
        <span className="grid size-9 place-items-center rounded-xl ring-1 ring-inset" style={{ backgroundColor: `${accent}1f`, color: accent, borderColor: `${accent}33` }}>
          <Icon className="size-4.5" strokeWidth={2} />
        </span>
        {showDelta ? (
          <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ${good ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-700"}`}>
            {down ? <ArrowDownRight className="size-3" /> : <ArrowUpRight className="size-3" />}
            {Math.abs(delta!)}
          </span>
        ) : null}
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs font-medium text-slate-600">{label}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-400">{sub}</p> : null}
    </div>
  );
}

export function AttendanceScores({ canNote = false }: { canNote?: boolean }) {
  const [data, setData] = useState<Scores | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState<"" | RiskLevel>("");
  // Add-note modal state.
  const [noteFor, setNoteFor] = useState<ScoreRow | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMsg, setNoteMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function openNote(r: ScoreRow) {
    setNoteFor(r);
    setNoteText("");
    setNoteMsg(null);
  }
  async function submitNote() {
    if (!noteFor || !noteText.trim()) return;
    setNoteBusy(true); setNoteMsg(null);
    const res = await fetch(`/api/observations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: noteFor.employeeId,
        type: "ATTENDANCE_ANOMALY",
        severity: RISK_TO_SEVERITY[noteFor.risk],
        title: `Attendance note — ${noteFor.name}`,
        detail: noteText.trim(),
      }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setNoteMsg({ kind: "err", text: d.error ?? "Could not save the note." });
    } else {
      setNoteMsg({ kind: "ok", text: "Note saved as an observation." });
      setTimeout(() => setNoteFor(null), 900);
    }
    setNoteBusy(false);
  }

  useEffect(() => {
    setLoading(true);
    fetch(`/api/attendance/scores?months=3`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Scores | null) => setData(d && Array.isArray(d.rows) ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const s = data?.summary;
  const dist = s?.distribution;

  const departments = useMemo(
    () => [...new Set((data?.rows ?? []).map((r) => r.department).filter(Boolean))] as string[],
    [data],
  );
  const filtered = useMemo(() => {
    let rows = data?.rows ?? [];
    if (q.trim()) rows = rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
    if (dept) rows = rows.filter((r) => r.department === dept);
    if (status) rows = rows.filter((r) => r.risk === status);
    return rows;
  }, [data, q, dept, status]);

  function exportCsv() {
    const rows = filtered.map((r) => ({
      Employee: r.name, Department: r.department ?? "", "Health score": r.score, Grade: r.grade,
      "Show-up": r.attendanceRate, Punctuality: r.punctuality ?? "", Consistency: r.consistency ?? "",
      "Days missed": r.absentDays, "Avg late (min)": r.lateDays > 0 ? r.avgLateMinutes : "",
      Status: RISK_STYLE[r.risk].label, Reason: r.reason,
    }));
    downloadCsv("attendance-scores.csv", rows);
  }

  const selectCls = "rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-700 focus:border-brand focus:outline-none";

  return (
    <div className="space-y-4">
      {/* Summary row: distribution bar (wide) + four stat cards */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className="rounded-2xl border border-hairline bg-panel/70 p-5">
          <p className="text-xs font-medium text-slate-600">Health score distribution</p>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-panel-2">
            {dist && s!.employees > 0 ? (
              <>
                {dist.excellentPct > 0 ? <span style={{ width: `${dist.excellentPct}%` }} className="bg-[var(--score-excellent,#059669)]" /> : null}
                {dist.goodPct > 0 ? <span style={{ width: `${dist.goodPct}%` }} className="bg-[var(--score-good,#65a30d)]" /> : null}
                {dist.fairPct > 0 ? <span style={{ width: `${dist.fairPct}%` }} className="bg-[var(--score-fair,#f59e0b)]" /> : null}
                {dist.needsAttentionPct > 0 ? <span style={{ width: `${dist.needsAttentionPct}%` }} className="bg-[var(--score-poor,#f43f5e)]" /> : null}
              </>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {([
              ["Excellent", dist?.excellentPct ?? 0, "#059669", "85–100"],
              ["Good", dist?.goodPct ?? 0, "#65a30d", "70–84"],
              ["Fair", dist?.fairPct ?? 0, "#f59e0b", "55–69"],
              ["Needs attention", dist?.needsAttentionPct ?? 0, "#f43f5e", "Below 55"],
            ] as const).map(([label, p, color, range]) => (
              <div key={label}>
                <p className="text-lg font-semibold tabular-nums text-slate-900">{p}%</p>
                <p className="inline-flex items-center gap-1.5 text-[11px] text-slate-500"><span className="size-2 rounded-full" style={{ backgroundColor: color }} /> {label}</p>
                <p className="text-[11px] text-slate-400">{range}</p>
              </div>
            ))}
          </div>
        </div>

        <SummaryCard icon={Users} label="Total employees" value={String(s?.employees ?? 0)} sub="in view" accent="#6366f1" />
        <SummaryCard icon={ShieldAlert} label="Needs attention" value={String(s?.atRisk ?? 0)} sub={s && s.employees > 0 ? `${Math.round((s.atRisk / s.employees) * 100)}% of team` : undefined} accent="#e5484d" />
        <SummaryCard icon={HeartPulse} label="Avg. health score" value={String(s?.avgScore ?? 0)} sub={data ? `vs prev ${data.months} mo` : undefined} accent="#0d9488" delta={s?.deltaScore} />
        <SummaryCard icon={CalendarX} label="Avg. days missed" value={String(s?.avgDaysMissed ?? 0)} sub={data ? `vs prev ${data.months} mo` : undefined} accent="#f97316" delta={s?.deltaDaysMissed} deltaGoodWhenDown />
      </div>

      <Card>
        <CardHeader
          title="Who needs attention"
          subtitle="A simple attendance health score for each person — the ones who need a check-in are at the top"
          action={
            <button onClick={exportCsv} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Download className="size-4" /> Export
            </button>
          }
        />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-panel-2/40 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee" className={`${selectCls} w-56 pl-8`} />
          </div>
          <select value={dept} onChange={(e) => setDept(e.target.value)} className={selectCls}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as "" | RiskLevel)} className={selectCls}>
            <option value="">All statuses</option>
            <option value="critical">Critical</option>
            <option value="high">At risk</option>
            <option value="medium">Watch</option>
            <option value="low">On track</option>
          </select>
          <span className="ml-auto text-xs text-slate-400">{filtered.length} of {data?.rows.length ?? 0}</span>
        </div>

        <PaginatedTable
          minWidth="min-w-[1040px]"
          head={
            <tr className="border-b border-hairline text-xs text-slate-500">
              <th className="px-5 py-3 text-left font-medium">Employee</th>
              <th className="px-5 py-3 text-left font-medium">Department</th>
              <Th hint="Overall attendance health, 0–100. Combines the three scores to its right. Higher is better.">Health score</Th>
              <Th hint="Score 0–100 for how often they showed up out of the days they were expected.">Show-up score</Th>
              <Th hint="Score 0–100 for arriving on time (and not leaving early).">Punctuality score</Th>
              <Th hint="Score 0–100 for how steady their daily hours are day to day.">Consistency score</Th>
              <Th hint="Count of working days they were expected but had no check-in." align="right">Days missed</Th>
              <Th hint="On the days they were late, how late on average (minutes)." align="right">Avg late</Th>
              <Th hint="Overall standing — how much attention this person needs, and why.">Status</Th>
              <th className="w-10 px-3 py-3" />
            </tr>
          }
          empty={
            <tr>
              <td colSpan={10} className="px-5 py-8 text-center text-sm text-slate-500">{loading ? "Loading…" : "No matching people."}</td>
            </tr>
          }
          rows={filtered.map((r) => (
            <tr key={r.employeeId} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
              <td className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={r.name} />
                  <span className="font-medium text-slate-900">{r.name}</span>
                </div>
              </td>
              <td className="px-5 py-3 text-slate-600">{r.department ?? "—"}</td>
              <td className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <ScoreRing value={r.hasData ? r.score : null} />
                  <span className={`text-xs font-medium ${GRADE_STYLE[r.grade] ?? "text-slate-500"}`}>{r.grade}</span>
                </div>
              </td>
              <td className="px-5 py-3"><ScoreBar value={r.attendanceRate} /></td>
              <td className="px-5 py-3"><ScoreBar value={r.punctuality} /></td>
              <td className="px-5 py-3"><ScoreBar value={r.consistency} /></td>
              <td className="px-5 py-3 text-right tabular-nums text-rose-700">{r.absentDays}</td>
              <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.lateDays > 0 ? `${r.avgLateMinutes}m` : "—"}</td>
              <td className="px-5 py-3">
                <span className="inline-flex flex-col gap-0.5">
                  <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${RISK_STYLE[r.risk].pill}`}>{RISK_STYLE[r.risk].label}</span>
                  <span className="text-[11px] text-slate-400">{r.reason}</span>
                </span>
              </td>
              <td className="px-3 py-3"><RowActions row={r} canNote={canNote} onNote={openNote} /></td>
            </tr>
          ))}
        />
      </Card>

      <Modal open={noteFor !== null} onClose={() => setNoteFor(null)} title={noteFor ? `Add a note — ${noteFor.name}` : "Add a note"}>
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            This is saved as an observation about {noteFor?.name ?? "this person"} (severity {noteFor ? RISK_STYLE[noteFor.risk].label : ""}), and routes to their manager for follow-up.
          </p>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={4}
            maxLength={1000}
            autoFocus
            placeholder="e.g. Spoke with them about the recent late arrivals — commuting issue, resolving next week."
            className="w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none"
          />
          {noteMsg ? (
            <p className={`rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${noteMsg.kind === "ok" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-600 ring-rose-200"}`}>{noteMsg.text}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button onClick={() => setNoteFor(null)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button onClick={submitNote} disabled={noteBusy || !noteText.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">
              {noteBusy ? <Loader2 className="size-4 animate-spin" /> : <NotebookPen className="size-4" />} Save note
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
