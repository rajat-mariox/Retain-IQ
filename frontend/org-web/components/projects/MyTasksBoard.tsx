"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PriorityBadge } from "@/components/ui/badges";
import type { MyTask } from "@/lib/api";
import { formatDate } from "@/lib/format";

const COLUMNS = [
  { key: "TODO", label: "To do" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "IN_REVIEW", label: "In review" },
  { key: "DONE", label: "Done" },
];

const ALL_PROJECTS = "__all__";

export function MyTasksBoard({ initialTasks }: { initialTasks: MyTask[] }) {
  const router = useRouter();
  const [tasks, setTasks] = useState<MyTask[]>(initialTasks);
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>(ALL_PROJECTS);

  useEffect(() => { setTasks(initialTasks); }, [initialTasks]);

  // The projects the caller actually has work in, with their open-task counts.
  const projects = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; open: number }>();
    for (const t of tasks) {
      const row = byId.get(t.projectId) ?? { id: t.projectId, name: t.projectName, open: 0 };
      if (t.status !== "DONE") row.open += 1;
      byId.set(t.projectId, row);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  // If the selected project drops out of the list (last task moved away), fall back to All.
  useEffect(() => {
    if (projectId !== ALL_PROJECTS && !projects.some((p) => p.id === projectId)) setProjectId(ALL_PROJECTS);
  }, [projects, projectId]);

  const visibleTasks = projectId === ALL_PROJECTS ? tasks : tasks.filter((t) => t.projectId === projectId);
  const openCount = visibleTasks.filter((t) => t.status !== "DONE").length;

  async function moveTask(id: string, status: string) {
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    const prev = tasks;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    setError(null);
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setTasks(prev); // roll back the optimistic move
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(d.error ?? "We couldn't move that task. Please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {error ? <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 ring-1 ring-inset ring-rose-200">{error}</p> : null}

      {/* Project filter — only worth showing once the work spans more than one project. */}
      {projects.length > 1 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label htmlFor="my-tasks-project" className="text-sm text-slate-500">Project</label>
          <select
            id="my-tasks-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none"
          >
            <option value={ALL_PROJECTS}>All projects ({tasks.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.open} open)</option>
            ))}
          </select>
          {projectId !== ALL_PROJECTS ? (
            <>
              <Link href={`/projects/${projectId}`} className="text-sm font-medium text-brand hover:underline">Open project</Link>
              <button onClick={() => setProjectId(ALL_PROJECTS)} className="text-sm text-slate-500 hover:text-slate-800">Clear</button>
            </>
          ) : null}
          <span className="ml-auto text-sm text-slate-500">
            <span className="font-medium text-slate-700">{openCount}</span> open · {visibleTasks.length} total
          </span>
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-500">
          <span className="font-medium text-slate-700">{openCount}</span> open · {visibleTasks.length} total
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const colTasks = visibleTasks.filter((t) => t.status === col.key);
          return (
            <div
              key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragId) { void moveTask(dragId, col.key); setDragId(null); } }}
              className="rounded-2xl border border-hairline bg-panel/60 p-3"
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-slate-700">{col.label}</span>
                <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-slate-500">{colTasks.length}</span>
              </div>
              <div className="space-y-2">
                {colTasks.map((t) => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                    className={`cursor-grab rounded-xl border border-hairline bg-panel p-3 shadow-[0_1px_2px_0_rgba(15,23,42,0.04)] hover:border-brand/40 ${dragId === t.id ? "opacity-50" : ""}`}
                  >
                    {/* Title opens the task; the card itself stays draggable. */}
                    <Link
                      href={`/tasks/${t.id}`}
                      draggable={false}
                      className="block text-sm font-medium text-slate-800 hover:text-brand hover:underline"
                    >
                      {t.title}
                    </Link>
                    {/* Once filtered to one project the name repeats on every card. */}
                    {projectId === ALL_PROJECTS ? (
                      <Link
                        href={`/projects/${t.projectId}`}
                        draggable={false}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 inline-block text-xs text-slate-400 hover:text-brand"
                      >
                        {t.projectName}
                      </Link>
                    ) : null}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <PriorityBadge priority={t.priority} />
                      {t.dueDate ? <span className="text-[11px] text-slate-400">{formatDate(t.dueDate)}</span> : null}
                    </div>
                  </div>
                ))}
                {colTasks.length === 0 ? <p className="px-1 py-3 text-center text-xs text-slate-400">Nothing here</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
