"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, Clock, AlertTriangle, UserPlus, X, ArrowUpNarrowWide } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { LocalTime } from "@/components/ui/LocalTime";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type Status = "PENDING" | "ACKNOWLEDGED" | "RESOLVED" | "PROMOTED";

interface ListItem {
  id: string;
  observationId: string;
  employeeName: string;
  title: string;
  severity: Severity;
  level: number;
  levelLabel: string;
  status: Status;
  dueAt: string | null;
  overdue: boolean;
  createdAt: string;
}
interface Summary { pending: number; overdue: number; mine: number }
interface Detail extends ListItem {
  department: string | null;
  type: string | null;
  detail: string | null;
  reason: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  maxLevel: number;
  timeline: { id: string; kind: string; level: number | null; actorUserId: string | null; note: string | null; createdAt: string }[];
}

const SEV: Record<Severity, string> = {
  LOW: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  MEDIUM: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  HIGH: "bg-orange-500/10 text-orange-700 ring-orange-600/20",
  CRITICAL: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
};
const STATUS: Record<Status, string> = {
  PENDING: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  ACKNOWLEDGED: "bg-indigo-500/10 text-indigo-700 ring-indigo-600/20",
  RESOLVED: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  PROMOTED: "bg-violet-500/10 text-violet-700 ring-violet-600/20",
};
const pill = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset";
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function EscalationsPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [mine, setMine] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (statusFilter) qs.set("status", statusFilter);
    if (mine) qs.set("mine", "1");
    fetch(`/api/escalations?${qs.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setSummary(d.summary); setItems(d.items ?? []); } })
      .catch(() => undefined);
  }, [statusFilter, mine]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Pending" value={String(summary?.pending ?? 0)} icon={Clock} accent="#0ea5e9" />
        <StatTile label="Overdue (SLA)" value={String(summary?.overdue ?? 0)} icon={AlertTriangle} accent="#e5484d" hint="Past due — auto-escalating" />
        <StatTile label="Assigned to me" value={String(summary?.mine ?? 0)} icon={UserPlus} accent="#0d9488" />
      </div>

      <Card>
        <CardHeader title="Escalations" subtitle="Concerns raised up the authority ladder — acknowledge, bump a level, or resolve" />
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm">
            <option value="">All statuses</option>
            {["PENDING", "ACKNOWLEDGED", "RESOLVED", "PROMOTED"].map((s) => <option key={s} value={s}>{cap(s)}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="rounded border-hairline" /> Assigned to me
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-left font-medium">Concern</th>
                <th className="px-5 py-3 text-left font-medium">Level</th>
                <th className="px-5 py-3 text-left font-medium">Severity</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">SLA</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} onClick={() => setOpenId(e.id)} className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{e.employeeName}</td>
                  <td className="px-5 py-3 text-slate-700">{e.title}</td>
                  <td className="px-5 py-3"><span className="inline-flex items-center gap-1 text-xs text-slate-600"><ArrowUpNarrowWide className="size-3.5 text-slate-400" /> L{e.level} · {e.levelLabel}</span></td>
                  <td className="px-5 py-3"><span className={`${pill} ${SEV[e.severity]}`}>{cap(e.severity)}</span></td>
                  <td className="px-5 py-3"><span className={`${pill} ${STATUS[e.status]}`}>{cap(e.status)}</span></td>
                  <td className="px-5 py-3 text-right text-xs">
                    {e.dueAt ? <span className={e.overdue ? "font-medium text-rose-600" : "text-slate-500"}>{e.overdue ? "Overdue" : <>due <LocalTime iso={e.dueAt} /></>}</span> : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">No escalations match these filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      {openId ? <EscalationDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} /> : null}
    </div>
  );
}

function EscalationDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch(`/api/escalations/${id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => undefined);
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  const active = d?.status === "PENDING" || d?.status === "ACKNOWLEDGED";
  const canBump = d && active && d.level < d.maxLevel;
  const [promoteCat, setPromoteCat] = useState("BEHAVIOUR");
  const [showPromote, setShowPromote] = useState(false);

  async function act(action: "acknowledge" | "bump" | "resolve", body: Record<string, unknown>) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/escalations/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Action failed."); return; }
      setNote(""); reload(); onChanged();
    } finally { setBusy(false); }
  }
  async function promote() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/escalations/${id}/promote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: promoteCat, summary: note || undefined }) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Could not promote to an incident."); return; }
      setShowPromote(false); setNote(""); reload(); onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-panel shadow-xl" onClick={(e) => e.stopPropagation()}>
        {!d ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading…</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-hairline p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`${pill} ${SEV[d.severity]}`}>{cap(d.severity)}</span>
                  <span className={`${pill} ${STATUS[d.status]}`}>{cap(d.status)}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500"><ShieldAlert className="size-3.5 text-orange-500" /> L{d.level} · {d.levelLabel}</span>
                  {d.overdue ? <span className="text-xs font-medium text-rose-600">Overdue</span> : null}
                </div>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">{d.title}</h2>
                <p className="text-sm text-slate-500">{d.employeeName}{d.department ? ` · ${d.department}` : ""}</p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button>
            </div>

            <div className="space-y-5 p-5">
              {d.detail ? <p className="rounded-lg bg-panel-2 px-3 py-2.5 text-sm text-slate-700">{d.detail}</p> : null}
              {d.reason ? <p className="text-sm text-slate-500"><span className="font-medium text-slate-600">Reason:</span> {d.reason}</p> : null}
              {d.dueAt && active ? <p className="text-xs text-slate-500">SLA due <LocalTime iso={d.dueAt} /> — if unactioned it auto-escalates to the next level.</p> : null}
              {err ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">{err}</p> : null}

              {active ? (
                <div className="space-y-2 rounded-lg border border-hairline p-3">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note (required to resolve)…" className="w-full resize-none rounded-lg border border-hairline bg-panel px-3 py-2 text-sm focus:border-brand focus:outline-none" />
                  <div className="flex flex-wrap gap-2">
                    {d.status === "PENDING" ? <button disabled={busy} onClick={() => act("acknowledge", { note: note || undefined })} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">Acknowledge</button> : null}
                    {canBump ? <button disabled={busy} onClick={() => act("bump", { note: note || undefined })} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50"><ArrowUpNarrowWide className="size-4" /> Bump a level</button> : null}
                    <button disabled={busy || !note.trim()} onClick={() => act("resolve", { note })} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">Resolve</button>
                    {!showPromote ? <button disabled={busy} onClick={() => setShowPromote(true)} className="rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Promote to incident…</button> : null}
                  </div>
                  {/* Promote to a formal incident (needs incident.manage; a 403 surfaces as an error). */}
                  {showPromote ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-panel-2 p-2.5">
                      <span className="text-xs text-slate-500">Category</span>
                      <select value={promoteCat} onChange={(e) => setPromoteCat(e.target.value)} className="rounded-lg border border-hairline bg-panel px-2.5 py-1 text-sm">
                        {["ATTENDANCE", "PRODUCTIVITY", "BEHAVIOUR", "SECURITY", "COMPLIANCE"].map((c) => <option key={c} value={c}>{cap(c)}</option>)}
                      </select>
                      <button disabled={busy} onClick={promote} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">Create incident</button>
                      <button onClick={() => setShowPromote(false)} className="text-xs text-slate-500 hover:text-slate-800">Cancel</button>
                    </div>
                  ) : null}
                </div>
              ) : d.status === "PROMOTED" ? (
                <p className="inline-flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800 ring-1 ring-inset ring-violet-100"><ShieldAlert className="size-4" /> This escalation was promoted to a formal incident — track it in Incidents.</p>
              ) : d.resolutionNote ? (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-100"><span className="font-medium">Resolution:</span> {d.resolutionNote}</p>
              ) : null}

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Escalation timeline</p>
                <ul className="space-y-2.5 border-l border-hairline pl-4">
                  {d.timeline.map((t) => (
                    <li key={t.id} className="relative">
                      <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-orange-500" />
                      <div className="text-sm text-slate-700">{cap(t.kind)}{t.level ? <span className="text-slate-500"> → L{t.level}</span> : null}{t.note ? <span className="text-slate-500"> — {t.note}</span> : null}</div>
                      <div className="text-[11px] text-slate-400"><LocalTime iso={t.createdAt} /></div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
