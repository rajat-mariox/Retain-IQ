"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Activity, Check, ChevronLeft, ChevronRight, Eye, Gauge, Mail, Pencil, Plus, RefreshCw, Send, Timer, Trash2, TrendingUp, X } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { Modal } from "@/components/ui/Modal";
import type { BillableGroupBy, BillableSummary, InsightsMe, MyTimesheet, PendingTimesheet, TimeEntryRow, TimesheetReview, TimesheetWeek } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";
const fmtMins = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const pad = (n: number) => String(n).padStart(2, "0");
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function shiftWeek(weekStart: string, deltaWeeks: number): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaWeeks * 7));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return addDays(dateStr, -((dt.getUTCDay() + 6) % 7));
}
const STATUS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
  SUBMITTED: "bg-amber-50 text-amber-700 ring-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  REJECTED: "bg-rose-50 text-rose-700 ring-rose-200",
};

type Tab = "mytime" | "timesheet" | "history" | "approvals" | "billable";

const GROUP_BY: { key: BillableGroupBy; label: string }[] = [
  { key: "project", label: "Project" },
  { key: "client", label: "Client" },
  { key: "team", label: "Team" },
  { key: "employee", label: "Employee" },
];
const RANGES: { key: string; label: string; days: number }[] = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
];

const STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", SUBMITTED: "Pending", APPROVED: "Approved", REJECTED: "Rejected" };
const HISTORY_FILTERS: { key: string; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "SUBMITTED", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
];

export function TimeTrackingWorkspace({ insights, projects, isManager, isOwner = false }: { insights: InsightsMe | null; projects: { id: string; name: string }[]; isManager: boolean; isOwner?: boolean }) {
  // The Owner doesn't file time (the backend rejects it), so they only get the review tabs.
  const [tab, setTab] = useState<Tab>(isOwner ? "approvals" : "timesheet");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // timesheet state
  const today = new Date().toISOString().slice(0, 10);
  const [week, setWeek] = useState(() => mondayOf(today));
  const [sheet, setSheet] = useState<TimesheetWeek | null>(null);
  const [loading, setLoading] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [editing, setEditing] = useState<TimeEntryRow | null>(null);
  const [form, setForm] = useState({ date: today, projectId: "", hours: "1", billable: true, description: "" });

  // history state
  const [history, setHistory] = useState<MyTimesheet[]>([]);
  const [historyFilter, setHistoryFilter] = useState("ALL");

  // approvals state
  const [approvals, setApprovals] = useState<PendingTimesheet[]>([]);
  const [review, setReview] = useState<TimesheetReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewNote, setReviewNote] = useState("");

  // billable state
  const [billable, setBillable] = useState<BillableSummary | null>(null);
  const [billableLoading, setBillableLoading] = useState(false);
  const [groupBy, setGroupBy] = useState<BillableGroupBy>("project");
  const [range, setRange] = useState("30");

  const loadSheet = useCallback((w: string) => {
    setLoading(true);
    fetch(`/api/time/timesheet?week=${w}`, { cache: "no-store" }).then((r) => r.json()).then((d: TimesheetWeek) => setSheet(d)).catch(() => undefined).finally(() => setLoading(false));
  }, []);
  const loadApprovals = useCallback(() => {
    fetch(`/api/time/timesheets/pending`, { cache: "no-store" }).then((r) => r.json()).then((d) => Array.isArray(d) && setApprovals(d)).catch(() => undefined);
  }, []);
  const loadHistory = useCallback(() => {
    fetch(`/api/time/timesheets/mine`, { cache: "no-store" }).then((r) => r.json()).then((d) => Array.isArray(d) && setHistory(d)).catch(() => undefined);
  }, []);
  const loadBillable = useCallback((g: BillableGroupBy, r: string) => {
    const days = RANGES.find((x) => x.key === r)?.days ?? 30;
    const from = addDays(new Date().toISOString().slice(0, 10), -(days - 1));
    setBillableLoading(true);
    fetch(`/api/time/billable-summary?groupBy=${g}&from=${from}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((d: BillableSummary) => setBillable(d?.groups ? d : null))
      .catch(() => undefined)
      .finally(() => setBillableLoading(false));
  }, []);

  useEffect(() => {
    if (tab === "timesheet") loadSheet(week);
  }, [tab, week, loadSheet]);
  useEffect(() => {
    if (tab === "approvals") loadApprovals();
  }, [tab, loadApprovals]);
  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);
  useEffect(() => {
    if (tab === "billable") loadBillable(groupBy, range);
  }, [tab, groupBy, range, loadBillable]);

  function openWeek(w: string) {
    setWeek(mondayOf(w));
    setTab("timesheet");
  }

  function openAdd() {
    const d = today >= week && today <= addDays(week, 6) ? today : week;
    setEditing(null);
    setForm({ date: d, projectId: "", hours: "1", billable: true, description: "" });
    setError(null);
    setEntryOpen(true);
  }
  function openEdit(e: TimeEntryRow) {
    setEditing(e);
    setForm({ date: e.date, projectId: e.projectId ?? "", hours: String(e.minutes / 60), billable: e.billable, description: e.description ?? "" });
    setError(null);
    setEntryOpen(true);
  }

  function saveEntry() {
    setError(null);
    const minutes = Math.round((Number(form.hours) || 0) * 60);
    if (minutes < 1) { setError("Enter a duration."); return; }
    const body = { date: form.date, projectId: form.projectId || null, minutes, billable: form.billable, description: form.description || undefined };
    start(async () => {
      const res = await fetch(editing ? `/api/time/entries/${editing.id}` : "/api/time/entries", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? "Could not save."); return; }
      setEntryOpen(false);
      loadSheet(week);
    });
  }
  const deleteEntry = (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("Delete this time entry?")) return;
    start(async () => {
      setError(null);
      const res = await fetch(`/api/time/entries/${id}`, { method: "DELETE", cache: "no-store" });
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? "Could not delete entry."); return; }
      loadSheet(week);
    });
  };
  const syncAuto = () => start(async () => {
    setError(null);
    const res = await fetch(`/api/time/auto-sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? "Could not sync tracked time."); return; }
    loadSheet(week);
  });
  const submitWeek = () => start(async () => {
    setError(null);
    const res = await fetch(`/api/time/timesheet/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week }) });
    if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? "Could not submit."); return; }
    loadSheet(week);
  });
  const openReview = (id: string) => {
    setReviewNote("");
    setReview(null);
    setReviewLoading(true);
    fetch(`/api/time/timesheets/${id}`, { cache: "no-store" }).then((r) => r.json()).then((d: TimesheetReview) => setReview(d)).catch(() => undefined).finally(() => setReviewLoading(false));
  };
  const decide = (id: string, approve: boolean, note?: string) => start(async () => {
    await fetch(`/api/time/timesheets/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve, note: note?.trim() || undefined }) });
    setReview(null);
    loadApprovals();
  });

  const TabBtn = ({ k, labelText, count }: { k: Tab; labelText: string; count?: number }) => (
    <button onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${tab === k ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"}`}>
      {labelText}{count ? <span className="rounded-full bg-amber-100 px-1.5 text-xs tabular-nums text-amber-700">{count}</span> : null}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
        {!isOwner ? <TabBtn k="timesheet" labelText="Timesheet" /> : null}
        {!isOwner ? <TabBtn k="history" labelText="My Timesheets" /> : null}
        {!isOwner ? <TabBtn k="mytime" labelText="My Time" /> : null}
        {isManager ? <TabBtn k="approvals" labelText="Approvals" count={approvals.length || undefined} /> : null}
        {isManager ? <TabBtn k="billable" labelText="Billable" /> : null}
      </div>

      {error && tab !== "timesheet" ? <p className="text-sm text-rose-600">{error}</p> : null}

      {tab === "mytime" && !isOwner ? <MyTime insights={insights} /> : null}

      {tab === "history" ? (
        <Card>
          <CardHeader
            title="My timesheets"
            subtitle="Every week you've tracked — draft, pending, approved & rejected"
            action={
              <div className="flex flex-wrap gap-1">
                {HISTORY_FILTERS.map((f) => {
                  const n = f.key === "ALL" ? history.length : history.filter((h) => h.status === f.key).length;
                  return (
                    <button key={f.key} onClick={() => setHistoryFilter(f.key)} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${historyFilter === f.key ? "bg-brand text-white" : "text-slate-500 hover:bg-slate-100"}`}>
                      {f.label}{n ? <span className="ml-1 tabular-nums opacity-70">{n}</span> : null}
                    </button>
                  );
                })}
              </div>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-hairline text-xs text-slate-500"><th className="px-5 py-3 text-left font-medium">Week</th><th className="px-5 py-3 text-left font-medium">Status</th><th className="px-5 py-3 text-right font-medium">Hours</th><th className="px-5 py-3 text-right font-medium">Entries</th><th className="px-5 py-3 text-right font-medium">Updated</th></tr></thead>
              <tbody>
                {history.filter((h) => historyFilter === "ALL" || h.status === historyFilter).map((h) => (
                  <tr key={h.id} onClick={() => openWeek(h.weekStart)} className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 tabular-nums text-slate-700">{h.weekStart} <span className="text-slate-400">→</span> {h.weekEnd}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS[h.status] ?? STATUS.DRAFT}`}>{STATUS_LABEL[h.status] ?? h.status}</span>
                      {h.status === "REJECTED" && h.note ? <span className="ml-2 text-xs text-rose-500">· {h.note}</span> : null}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{fmtMins(h.totalMinutes)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-500">{h.entryCount}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500">{(h.decidedAt ?? h.submittedAt ?? "").slice(0, 10) || "—"}</td>
                  </tr>
                ))}
                {history.filter((h) => historyFilter === "ALL" || h.status === historyFilter).length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No timesheets{historyFilter === "ALL" ? " yet — add time on the Timesheet tab." : ` with status “${STATUS_LABEL[historyFilter] ?? historyFilter}”.`}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === "timesheet" && sheet ? (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <Card>
            <CardHeader
              title="Weekly timesheet"
              subtitle={`${sheet.weekStart} → ${sheet.weekEnd} · ${fmtMins(sheet.totalMinutes)}${sheet.totalMinutes > 0 ? ` · ${fmtMins(sheet.billableMinutes)} billable` : ""}`}
              action={
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS[sheet.status] ?? STATUS.DRAFT}`}>{sheet.status.toLowerCase()}</span>
                  <button onClick={() => setWeek(shiftWeek(week, -1))} className="rounded-lg border border-hairline bg-panel p-1.5 text-slate-500 hover:bg-slate-50"><ChevronLeft className="size-4" /></button>
                  <button onClick={() => setWeek(mondayOf(today))} className="rounded-lg border border-hairline bg-panel px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">This week</button>
                  <button onClick={() => setWeek(shiftWeek(week, 1))} className="rounded-lg border border-hairline bg-panel p-1.5 text-slate-500 hover:bg-slate-50"><ChevronRight className="size-4" /></button>
                </div>
              }
            />
            <CardBody className="space-y-3">
              {error ? <p className="text-sm text-rose-600">{error}</p> : null}
              {sheet.status === "REJECTED" && sheet.note ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">Rejected: {sheet.note}</p> : null}
              {Array.from({ length: 7 }, (_, i) => {
                const dayDate = addDays(week, i);
                const dayEntries = sheet.entries.filter((e) => e.date === dayDate);
                const dayMins = dayEntries.reduce((s, e) => s + e.minutes, 0);
                return (
                  <div key={dayDate} className="rounded-lg border border-hairline/70">
                    <div className="flex items-center justify-between bg-panel-2 px-4 py-2 text-xs">
                      <span className="font-semibold text-slate-600">{DOW[i]} <span className="font-normal text-slate-400">{dayDate.slice(5)}</span></span>
                      <span className="tabular-nums text-slate-500">{dayMins > 0 ? fmtMins(dayMins) : "—"}</span>
                    </div>
                    {dayEntries.length ? (
                      <ul className="divide-y divide-hairline/60">
                        {dayEntries.map((e) => (
                          <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                            <span className="min-w-0">
                              <span className="font-medium text-slate-800">{e.projectName ?? "No project"}</span>
                              {e.description ? <span className="text-slate-500"> · {e.description}</span> : null}
                              {e.source === "AUTO" ? <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] text-slate-500">auto</span> : null}
                              {!e.billable ? <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] text-slate-500">non-billable</span> : null}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className="tabular-nums text-slate-600">{fmtMins(e.minutes)}</span>
                              {sheet.editable ? (
                                <>
                                  <button onClick={() => openEdit(e)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-3.5" /></button>
                                  <button onClick={() => deleteEntry(e.id)} disabled={pending} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50"><Trash2 className="size-3.5" /></button>
                                </>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
              {sheet.editable ? (
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <button onClick={openAdd} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"><Plus className="size-4" /> Add time</button>
                    {isManager ? <button onClick={syncAuto} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60" title="Create draft entries from tracked desktop-agent activity (yesterday). Non-billable — assign a project & mark billable."><RefreshCw className="size-4" /> Pull tracked time</button> : null}
                  </div>
                  <button onClick={submitWeek} disabled={pending || sheet.totalMinutes === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60"><Send className="size-4" /> Submit for approval</button>
                </div>
              ) : (
                <p className="pt-1 text-xs text-slate-500">This timesheet is {sheet.status.toLowerCase()} and locked{sheet.submittedAt ? ` (submitted ${sheet.submittedAt.slice(0, 10)})` : ""}.</p>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "approvals" && isManager ? (
        <Card>
          <CardHeader title="Timesheet approvals" subtitle={`${approvals.length} awaiting decision`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-hairline text-xs text-slate-500"><th className="px-5 py-3 text-left font-medium">Employee</th><th className="px-5 py-3 text-left font-medium">Week</th><th className="px-5 py-3 text-right font-medium">Total</th><th className="px-5 py-3 text-right font-medium">Submitted</th><th className="px-5 py-3 text-right font-medium">Actions</th></tr></thead>
              <tbody>
                {approvals.map((t) => (
                  <tr key={t.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{t.employeeName}</td>
                    <td className="px-5 py-3 tabular-nums text-slate-600">{t.weekStart}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{fmtMins(t.totalMinutes)}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500">{t.submittedAt ? t.submittedAt.slice(0, 10) : "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => openReview(t.id)} className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-soft"><Eye className="size-3.5" /> Review</button>
                        <button onClick={() => decide(t.id, true)} disabled={pending} className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"><Check className="size-3.5" /> Approve</button>
                        <button onClick={() => decide(t.id, false)} disabled={pending} className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"><X className="size-3.5" /> Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {approvals.length === 0 ? <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No timesheets awaiting approval.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === "billable" && isManager ? (
        <div className={billableLoading ? "space-y-6 opacity-60 transition-opacity" : "space-y-6 transition-opacity"}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile icon={Timer} label="Total tracked" value={billable ? fmtMins(billable.totals.minutes) : "—"} />
            <StatTile icon={TrendingUp} label="Billable" value={billable ? fmtMins(billable.totals.billableMinutes) : "—"} />
            <StatTile icon={Activity} label="Non-billable" value={billable ? fmtMins(billable.totals.nonBillableMinutes) : "—"} />
            <StatTile icon={Gauge} label="Utilization" value={billable ? `${billable.totals.utilization}%` : "—"} />
          </div>

          <Card>
            <CardHeader
              title="Billable breakdown"
              subtitle={billable ? `${billable.from} → ${billable.to} · ${billable.totals.entryCount} entries · billable share of tracked time` : "Billable vs non-billable hours"}
              action={
                <div className="flex flex-wrap gap-1">
                  {RANGES.map((r) => (
                    <button key={r.key} onClick={() => setRange(r.key)} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${range === r.key ? "bg-brand text-white" : "text-slate-500 hover:bg-slate-100"}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              }
            />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
                {GROUP_BY.map((g) => (
                  <button key={g.key} onClick={() => setGroupBy(g.key)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${groupBy === g.key ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"}`}>
                    {g.label}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-xs text-slate-500">
                      <th className="px-4 py-3 text-left font-medium">{GROUP_BY.find((g) => g.key === groupBy)?.label}</th>
                      <th className="px-4 py-3 text-left font-medium">Split</th>
                      <th className="px-4 py-3 text-right font-medium">Billable</th>
                      <th className="px-4 py-3 text-right font-medium">Non-billable</th>
                      <th className="px-4 py-3 text-right font-medium">Total</th>
                      <th className="px-4 py-3 text-right font-medium">Utilization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(billable?.groups ?? []).map((g) => (
                      <tr key={g.key ?? "none"} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{g.label}</td>
                        <td className="px-4 py-3">
                          <span className="flex h-2 w-32 overflow-hidden rounded-full bg-slate-100">
                            <span className="block h-full bg-brand" style={{ width: `${g.minutes ? (g.billableMinutes / g.minutes) * 100 : 0}%` }} />
                            <span className="block h-full bg-brand/25" style={{ width: `${g.minutes ? (g.nonBillableMinutes / g.minutes) * 100 : 0}%` }} />
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{fmtMins(g.billableMinutes)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{fmtMins(g.nonBillableMinutes)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmtMins(g.minutes)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-700">{g.utilization}%</td>
                      </tr>
                    ))}
                    {billable && billable.groups.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">No time tracked in this period.</td></tr>
                    ) : null}
                    {!billable && !billableLoading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">Billable data is unavailable right now.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}

      <Modal open={entryOpen} onClose={() => setEntryOpen(false)} title={editing ? "Edit time entry" : "Add time entry"}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Date</label><input type="date" min={week} max={addDays(week, 6)} className={input} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><label className={label}>Duration (hours)</label><input type="number" min={0} step={0.25} className={input} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} /></div>
          </div>
          <div><label className={label}>Project (optional)</label><select className={input} value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div>
            <label className={label}>Billing</label>
            <div className="flex gap-1 rounded-lg border border-hairline bg-panel-2 p-1">
              {[{ v: true, t: "Billable" }, { v: false, t: "Non-billable" }].map((o) => (
                <button
                  key={o.t}
                  type="button"
                  onClick={() => setForm({ ...form, billable: o.v })}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${form.billable === o.v ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {o.t}
                </button>
              ))}
            </div>
          </div>
          <div><label className={label}>What did you work on?</label><input className={input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. API integration" /></div>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2"><button onClick={() => setEntryOpen(false)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={saveEntry} disabled={pending} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Saving…" : "Save"}</button></div>
        </div>
      </Modal>

      <Modal open={reviewLoading || Boolean(review)} onClose={() => setReview(null)} title="Review timesheet" size="lg">
        {reviewLoading || !review ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading timesheet…</p>
        ) : (
          <div className="space-y-5">
            {/* header: employee + totals */}
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-panel-2 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{review.employeeName}{review.designation ? <span className="font-normal text-slate-500"> · {review.designation}</span> : null}</p>
                {review.employeeEmail ? <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><Mail className="size-3" /> {review.employeeEmail}</p> : null}
                <p className="mt-0.5 text-xs text-slate-500">Week {review.weekStart} → {review.weekEnd}{review.submittedAt ? ` · submitted ${review.submittedAt.slice(0, 10)}` : ""}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold tabular-nums text-slate-900">{fmtMins(review.totalMinutes)}</p>
                <p className="text-xs text-slate-500">{review.entries.length} entr{review.entries.length === 1 ? "y" : "ies"} · {(review.totalMinutes / 60 / 5).toFixed(1)}h/day avg</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  <span className="font-medium text-emerald-700">{fmtMins(review.billableMinutes)}</span> billable
                  {review.totalMinutes > 0 ? <span className="text-slate-400"> · {Math.round((review.billableMinutes / review.totalMinutes) * 100)}% utilization</span> : null}
                </p>
              </div>
            </div>

            {/* project breakdown */}
            {review.byProject.length ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  By project <span className="font-normal normal-case tracking-normal text-slate-400">· solid = billable</span>
                </p>
                <div className="space-y-1.5">
                  {review.byProject.map((p) => (
                    <div key={p.projectId ?? "none"} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-sm text-slate-700">{p.projectName}</span>
                      <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span className="block h-full bg-brand" style={{ width: `${review.totalMinutes ? (p.billableMinutes / review.totalMinutes) * 100 : 0}%` }} />
                        <span className="block h-full bg-brand/25" style={{ width: `${review.totalMinutes ? ((p.minutes - p.billableMinutes) / review.totalMinutes) * 100 : 0}%` }} />
                      </span>
                      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-600">{fmtMins(p.minutes)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* per-day entries */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Daily breakdown</p>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {review.days.map((d, i) => (
                  <div key={d.date} className="rounded-lg border border-hairline/70">
                    <div className="flex items-center justify-between bg-panel-2 px-3 py-1.5 text-xs">
                      <span className="font-semibold text-slate-600">{DOW[i]} <span className="font-normal text-slate-400">{d.date.slice(5)}</span></span>
                      <span className="tabular-nums text-slate-500">{d.minutes > 0 ? fmtMins(d.minutes) : "—"}</span>
                    </div>
                    {d.entries.length ? (
                      <ul className="divide-y divide-hairline/60">
                        {d.entries.map((e) => (
                          <li key={e.id} className="flex items-start justify-between gap-3 px-3 py-1.5 text-sm">
                            <span className="min-w-0">
                              <span className="font-medium text-slate-800">{e.projectName ?? "No project"}</span>
                              {e.taskTitle ? <span className="text-slate-500"> · {e.taskTitle}</span> : null}
                              {e.description ? <span className="block text-xs text-slate-500">{e.description}</span> : null}
                            </span>
                            <span className="shrink-0 tabular-nums text-slate-600">{fmtMins(e.minutes)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* decision */}
            <div className="space-y-3 border-t border-hairline pt-4">
              <div>
                <label className={label}>Note <span className="font-normal text-slate-400">(optional — shared with the employee, required to explain a rejection)</span></label>
                <textarea rows={2} className={input} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="e.g. Please split the 10h Friday entry by project." />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => decide(review.id, false, reviewNote)} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"><X className="size-4" /> Reject</button>
                <button onClick={() => decide(review.id, true, reviewNote)} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"><Check className="size-4" /> Approve</button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function MyTime({ insights }: { insights: InsightsMe | null }) {
  const totals = insights?.totals;
  const recent = [...(insights?.series ?? [])].reverse().slice(0, 14);
  const ratio = totals && totals.activeHours > 0 ? Math.round((totals.productiveHours / totals.activeHours) * 100) : 0;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile label="Active hours" value={String(totals?.activeHours ?? 0)} icon={Activity} accent="#1f883d" hint={`${totals?.trackedDays ?? 0} days`} />
        <StatTile label="Productive hours" value={String(totals?.productiveHours ?? 0)} icon={Timer} accent="#16a34a" hint={`${ratio}% of active`} />
        <StatTile label="Avg productivity" value={`${totals?.avgProductivity ?? 0}%`} icon={Gauge} accent="#0d9488" hint={insights?.momentum ? `momentum ${insights.momentum.direction}` : undefined} />
        <StatTile label="Avg focus" value={`${totals?.avgFocus ?? 0}%`} icon={TrendingUp} accent="#166534" />
      </div>
      <Card>
        <CardHeader title="Recent days" subtitle="Tracked hours & scores (last 30 days)" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="border-b border-hairline text-xs text-slate-500"><th className="px-5 py-3 text-left font-medium">Day</th><th className="px-5 py-3 text-right font-medium">Active</th><th className="px-5 py-3 text-right font-medium">Productive</th><th className="px-5 py-3 text-right font-medium">Productivity</th><th className="px-5 py-3 text-right font-medium">Focus</th></tr></thead>
            <tbody>
              {recent.map((d) => (
                <tr key={d.date} className="border-b border-hairline/60 last:border-0">
                  <td className="px-5 py-3 tabular-nums text-slate-700">{d.date}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-700">{d.activeHours}h</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{d.productiveHours}h</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{d.productivity}%</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{d.focus}%</td>
                </tr>
              ))}
              {recent.length === 0 ? <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No tracked time yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
