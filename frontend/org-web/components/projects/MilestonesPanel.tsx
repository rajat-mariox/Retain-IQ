"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Flag, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { ProjectMilestone, ProjectPerson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useSubmitLock } from "@/lib/hooks";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";
const toIso = (d: string) => (d ? new Date(`${d}T00:00:00.000Z`).toISOString() : null);
const STATUS: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600 ring-slate-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 ring-amber-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};
const STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"];
const label_ = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ");

type Draft = { id: string | null; title: string; description: string; status: string; ownerEmployeeId: string; dueDate: string; progress: string };
const empty = (): Draft => ({ id: null, title: "", description: "", status: "PENDING", ownerEmployeeId: "", dueDate: "", progress: "0" });

export function MilestonesPanel({ projectId, milestones, canManage, people }: { projectId: string; milestones: ProjectMilestone[]; canManage: boolean; people: ProjectPerson[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards the inline toggle/delete icons — a double-click on the completion
  // circle would otherwise flip status twice and land on the wrong state.
  const { busy: rowBusy, run } = useSubmitLock();

  const openEdit = (m: ProjectMilestone) => setModal({ id: m.id, title: m.title, description: m.description ?? "", status: m.status, ownerEmployeeId: m.ownerEmployeeId ?? "", dueDate: m.dueDate?.slice(0, 10) ?? "", progress: String(m.progress) });

  async function save() {
    if (!modal) return;
    setError(null);
    if (!modal.title.trim()) { setError("Milestone title is required."); return; }
    const payload = { title: modal.title.trim(), description: modal.description.trim() || null, status: modal.status, ownerEmployeeId: modal.ownerEmployeeId || null, dueDate: toIso(modal.dueDate), progress: Number(modal.progress) || 0 };
    setBusy(true);
    try {
      const res = await fetch(modal.id ? `/api/milestones/${modal.id}` : `/api/projects/${projectId}/milestones`, { method: modal.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? "Could not save milestone."); return; }
      setModal(null);
      router.refresh();
    } finally { setBusy(false); }
  }
  async function toggle(m: ProjectMilestone) {
    await run(async () => {
      await fetch(`/api/milestones/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: m.status === "COMPLETED" ? "IN_PROGRESS" : "COMPLETED" }) });
      router.refresh();
    });
  }
  async function remove(id: string) {
    await run(async () => {
      await fetch(`/api/milestones/${id}`, { method: "DELETE" });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader title="Milestones" subtitle="Key checkpoints" action={canManage ? <button onClick={() => { setError(null); setModal(empty()); }} className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><Plus className="size-3.5" /> Add</button> : undefined} />
      <ul className="divide-y divide-hairline/60">
        {milestones.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No milestones yet.</li> : milestones.map((m) => {
          const overdue = m.status !== "COMPLETED" && m.dueDate && new Date(m.dueDate).getTime() < Date.now();
          return (
            <li key={m.id} className="flex items-start gap-3 px-5 py-3">
              <button disabled={!canManage || rowBusy} onClick={() => toggle(m)} className="mt-0.5 text-slate-300 enabled:hover:text-emerald-600 disabled:cursor-default disabled:opacity-60">
                {m.status === "COMPLETED" ? <CheckCircle2 className="size-5 text-emerald-500" /> : <Circle className="size-5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${m.status === "COMPLETED" ? "text-slate-400 line-through" : "text-slate-800"}`}>{m.title}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${STATUS[m.status]}`}>{label_(m.status)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="block h-1.5 w-24 overflow-hidden rounded-full bg-panel-2"><span className="block h-full rounded-full bg-brand" style={{ width: `${m.progress}%` }} /></span>
                  <span className="text-[11px] tabular-nums text-slate-400">{m.progress}%</span>
                  {m.ownerName ? <span className="text-[11px] text-slate-400">· {m.ownerName}</span> : null}
                  {m.dueDate ? <span className={`text-[11px] ${overdue ? "font-medium text-rose-600" : "text-slate-400"}`}>· {formatDate(m.dueDate)}</span> : null}
                </div>
              </div>
              {canManage ? (
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => openEdit(m)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-3.5" /></button>
                  <button disabled={rowBusy} onClick={() => remove(m.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50"><Trash2 className="size-3.5" /></button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Modal open={Boolean(modal)} onClose={() => setModal(null)} title={modal?.id ? "Edit milestone" : "New milestone"}>
        {modal ? (
          <div className="space-y-4">
            <div><label className={label}>Title</label><input className={input} value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} placeholder="e.g. Beta release" /></div>
            <div><label className={label}>Description</label><textarea rows={2} className={input} value={modal.description} onChange={(e) => setModal({ ...modal, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Status</label><select className={input} value={modal.status} onChange={(e) => setModal({ ...modal, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{label_(s)}</option>)}</select></div>
              <div><label className={label}>Progress %</label><input type="number" min={0} max={100} className={input} value={modal.progress} onChange={(e) => setModal({ ...modal, progress: e.target.value })} /></div>
              <div><label className={label}>Owner</label><select className={input} value={modal.ownerEmployeeId} onChange={(e) => setModal({ ...modal, ownerEmployeeId: e.target.value })}><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><label className={label}>Due date</label><input type="date" className={input} value={modal.dueDate} onChange={(e) => setModal({ ...modal, dueDate: e.target.value })} /></div>
            </div>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-2"><button onClick={() => setModal(null)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={save} disabled={busy} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{busy ? "Saving…" : "Save"}</button></div>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
