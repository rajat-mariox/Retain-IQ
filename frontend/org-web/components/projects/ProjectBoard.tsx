"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { PriorityBadge } from "@/components/ui/badges";
import type { ProjectDetail, ProjectPerson, ProjectSettings, ProjectTask } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { colorOf, labelOf } from "@/lib/project-labels";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";
const COLUMNS = [
  { key: "TODO", label: "To do" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "IN_REVIEW", label: "In review" },
  { key: "DONE", label: "Done" },
];
const FALLBACK_PRIORITIES = [
  { key: "LOW", label: "Low" },
  { key: "MEDIUM", label: "Medium" },
  { key: "HIGH", label: "High" },
  { key: "URGENT", label: "Urgent" },
];
const toIso = (d: string) => (d ? new Date(`${d}T00:00:00.000Z`).toISOString() : null);
const initials = (name: string) => name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

type Draft = { id: string | null; title: string; description: string; status: string; priority: string; assigneeEmployeeId: string; dueDate: string };

export function ProjectBoard({ project, canManage, viewerEmployeeId, people, settings }: { project: ProjectDetail; canManage: boolean; viewerEmployeeId?: string | null; people: ProjectPerson[]; settings?: ProjectSettings | null }) {
  const router = useRouter();
  const priorities = settings?.priorities?.length ? settings.priorities : FALLBACK_PRIORITIES;
  const defaultPriority = settings?.defaultTaskPriority ?? "MEDIUM";
  const emptyDraft = (status: string): Draft => ({ id: null, title: "", description: "", status, priority: defaultPriority, assigneeEmployeeId: "", dueDate: "" });
  const [tasks, setTasks] = useState<ProjectTask[]>(project.tasks);
  const [dragId, setDragId] = useState<string | null>(null);
  const [modal, setModal] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the server sends fresh data (after router.refresh()).
  useEffect(() => { setTasks(project.tasks); }, [project.tasks]);

  // A manager can move any task; an assignee can drag only their own between
  // columns. (They still can't open the edit modal or add tasks — that's canManage.)
  const canMoveTask = (t: ProjectTask) => canManage || (viewerEmployeeId != null && t.assigneeEmployeeId === viewerEmployeeId);
  const draggingTask = dragId ? tasks.find((t) => t.id === dragId) ?? null : null;
  const canDropHere = canManage || (draggingTask != null && canMoveTask(draggingTask));

  const done = tasks.filter((t) => t.status === "DONE").length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : project.progress;

  async function moveTask(id: string, status: string) {
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    router.refresh();
  }

  async function saveTask() {
    if (!modal) return;
    setError(null);
    if (!modal.title.trim()) { setError("Task title is required."); return; }
    const payload = {
      title: modal.title.trim(),
      description: modal.description.trim() || null,
      status: modal.status,
      priority: modal.priority,
      assigneeEmployeeId: modal.assigneeEmployeeId || null,
      dueDate: toIso(modal.dueDate),
    };
    setBusy(true);
    try {
      const res = await fetch(modal.id ? `/api/tasks/${modal.id}` : `/api/projects/${project.id}/tasks`, {
        method: modal.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? "Could not save task."); return; }
      setModal(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteTask() {
    if (!modal?.id) return;
    setBusy(true);
    try {
      await fetch(`/api/tasks/${modal.id}`, { method: "DELETE" });
      setModal(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const openEdit = (t: ProjectTask) => setModal({ id: t.id, title: t.title, description: t.description ?? "", status: t.status, priority: t.priority, assigneeEmployeeId: t.assigneeEmployeeId ?? "", dueDate: t.dueDate?.slice(0, 10) ?? "" });

  return (
    <div>
      {/* live progress summary */}
      <div className="mb-4 rounded-2xl border border-hairline bg-panel/70 p-4">
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="font-medium text-slate-700">{done}/{tasks.length} tasks done</span>
          <span className="tabular-nums text-slate-500">{progress}%</span>
        </div>
        <span className="block h-2 overflow-hidden rounded-full bg-panel-2"><span className={`block h-full rounded-full ${project.delayed ? "bg-rose-500" : "bg-brand"}`} style={{ width: `${progress}%` }} /></span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.key);
          return (
            <div
              key={col.key}
              onDragOver={(e) => { if (canDropHere) e.preventDefault(); }}
              onDrop={() => { if (canDropHere && dragId) { void moveTask(dragId, col.key); setDragId(null); } }}
              className="rounded-2xl border border-hairline bg-panel/60 p-3"
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-slate-700">{col.label}</span>
                <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-slate-500">{colTasks.length}</span>
              </div>
              <div className="space-y-2">
                {colTasks.map((t) => {
                  const movable = canMoveTask(t);
                  return (
                  <div
                    key={t.id}
                    draggable={movable}
                    onDragStart={() => movable && setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => canManage && openEdit(t)}
                    className={`rounded-xl border border-hairline bg-panel p-3 shadow-[0_1px_2px_0_rgba(15,23,42,0.04)] ${canManage ? "cursor-pointer hover:border-brand/40" : movable ? "cursor-grab hover:border-brand/40" : ""} ${dragId === t.id ? "opacity-50" : ""}`}
                  >
                    {/* Title opens the task page; clicking elsewhere on the card
                        still opens the inline edit modal for managers. */}
                    <Link
                      href={`/tasks/${t.id}`}
                      draggable={false}
                      onClick={(e) => e.stopPropagation()}
                      className="block text-sm font-medium text-slate-800 hover:text-brand hover:underline"
                    >
                      {t.title}
                    </Link>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <PriorityBadge priority={t.priority} label={labelOf(priorities, t.priority)} color={colorOf(priorities, t.priority)} />
                      <div className="flex items-center gap-2">
                        {t.dueDate ? <span className="text-[11px] text-slate-400">{formatDate(t.dueDate)}</span> : null}
                        {t.assigneeName ? (
                          <span title={t.assigneeName} className="grid size-5 place-items-center rounded-full bg-panel-2 text-[9px] font-semibold text-slate-600">{initials(t.assigneeName)}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  );
                })}
                {canManage ? (
                  <button onClick={() => setModal(emptyDraft(col.key))} className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-hairline py-2 text-xs text-slate-400 hover:border-brand/40 hover:text-brand"><Plus className="size-3.5" /> Add task</button>
                ) : colTasks.length === 0 ? <p className="px-1 py-3 text-center text-xs text-slate-400">No tasks</p> : null}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={Boolean(modal)} onClose={() => setModal(null)} title={modal?.id ? "Edit task" : "New task"}>
        {modal ? (
          <div className="space-y-4">
            <div><label className={label}>Title</label><input className={input} value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} placeholder="e.g. Wire up login API" /></div>
            <div><label className={label}>Description</label><textarea rows={2} className={input} value={modal.description} onChange={(e) => setModal({ ...modal, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Status</label><select className={input} value={modal.status} onChange={(e) => setModal({ ...modal, status: e.target.value })}>{COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
              <div><label className={label}>Priority</label><select className={input} value={modal.priority} onChange={(e) => setModal({ ...modal, priority: e.target.value })}>{priorities.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
              <div><label className={label}>Assignee</label><select className={input} value={modal.assigneeEmployeeId} onChange={(e) => setModal({ ...modal, assigneeEmployeeId: e.target.value })}><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><label className={label}>Due date</label><input type="date" className={input} value={modal.dueDate} onChange={(e) => setModal({ ...modal, dueDate: e.target.value })} /></div>
            </div>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className="flex items-center justify-between pt-1">
              {modal.id ? <button onClick={deleteTask} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="size-4" /> Delete</button> : <span />}
              <div className="flex gap-2">
                <button onClick={() => setModal(null)} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
                <button onClick={saveTask} disabled={busy} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{busy ? "Saving…" : modal.id ? "Save" : "Add task"}</button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
