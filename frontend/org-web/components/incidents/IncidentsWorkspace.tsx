"use client";

import { useCallback, useEffect, useState } from "react";
import { Siren, FileSearch, CircleCheck, Inbox, Plus, X, Paperclip, ArrowUpRight } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { LocalTime } from "@/components/ui/LocalTime";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type Category = "ATTENDANCE" | "PRODUCTIVITY" | "BEHAVIOUR" | "SECURITY" | "COMPLIANCE";
type Status = "OPEN" | "INVESTIGATING" | "RESOLVED" | "CLOSED";

interface EmployeeOpt { id: string; name: string }
interface ListItem {
  id: string;
  reference: string;
  employeeName: string | null;
  category: Category;
  severity: Severity;
  status: Status;
  title: string;
  fromEscalation: boolean;
  createdAt: string;
}
interface Summary { open: number; investigating: number; resolved: number; mine: number }
interface Detail extends ListItem {
  department: string | null;
  summary: string | null;
  investigationNote: string | null;
  resolutionNote: string | null;
  escalationId: string | null;
  timeline: { id: string; kind: string; actorUserId: string | null; note: string | null; createdAt: string }[];
  comments: { id: string; authorUserId: string; body: string; createdAt: string }[];
}
interface Evidence { id: string; fileName: string; viewUrl: string }

const SEV: Record<Severity, string> = {
  LOW: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  MEDIUM: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  HIGH: "bg-orange-500/10 text-orange-700 ring-orange-600/20",
  CRITICAL: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
};
const STATUS: Record<Status, string> = {
  OPEN: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  INVESTIGATING: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  RESOLVED: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  CLOSED: "bg-slate-500/10 text-slate-500 ring-slate-500/20",
};
const CATEGORIES: Category[] = ["ATTENDANCE", "PRODUCTIVITY", "BEHAVIOUR", "SECURITY", "COMPLIANCE"];
const pill = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset";
const input = "rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm text-slate-900 focus:border-brand focus:outline-none";
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function IncidentsWorkspace({ employees }: { employees: EmployeeOpt[] }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showOpen, setShowOpen] = useState(false);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (statusFilter) qs.set("status", statusFilter);
    if (catFilter) qs.set("category", catFilter);
    fetch(`/api/incidents?${qs.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setSummary(d.summary); setItems(d.items ?? []); } })
      .catch(() => undefined);
  }, [statusFilter, catFilter]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Open" value={String(summary?.open ?? 0)} icon={Inbox} accent="#0ea5e9" />
        <StatTile label="Investigating" value={String(summary?.investigating ?? 0)} icon={FileSearch} accent="#d97706" />
        <StatTile label="Resolved" value={String(summary?.resolved ?? 0)} icon={CircleCheck} accent="#16a34a" />
        <StatTile label="Assigned to me" value={String(summary?.mine ?? 0)} icon={Siren} accent="#e5484d" />
      </div>

      <Card>
        <CardHeader
          title="Incidents"
          subtitle="Formal cases — investigate, resolve and close"
          action={
            <button onClick={() => setShowOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-95">
              <Plus className="size-4" /> Open incident
            </button>
          }
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={input}>
            <option value="">All statuses</option>
            {["OPEN", "INVESTIGATING", "RESOLVED", "CLOSED"].map((s) => <option key={s} value={s}>{cap(s)}</option>)}
          </select>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className={input}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Reference</th>
                <th className="px-5 py-3 text-left font-medium">Case</th>
                <th className="px-5 py-3 text-left font-medium">Category</th>
                <th className="px-5 py-3 text-left font-medium">Severity</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Opened</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} onClick={() => setOpenId(i.id)} className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <span className="font-mono text-xs font-medium text-slate-700">{i.reference}</span>
                    {i.fromEscalation ? <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-violet-600"><ArrowUpRight className="size-3" />escalated</span> : null}
                  </td>
                  <td className="px-5 py-3">
                    <div className="text-slate-800">{i.title}</div>
                    {i.employeeName ? <div className="text-[11px] text-slate-400">{i.employeeName}</div> : null}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{cap(i.category)}</td>
                  <td className="px-5 py-3"><span className={`${pill} ${SEV[i.severity]}`}>{cap(i.severity)}</span></td>
                  <td className="px-5 py-3"><span className={`${pill} ${STATUS[i.status]}`}>{cap(i.status)}</span></td>
                  <td className="px-5 py-3 text-right text-xs text-slate-500"><LocalTime iso={i.createdAt} /></td>
                </tr>
              ))}
              {items.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">No incidents match these filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      {openId ? <IncidentDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} /> : null}
      {showOpen ? <OpenModal employees={employees} onClose={() => setShowOpen(false)} onCreated={() => { setShowOpen(false); load(); }} /> : null}
    </div>
  );
}

function IncidentDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch(`/api/incidents/${id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => undefined);
    fetch(`/api/incidents/${id}/evidence`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).then((e) => setEvidence(Array.isArray(e) ? e : [])).catch(() => undefined);
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  async function act(action: "investigate" | "resolve" | "close", body: Record<string, unknown>) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/incidents/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Action failed."); return; }
      setNote(""); reload(); onChanged();
    } finally { setBusy(false); }
  }
  async function addComment() {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/incidents/${id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: comment }) });
      setComment(""); reload();
    } finally { setBusy(false); }
  }
  async function uploadEvidence(file: File) {
    setBusy(true); setErr(null);
    try {
      const meta = await fetch(`/api/incidents/${id}/evidence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size }) });
      if (!meta.ok) { setErr((await meta.json().catch(() => ({}))).error ?? "Upload failed."); return; }
      const { uploadUrl } = await meta.json();
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      reload();
    } finally { setBusy(false); }
  }

  const s = d?.status;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-panel shadow-xl" onClick={(e) => e.stopPropagation()}>
        {!d ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading…</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-hairline p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-medium text-slate-500">{d.reference}</span>
                  <span className={`${pill} ${SEV[d.severity]}`}>{cap(d.severity)}</span>
                  <span className={`${pill} ${STATUS[d.status]}`}>{cap(d.status)}</span>
                  <span className="text-xs text-slate-400">{cap(d.category)}</span>
                </div>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">{d.title}</h2>
                {d.employeeName ? <p className="text-sm text-slate-500">{d.employeeName}{d.department ? ` · ${d.department}` : ""}</p> : null}
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button>
            </div>

            <div className="space-y-5 p-5">
              {d.summary ? <p className="rounded-lg bg-panel-2 px-3 py-2.5 text-sm text-slate-700">{d.summary}</p> : null}
              {err ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">{err}</p> : null}

              {s !== "CLOSED" ? (
                <div className="space-y-2 rounded-lg border border-hairline p-3">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note (required to resolve)…" className="w-full resize-none rounded-lg border border-hairline bg-panel px-3 py-2 text-sm focus:border-brand focus:outline-none" />
                  <div className="flex flex-wrap gap-2">
                    {s === "OPEN" ? <button disabled={busy} onClick={() => act("investigate", { note: note || undefined })} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">Start investigation</button> : null}
                    {s !== "RESOLVED" ? <button disabled={busy || !note.trim()} onClick={() => act("resolve", { note })} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">Resolve</button> : null}
                    {s === "RESOLVED" ? <button disabled={busy} onClick={() => act("close", { note: note || undefined })} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">Close case</button> : null}
                    <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                      <Paperclip className="size-4" /> Evidence
                      <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadEvidence(f); e.target.value = ""; }} />
                    </label>
                  </div>
                </div>
              ) : d.resolutionNote ? (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-100"><span className="font-medium">Resolution:</span> {d.resolutionNote}</p>
              ) : null}

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

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Timeline</p>
                <ul className="space-y-2.5 border-l border-hairline pl-4">
                  {d.timeline.map((t) => (
                    <li key={t.id} className="relative">
                      <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-rose-500" />
                      <div className="text-sm text-slate-700">{cap(t.kind.replace(/_/g, " "))}{t.note ? <span className="text-slate-500"> — {t.note}</span> : null}</div>
                      <div className="text-[11px] text-slate-400"><LocalTime iso={t.createdAt} /></div>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Comments</p>
                <ul className="space-y-2">
                  {d.comments.map((c) => (
                    <li key={c.id} className="rounded-lg bg-panel-2 px-3 py-2 text-sm text-slate-700">{c.body}<div className="mt-0.5 text-[11px] text-slate-400"><LocalTime iso={c.createdAt} /></div></li>
                  ))}
                  {d.comments.length === 0 ? <li className="text-sm text-slate-400">No comments yet.</li> : null}
                </ul>
                <div className="mt-2 flex gap-2">
                  <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addComment(); }} placeholder="Add a comment…" className="flex-1 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm focus:border-brand focus:outline-none" />
                  <button disabled={busy || !comment.trim()} onClick={addComment} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">Post</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OpenModal({ employees, onClose, onCreated }: { employees: EmployeeOpt[]; onClose: () => void; onCreated: () => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [category, setCategory] = useState<Category>("BEHAVIOUR");
  const [severity, setSeverity] = useState<Severity>("MEDIUM");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (title.trim().length < 3) { setErr("Enter a title (3+ chars)."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/incidents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: employeeId || null, category, severity, title, summary: summary || undefined }) });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Could not open the incident."); return; }
      onCreated();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Open an incident</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button>
        </div>
        {err ? <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">{err}</p> : null}
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Employee (optional — leave blank for an org-level case)</span>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={`${input} w-full`}>
              <option value="">None (org-level)</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className={`${input} w-full`}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
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
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Policy violation — data handling" className={`${input} w-full`} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Summary (optional)</span>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-hairline bg-panel px-3 py-2 text-sm focus:border-brand focus:outline-none" />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-hairline px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button disabled={busy} onClick={submit} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">{busy ? "Opening…" : "Open incident"}</button>
        </div>
      </div>
    </div>
  );
}
