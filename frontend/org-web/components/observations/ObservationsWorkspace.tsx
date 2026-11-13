"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, AlertTriangle, CircleCheck, Inbox, Plus, X, Paperclip, Loader2, Sparkles, UserPlus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { LocalTime } from "@/components/ui/LocalTime";
import { EscalationsPanel } from "./EscalationsPanel";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type Status = "OPEN" | "ACKNOWLEDGED" | "ESCALATED" | "RESOLVED" | "DISMISSED";

interface EmployeeOpt { id: string; name: string }
interface ListItem {
  id: string;
  employeeName: string;
  department: string | null;
  source: "AI" | "MANUAL";
  type: string;
  severity: Severity;
  status: Status;
  title: string;
  createdAt: string;
}
interface Summary { open: number; acknowledged: number; escalated: number; highOrCritical: number; mine: number }
interface Detail extends ListItem {
  detail: string | null;
  metric: Record<string, unknown> | null;
  resolutionNote: string | null;
  timeline: { id: string; kind: string; actorUserId: string | null; note: string | null; createdAt: string }[];
  comments: { id: string; authorUserId: string; body: string; createdAt: string }[];
}
interface Evidence { id: string; fileName: string; sizeBytes: number; viewUrl: string }

const SEV: Record<Severity, string> = {
  LOW: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  MEDIUM: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  HIGH: "bg-orange-500/10 text-orange-700 ring-orange-600/20",
  CRITICAL: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
};
const STATUS: Record<Status, string> = {
  OPEN: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  ACKNOWLEDGED: "bg-indigo-500/10 text-indigo-700 ring-indigo-600/20",
  ESCALATED: "bg-orange-500/10 text-orange-700 ring-orange-600/20",
  RESOLVED: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  DISMISSED: "bg-slate-500/10 text-slate-500 ring-slate-500/20",
};
const TYPE_LABEL: Record<string, string> = {
  PRODUCTIVITY_DROP: "Productivity drop",
  BURNOUT_RISK: "Burnout risk",
  LOW_ENGAGEMENT: "Low engagement",
  ATTENDANCE_ANOMALY: "Attendance anomaly",
  LATE_PATTERN: "Late pattern",
  BEHAVIOUR: "Behaviour",
  OTHER: "Other",
};
const pill = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset";
const input = "rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm text-slate-900 focus:border-brand focus:outline-none";
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function ObservationsWorkspace({ employees }: { employees: EmployeeOpt[] }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [sevFilter, setSevFilter] = useState("");
  const [mine, setMine] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showRaise, setShowRaise] = useState(false);
  const [tab, setTab] = useState<"observations" | "escalations">("observations");

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (statusFilter) qs.set("status", statusFilter);
    if (sevFilter) qs.set("severity", sevFilter);
    if (mine) qs.set("mine", "1");
    fetch(`/api/observations?${qs.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setSummary(d.summary); setItems(d.items ?? []); } })
      .catch(() => undefined);
  }, [statusFilter, sevFilter, mine]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      {/* Workflow tabs: Observations → Escalations */}
      <div className="flex gap-1 rounded-lg border border-hairline bg-panel p-1">
        {(["observations", "escalations"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${tab === t ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "escalations" ? <EscalationsPanel /> : (
      <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
        <StatTile label="Open" value={String(summary?.open ?? 0)} icon={Inbox} accent="#0ea5e9" />
        <StatTile label="Acknowledged" value={String(summary?.acknowledged ?? 0)} icon={CircleCheck} accent="#6366f1" />
        <StatTile label="High / Critical" value={String(summary?.highOrCritical ?? 0)} icon={AlertTriangle} accent="#e5484d" hint="Still open" />
        <StatTile label="Escalated" value={String(summary?.escalated ?? 0)} icon={ShieldAlert} accent="#ea580c" />
        <StatTile label="Assigned to me" value={String(summary?.mine ?? 0)} icon={UserPlus} accent="#0d9488" />
      </div>

      <Card>
        <CardHeader
          title="Observations"
          subtitle="AI-detected and manually raised concerns — acknowledge, comment, resolve or escalate"
          action={
            <button onClick={() => setShowRaise(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-95">
              <Plus className="size-4" /> Raise observation
            </button>
          }
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={input}>
            <option value="">All statuses</option>
            {["OPEN", "ACKNOWLEDGED", "ESCALATED", "RESOLVED", "DISMISSED"].map((s) => <option key={s} value={s}>{cap(s)}</option>)}
          </select>
          <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value)} className={input}>
            <option value="">All severities</option>
            {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s} value={s}>{cap(s)}</option>)}
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
                <th className="px-5 py-3 text-left font-medium">Source</th>
                <th className="px-5 py-3 text-left font-medium">Severity</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Raised</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} onClick={() => setOpenId(o.id)} className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-900">{o.employeeName}</div>
                    {o.department ? <div className="text-[11px] text-slate-400">{o.department}</div> : null}
                  </td>
                  <td className="px-5 py-3">
                    <div className="text-slate-800">{o.title}</div>
                    <div className="text-[11px] text-slate-400">{TYPE_LABEL[o.type] ?? o.type}</div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      {o.source === "AI" ? <><Sparkles className="size-3.5 text-violet-500" /> AI</> : <><UserPlus className="size-3.5 text-slate-400" /> Manual</>}
                    </span>
                  </td>
                  <td className="px-5 py-3"><span className={`${pill} ${SEV[o.severity]}`}>{cap(o.severity)}</span></td>
                  <td className="px-5 py-3"><span className={`${pill} ${STATUS[o.status]}`}>{cap(o.status)}</span></td>
                  <td className="px-5 py-3 text-right text-xs text-slate-500"><LocalTime iso={o.createdAt} /></td>
                </tr>
              ))}
              {items.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">No observations match these filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      {openId ? <DetailDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} /> : null}
      {showRaise ? <RaiseModal employees={employees} onClose={() => setShowRaise(false)} onCreated={() => { setShowRaise(false); load(); }} /> : null}
      </div>
      )}
    </div>
  );
}

function DetailDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch(`/api/observations/${id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => undefined);
    fetch(`/api/observations/${id}/evidence`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).then((e) => setEvidence(Array.isArray(e) ? e : [])).catch(() => undefined);
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  const closed = d?.status === "RESOLVED" || d?.status === "DISMISSED";
  const escalated = d?.status === "ESCALATED";

  async function act(action: "acknowledge" | "resolve" | "dismiss", body: Record<string, unknown>) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/observations/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Action failed."); return; }
      setNote(""); reload(); onChanged();
    } finally { setBusy(false); }
  }
  async function escalate() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/observations/${id}/escalate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: note || undefined }) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Could not escalate."); return; }
      setNote(""); reload(); onChanged();
    } finally { setBusy(false); }
  }
  async function addComment() {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/observations/${id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: comment }) });
      setComment(""); reload();
    } finally { setBusy(false); }
  }
  async function uploadEvidence(file: File) {
    setBusy(true); setErr(null);
    try {
      const meta = await fetch(`/api/observations/${id}/evidence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size }) });
      if (!meta.ok) { setErr((await meta.json().catch(() => ({}))).error ?? "Upload failed."); return; }
      const { uploadUrl } = await meta.json();
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      reload();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-panel shadow-xl" onClick={(e) => e.stopPropagation()}>
        {!d ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading…</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-hairline p-5">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`${pill} ${SEV[d.severity]}`}>{cap(d.severity)}</span>
                  <span className={`${pill} ${STATUS[d.status]}`}>{cap(d.status)}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-400">{d.source === "AI" ? <><Sparkles className="size-3.5 text-violet-500" /> AI</> : "Manual"}</span>
                </div>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">{d.title}</h2>
                <p className="text-sm text-slate-500">{d.employeeName}{d.department ? ` · ${d.department}` : ""} · {TYPE_LABEL[d.type] ?? d.type}</p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button>
            </div>

            <div className="space-y-5 p-5">
              {d.detail ? <p className="rounded-lg bg-panel-2 px-3 py-2.5 text-sm text-slate-700">{d.detail}</p> : null}
              {err ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">{err}</p> : null}

              {/* Actions */}
              {escalated ? (
                <p className="inline-flex items-center gap-2 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800 ring-1 ring-inset ring-orange-100"><ShieldAlert className="size-4" /> This observation has been escalated — it's now tracked in the Escalations tab.</p>
              ) : !closed ? (
                <div className="space-y-2 rounded-lg border border-hairline p-3">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note (required to resolve/dismiss)…" className="w-full resize-none rounded-lg border border-hairline bg-panel px-3 py-2 text-sm focus:border-brand focus:outline-none" />
                  <div className="flex flex-wrap gap-2">
                    {d.status === "OPEN" ? <button disabled={busy} onClick={() => act("acknowledge", { note: note || undefined })} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">Acknowledge</button> : null}
                    {d.status !== "ESCALATED" ? <button disabled={busy} onClick={escalate} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50"><ShieldAlert className="size-4" /> Escalate</button> : null}
                    <button disabled={busy || !note.trim()} onClick={() => act("resolve", { note })} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">Resolve</button>
                    <button disabled={busy || !note.trim()} onClick={() => act("dismiss", { note })} className="rounded-lg border border-hairline px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Dismiss</button>
                    <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                      <Paperclip className="size-4" /> Evidence
                      <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadEvidence(f); e.target.value = ""; }} />
                    </label>
                  </div>
                </div>
              ) : d.resolutionNote ? (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-100"><span className="font-medium">Resolution:</span> {d.resolutionNote}</p>
              ) : null}

              {/* Evidence */}
              {evidence.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Evidence</p>
                  <div className="flex flex-wrap gap-1.5">
                    {evidence.map((e) => (
                      <a key={e.id} href={e.viewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-panel-2 px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-hairline hover:text-brand">
                        <Paperclip className="size-3" /> <span className="max-w-[140px] truncate">{e.fileName}</span>
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Timeline */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Timeline</p>
                <ul className="space-y-2.5 border-l border-hairline pl-4">
                  {d.timeline.map((t) => (
                    <li key={t.id} className="relative">
                      <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-brand" />
                      <div className="text-sm text-slate-700">{cap(t.kind)}{t.note ? <span className="text-slate-500"> — {t.note}</span> : null}</div>
                      <div className="text-[11px] text-slate-400"><LocalTime iso={t.createdAt} /></div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Comments */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Comments</p>
                <ul className="space-y-2">
                  {d.comments.map((c) => (
                    <li key={c.id} className="rounded-lg bg-panel-2 px-3 py-2 text-sm text-slate-700">
                      {c.body}
                      <div className="mt-0.5 text-[11px] text-slate-400"><LocalTime iso={c.createdAt} /></div>
                    </li>
                  ))}
                  {d.comments.length === 0 ? <li className="text-sm text-slate-400">No comments yet.</li> : null}
                </ul>
                <div className="mt-2 flex gap-2">
                  <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addComment(); }} placeholder="Add a comment…" className="flex-1 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm focus:border-brand focus:outline-none" />
                  <button disabled={busy || !comment.trim()} onClick={addComment} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : "Post"}</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RaiseModal({ employees, onClose, onCreated }: { employees: EmployeeOpt[]; onClose: () => void; onCreated: () => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("BEHAVIOUR");
  const [severity, setSeverity] = useState<Severity>("MEDIUM");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!employeeId || title.trim().length < 3) { setErr("Pick an employee and enter a title (3+ chars)."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/observations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId, type, severity, title, detail: detail || undefined }) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Could not raise the observation."); return; }
      onCreated();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Raise an observation</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button>
        </div>
        {err ? <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">{err}</p> : null}
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Employee</span>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={`${input} w-full`}>
              <option value="">Select…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Type</span>
              <select value={type} onChange={(e) => setType(e.target.value)} className={`${input} w-full`}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Severity</span>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className={`${input} w-full`}>
                {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => <option key={s} value={s}>{cap(s)}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Repeated late arrivals" className={`${input} w-full`} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Detail (optional)</span>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-hairline bg-panel px-3 py-2 text-sm focus:border-brand focus:outline-none" />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-hairline px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button disabled={busy} onClick={submit} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">{busy ? "Raising…" : "Raise observation"}</button>
        </div>
      </div>
    </div>
  );
}
