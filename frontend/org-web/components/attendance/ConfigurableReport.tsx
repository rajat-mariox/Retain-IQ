"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, CalendarClock, Trash2, Send, Plus, Columns3 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { MiniBars } from "@/components/ui/MiniChart";

type Scope = "org" | "department" | "team" | "employee";
type Period = "today" | "week" | "month" | "custom";
type Frequency = "DAILY" | "WEEKLY" | "MONTHLY";

interface ReportRow {
  employeeId: string;
  name: string;
  department: string | null;
  workingDays: number;
  present: number;
  late: number;
  onLeave: number;
  absent: number;
  overtimeMinutes: number;
  attendanceRate: number;
}
interface Report {
  scope: Scope;
  scopeId: string | null;
  scopeLabel: string;
  period: Period;
  from: string;
  to: string;
  summary: { employees: number; present: number; late: number; overtimeMinutes: number; attendanceRate: number };
  rows: ReportRow[];
}
interface Schedule {
  id: string;
  scope: Scope;
  scopeId: string | null;
  scopeLabel: string;
  period: Period;
  frequency: Frequency;
  recipients: string[];
  active: boolean;
  lastSentAt: string | null;
}
interface Opt { id: string; name: string }
interface ScopeOptions { canSelectOrg: boolean; departments: Opt[]; teams: Opt[]; employees: Opt[] }

// Selectable report columns (keys match the backend column registry). Employee is
// always included, so it's not offered as a toggle.
const COLUMN_DEFS: { key: keyof ReportRow; label: string }[] = [
  { key: "department", label: "Department" },
  { key: "workingDays", label: "Working days" },
  { key: "present", label: "Present" },
  { key: "late", label: "Late" },
  { key: "absent", label: "Absent" },
  { key: "onLeave", label: "Leave" },
  { key: "overtimeMinutes", label: "Overtime" },
  { key: "attendanceRate", label: "Attendance %" },
];

const inputCls = "rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm text-slate-900 focus:border-brand focus:outline-none";
const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors";
const hm = (m: number) => (m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : "—");
const PERIOD_LABEL: Record<Period, string> = { today: "Today", week: "This week", month: "This month", custom: "Custom" };
const FREQ_LABEL: Record<Frequency, string> = { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly" };

export function ConfigurableReport() {
  // Scope options are the caller's REACH (RBAC/ABAC): an org-tier admin gets every
  // department/team/employee; a scoped manager gets only their own — so the pickers
  // never offer a scope that would return an empty report.
  const [opts, setOpts] = useState<ScopeOptions>({ canSelectOrg: true, departments: [], teams: [], employees: [] });
  const [scope, setScope] = useState<Scope>("org");
  const [scopeId, setScopeId] = useState<string>("");
  const [period, setPeriod] = useState<Period>("month");
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  // Which optional columns to show (all on by default); "name" is always shown.
  const [cols, setCols] = useState<Set<string>>(new Set(COLUMN_DEFS.map((c) => c.key as string)));
  const [colsOpen, setColsOpen] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/attendance/report-scope-options`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ScopeOptions | null) => {
        if (!d) return;
        setOpts(d);
        // A scoped manager can't run a whole-org report — default them to department.
        if (!d.canSelectOrg) setScope((s) => (s === "org" ? "department" : s));
      })
      .catch(() => undefined);
  }, []);

  const scopeIdParam = scope === "org" ? "" : scopeId;
  const rangeReady = period !== "custom" || Boolean(range.from && range.to);
  const canRun = (scope === "org" || Boolean(scopeId)) && rangeReady;

  // Column keys for the export (always include "name"; keep registry order).
  const columnKeys = () => ["name", ...COLUMN_DEFS.filter((c) => cols.has(c.key as string)).map((c) => c.key as string)].join(",");

  // Query params for the chosen scope + period (or a custom from/to range).
  const reportParams = (extra: Record<string, string> = {}) => {
    const p: Record<string, string> = { scope, ...(scopeIdParam ? { scopeId: scopeIdParam } : {}), ...extra };
    if (period === "custom") { p.from = range.from; p.to = range.to; }
    else p.period = period;
    // Only send a columns filter to the export endpoints (the JSON view keeps all).
    if (extra.format) p.columns = columnKeys();
    return new URLSearchParams(p);
  };

  const fetchReport = useCallback(async () => {
    if (!canRun) { setReport(null); return; }
    setLoading(true);
    setMsg(null);
    try {
      const qs = reportParams();
      const r = await fetch(`/api/attendance/report-builder?${qs.toString()}`, { cache: "no-store" });
      setReport(r.ok ? await r.json() : null);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [scope, period, scopeIdParam, canRun, range.from, range.to]);

  useEffect(() => { void fetchReport(); }, [fetchReport]);

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadCsv() {
    const qs = reportParams({ format: "csv" });
    const r = await fetch(`/api/attendance/report-builder?${qs.toString()}`, { cache: "no-store" });
    if (!r.ok) { setMsg({ kind: "err", text: "Could not generate the CSV." }); return; }
    const { filename, body } = (await r.json()) as { filename: string; body: string };
    triggerDownload(new Blob([body], { type: "text/csv;charset=utf-8" }), filename || "attendance-report.csv");
  }

  async function downloadXlsx() {
    const qs = reportParams({ format: "xlsx" });
    const r = await fetch(`/api/attendance/report-builder?${qs.toString()}`, { cache: "no-store" });
    if (!r.ok) { setMsg({ kind: "err", text: "Could not generate the Excel file." }); return; }
    const cd = r.headers.get("content-disposition") ?? "";
    const filename = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? "attendance-report.xls";
    triggerDownload(new Blob([await r.text()], { type: "application/vnd.ms-excel" }), filename);
  }

  // --- Schedules ---
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [freq, setFreq] = useState<Frequency>("WEEKLY");
  const [creating, setCreating] = useState(false);

  const loadSchedules = useCallback(() => {
    fetch(`/api/attendance/report-schedules`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setSchedules(Array.isArray(d) ? d : []))
      .catch(() => setSchedules([]));
  }, []);
  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  async function createSchedule() {
    setCreating(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/attendance/report-schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, scopeId: scopeIdParam || null, period, frequency: freq }),
      });
      if (!r.ok) { setMsg({ kind: "err", text: (await r.json().catch(() => ({}))).error ?? "Could not create the schedule." }); return; }
      setMsg({ kind: "ok", text: "Schedule created — you'll get this report by email." });
      loadSchedules();
    } finally {
      setCreating(false);
    }
  }

  async function runSchedule(id: string) {
    const r = await fetch(`/api/attendance/report-schedules/${id}/run`, { method: "POST" });
    if (r.ok) { const { sent } = await r.json(); setMsg({ kind: "ok", text: `Report sent to ${sent} recipient${sent === 1 ? "" : "s"}.` }); loadSchedules(); }
    else setMsg({ kind: "err", text: "Could not send the report." });
  }

  async function deleteSchedule(id: string) {
    const r = await fetch(`/api/attendance/report-schedules/${id}/delete`, { method: "POST" });
    if (r.ok) { setSchedules((prev) => prev.filter((s) => s.id !== id)); }
    else setMsg({ kind: "err", text: "Could not delete the schedule." });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Configurable report" subtitle="Pick a scope and period, then view, download, or schedule it" />

        {/* Controls */}
        <div className="flex flex-wrap items-end gap-3 border-b border-hairline px-4 py-3">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Scope
            <select value={scope} onChange={(e) => { setScope(e.target.value as Scope); setScopeId(""); }} className={inputCls}>
              {opts.canSelectOrg ? <option value="org">Whole organization</option> : null}
              {opts.departments.length > 0 ? <option value="department">Department</option> : null}
              {opts.teams.length > 0 ? <option value="team">Team</option> : null}
              {opts.employees.length > 0 ? <option value="employee">Employee</option> : null}
            </select>
          </label>

          {scope !== "org" ? (
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              {scope === "department" ? "Department" : scope === "team" ? "Team" : "Employee"}
              <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {scope === "department" ? opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>) : null}
                {scope === "team" ? opts.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>) : null}
                {scope === "employee" ? opts.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>) : null}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Period
            <div className="inline-flex overflow-hidden rounded-lg border border-hairline">
              {(["today", "week", "month", "custom"] as Period[]).map((p) => (
                <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 text-sm ${period === p ? "bg-brand text-white" : "bg-panel text-slate-600 hover:bg-slate-50"}`}>
                  {PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
          </label>

          {period === "custom" ? (
            <>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                From
                <input type="date" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                To
                <input type="date" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={inputCls} />
              </label>
            </>
          ) : null}

          <div className="ml-auto flex items-end gap-2">
            {/* Column picker — choose which columns appear in the report + export */}
            <div className="relative">
              <button onClick={() => setColsOpen((o) => !o)} className={`${btn} border border-hairline bg-panel text-slate-700 hover:bg-slate-50`}><Columns3 className="size-4" /> Columns</button>
              {colsOpen ? (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setColsOpen(false)} />
                  <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-hairline bg-panel p-2 shadow-lg">
                    {COLUMN_DEFS.map((c) => (
                      <label key={c.key as string} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                        <input type="checkbox" checked={cols.has(c.key as string)} onChange={(e) => setCols((prev) => { const n = new Set(prev); if (e.target.checked) n.add(c.key as string); else n.delete(c.key as string); return n; })} className="rounded border-hairline" />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
            <button onClick={downloadCsv} disabled={!canRun} className={`${btn} border border-hairline bg-panel text-slate-700 hover:bg-slate-50 disabled:opacity-50`}><Download className="size-4" /> CSV</button>
            <button onClick={downloadXlsx} disabled={!canRun} className={`${btn} border border-hairline bg-panel text-emerald-700 hover:bg-emerald-50 disabled:opacity-50`}><Download className="size-4" /> Excel</button>
          </div>
        </div>

        {msg ? (
          <p className={`mx-4 mt-3 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-600 ring-rose-200"}`}>{msg.text}</p>
        ) : null}

        {/* Summary strip */}
        {report ? (
          <div className="grid grid-cols-2 gap-px border-y border-hairline bg-hairline/60 sm:grid-cols-5">
            {([
              ["Employees", report.summary.employees],
              ["Present days", report.summary.present],
              ["Late days", report.summary.late],
              ["Overtime", hm(report.summary.overtimeMinutes)],
              ["Attendance", `${report.summary.attendanceRate}%`],
            ] as const).map(([label, value]) => (
              <div key={label} className="bg-panel px-4 py-3 text-center">
                <p className="text-lg font-semibold tabular-nums text-slate-800">{value}</p>
                <p className="text-[11px] text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        ) : null}

        {/* Attendance-rate chart — per-employee, most-present first */}
        {report && report.rows.length > 1 ? (
          <div className="border-b border-hairline px-4 py-4">
            <p className="mb-2 text-xs font-medium text-slate-500">Attendance rate by employee</p>
            <MiniBars
              unit="%"
              points={[...report.rows].sort((a, b) => b.attendanceRate - a.attendanceRate).slice(0, 12).map((r) => ({ label: r.name.split(" ")[0], value: r.attendanceRate, sub: r.name }))}
            />
          </div>
        ) : null}

        {/* Table */}
        <div className={`overflow-x-auto ${loading ? "opacity-50 transition-opacity" : "transition-opacity"}`}>
          {!canRun ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Select a {scope} to run the report.</p>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Employee</th>
                  {cols.has("department") ? <th className="px-5 py-3 text-left font-medium">Department</th> : null}
                  {cols.has("workingDays") ? <th className="px-5 py-3 text-right font-medium">Working days</th> : null}
                  {cols.has("present") ? <th className="px-5 py-3 text-right font-medium">Present</th> : null}
                  {cols.has("late") ? <th className="px-5 py-3 text-right font-medium">Late</th> : null}
                  {cols.has("absent") ? <th className="px-5 py-3 text-right font-medium">Absent</th> : null}
                  {cols.has("onLeave") ? <th className="px-5 py-3 text-right font-medium">Leave</th> : null}
                  {cols.has("overtimeMinutes") ? <th className="px-5 py-3 text-right font-medium">Overtime</th> : null}
                  {cols.has("attendanceRate") ? <th className="px-5 py-3 text-right font-medium">Rate</th> : null}
                </tr>
              </thead>
              <tbody>
                {(report?.rows ?? []).map((r) => (
                  <tr key={r.employeeId} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{r.name}</td>
                    {cols.has("department") ? <td className="px-5 py-3 text-slate-600">{r.department ?? "—"}</td> : null}
                    {cols.has("workingDays") ? <td className="px-5 py-3 text-right tabular-nums text-slate-500">{r.workingDays}</td> : null}
                    {cols.has("present") ? <td className="px-5 py-3 text-right tabular-nums text-emerald-700">{r.present}</td> : null}
                    {cols.has("late") ? <td className="px-5 py-3 text-right tabular-nums text-amber-700">{r.late}</td> : null}
                    {cols.has("absent") ? <td className="px-5 py-3 text-right tabular-nums text-rose-700">{r.absent}</td> : null}
                    {cols.has("onLeave") ? <td className="px-5 py-3 text-right tabular-nums text-sky-700">{r.onLeave}</td> : null}
                    {cols.has("overtimeMinutes") ? <td className="px-5 py-3 text-right tabular-nums text-indigo-700">{hm(r.overtimeMinutes)}</td> : null}
                    {cols.has("attendanceRate") ? <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-800">{r.attendanceRate}%</td> : null}
                  </tr>
                ))}
                {report && report.rows.length === 0 ? <tr><td colSpan={cols.size + 1} className="px-5 py-8 text-center text-sm text-slate-500">No employees in this scope.</td></tr> : null}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Scheduled reports */}
      <Card>
        <CardHeader
          title="Scheduled reports"
          subtitle="Get this report emailed to you automatically"
          action={
            <div className="flex items-center gap-2">
              <select value={freq} onChange={(e) => setFreq(e.target.value as Frequency)} className={inputCls}>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
              <button onClick={createSchedule} disabled={!canRun || creating || period === "custom"} title={period === "custom" ? "Schedules use a recurring period — pick Today, This week or This month" : undefined} className={`${btn} bg-brand text-white hover:brightness-95 disabled:opacity-50`}>
                <Plus className="size-4" /> Schedule this
              </button>
            </div>
          }
        />
        <div className="p-4">
          {schedules.length === 0 ? (
            <p className="inline-flex items-center gap-2 text-sm text-slate-500"><CalendarClock className="size-4" /> No scheduled reports yet. Configure a scope and period above, pick a frequency, then “Schedule this”.</p>
          ) : (
            <ul className="divide-y divide-hairline/60">
              {schedules.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="inline-flex items-center gap-2">
                    <CalendarClock className="size-4 text-slate-400" />
                    <span className="text-sm font-medium text-slate-800">{s.scopeLabel}</span>
                  </span>
                  <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] text-slate-600">{PERIOD_LABEL[s.period]}</span>
                  <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] text-slate-600">{FREQ_LABEL[s.frequency]}</span>
                  <span className="text-xs text-slate-400">{s.recipients.length} recipient{s.recipients.length === 1 ? "" : "s"}{s.lastSentAt ? ` · last sent ${s.lastSentAt.slice(0, 10)}` : " · not sent yet"}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <button onClick={() => runSchedule(s.id)} className={`${btn} border border-hairline bg-panel text-slate-700 hover:bg-slate-50`}><Send className="size-3.5" /> Send now</button>
                    <button onClick={() => deleteSchedule(s.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete"><Trash2 className="size-4" /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
