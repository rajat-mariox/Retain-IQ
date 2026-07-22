"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { ProjectGoal, ProjectPerson } from "@/lib/api";
import { formatDate } from "@/lib/format";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";
const toIso = (d: string) => (d ? new Date(`${d}T00:00:00.000Z`).toISOString() : null);
const STATUS: Record<string, string> = {
  ACTIVE: "bg-sky-50 text-sky-700 ring-sky-200",
  ACHIEVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  MISSED: "bg-rose-50 text-rose-700 ring-rose-200",
  ARCHIVED: "bg-slate-100 text-slate-500 ring-slate-200",
};
const STATUSES = ["ACTIVE", "ACHIEVED", "MISSED", "ARCHIVED"];

type Draft = { id: string | null; title: string; description: string; projectId: string; metric: string; target: string; current: string; ownerEmployeeId: string; dueDate: string; status: string };
const empty = (projectId = ""): Draft => ({ id: null, title: "", description: "", projectId, metric: "", target: "", current: "", ownerEmployeeId: "", dueDate: "", status: "ACTIVE" });

export function GoalsWorkspace({ goals, canManage, people, projects, lockedProjectId }: { goals: ProjectGoal[]; canManage: boolean; people: ProjectPerson[]; projects: { id: string; name: string }[]; lockedProjectId?: string }) {
  const router = useRouter();
  const [modal, setModal] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openEdit = (g: ProjectGoal) => setModal({ id: g.id, title: g.title, description: g.description ?? "", projectId: g.projectId ?? "", metric: g.metric ?? "", target: g.target != null ? String(g.target) : "", current: String(g.current), ownerEmployeeId: g.ownerEmployeeId ?? "", dueDate: g.dueDate?.slice(0, 10) ?? "", status: g.status });

  async function save() {
    if (!modal) return;
    setError(null);
    if (!modal.title.trim()) { setError("Goal title is required."); return; }
    const payload: Record<string, unknown> = {
      title: modal.title.trim(),
      description: modal.description.trim() || null,
      metric: modal.metric.trim() || null,
      target: modal.target ? Number(modal.target) : null,
      current: modal.current ? Number(modal.current) : 0,
      ownerEmployeeId: modal.ownerEmployeeId || null,
      dueDate: toIso(modal.dueDate),
    };
    if (modal.id) payload.status = modal.status;
    else payload.projectId = (lockedProjectId ?? modal.projectId) || null;
    setBusy(true);
    try {
      const res = await fetch(modal.id ? `/api/goals/${modal.id}` : "/api/goals", { method: modal.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? "Could not save goal."); return; }
      setModal(null);
      router.refresh();
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    await fetch(`/api/goals/${id}`, { method: "DELETE" });
    router.refresh();
  }
  async function markAchieved(g: ProjectGoal) {
    await fetch(`/api/goals/${g.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "ACHIEVED" }) });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <button onClick={() => { setError(null); setModal(empty(lockedProjectId)); }} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-soft"><Plus className="size-4" /> New goal</button>
        </div>
      ) : null}

      {goals.length === 0 ? (
        <Card><p className="px-5 py-12 text-center text-sm text-slate-500">No goals yet.{canManage ? " Create one to start tracking achievement." : ""}</p></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {goals.map((g) => (
            <Card key={g.id} className="h-full">
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-lg bg-brand/10 text-brand"><Target className="size-4" /></span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS[g.status] ?? STATUS.ACTIVE}`}>{g.status.toLowerCase()}</span>
                  </div>
                  {canManage ? (
                    <div className="flex gap-1">
                      {g.status === "ACTIVE" ? <button title="Mark achieved" onClick={() => markAchieved(g)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"><CheckCircle2 className="size-4" /></button> : null}
                      <button title="Edit" onClick={() => openEdit(g)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-3.5" /></button>
                      <button title="Delete" onClick={() => remove(g.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"><Trash2 className="size-3.5" /></button>
                    </div>
                  ) : null}
                </div>
                <h3 className="mt-3 font-semibold text-slate-900">{g.title}</h3>
                {g.description ? <p className="mt-1 line-clamp-2 text-sm text-slate-500">{g.description}</p> : null}
                {g.projectName ? <p className="mt-1 text-xs text-slate-400">Project · {g.projectName}</p> : null}

                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
                    <span>{g.metric ? `${g.current}${g.target != null ? ` / ${g.target}` : ""} ${g.metric}` : "Progress"}</span>
                    <span className="tabular-nums">{g.progress}%</span>
                  </div>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-panel-2"><span className={`block h-full rounded-full ${g.status === "MISSED" ? "bg-rose-500" : "bg-brand"}`} style={{ width: `${g.progress}%` }} /></span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                  <span>{g.ownerName ?? "No owner"}</span>
                  <span>{g.dueDate ? `Due ${formatDate(g.dueDate)}` : ""}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={Boolean(modal)} onClose={() => setModal(null)} title={modal?.id ? "Edit goal" : "New goal"} size="lg">
        {modal ? (
          <div className="space-y-4">
            <div><label className={label}>Goal title</label><input className={input} value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} placeholder="e.g. Reach 500 active users" /></div>
            <div><label className={label}>Description</label><textarea rows={2} className={input} value={modal.description} onChange={(e) => setModal({ ...modal, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              {!lockedProjectId && !modal.id ? (
                <div className="col-span-2"><label className={label}>Project (optional)</label><select className={input} value={modal.projectId} onChange={(e) => setModal({ ...modal, projectId: e.target.value })}><option value="">Organization goal</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              ) : null}
              <div><label className={label}>Metric</label><input className={input} value={modal.metric} onChange={(e) => setModal({ ...modal, metric: e.target.value })} placeholder="e.g. Users" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Current</label><input type="number" className={input} value={modal.current} onChange={(e) => setModal({ ...modal, current: e.target.value })} /></div>
                <div><label className={label}>Target</label><input type="number" className={input} value={modal.target} onChange={(e) => setModal({ ...modal, target: e.target.value })} /></div>
              </div>
              <div><label className={label}>Owner</label><select className={input} value={modal.ownerEmployeeId} onChange={(e) => setModal({ ...modal, ownerEmployeeId: e.target.value })}><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><label className={label}>Due date</label><input type="date" className={input} value={modal.dueDate} onChange={(e) => setModal({ ...modal, dueDate: e.target.value })} /></div>
              {modal.id ? <div className="col-span-2"><label className={label}>Status</label><select className={input} value={modal.status} onChange={(e) => setModal({ ...modal, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></div> : null}
            </div>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setModal(null)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{busy ? "Saving…" : modal.id ? "Save" : "Create goal"}</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
