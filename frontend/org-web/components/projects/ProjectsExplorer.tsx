"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, MoreVertical, Pencil, Plus, Search, Archive, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ProjectStatusBadge } from "@/components/ui/badges";
import { ProjectForm } from "@/components/projects/ProjectForm";
import type { ProjectPerson, ProjectSettings, ProjectSummary, ProjectTeamOption } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { colorOf, labelOf } from "@/lib/project-labels";

const FALLBACK_STATUSES = ["ACTIVE", "PLANNING", "ON_HOLD", "COMPLETED", "ARCHIVED"];
const PAGE_SIZE = 9;

export function ProjectsExplorer({
  projects,
  canManage,
  people,
  teams,
  settings,
}: {
  projects: ProjectSummary[];
  canManage: boolean;
  people: ProjectPerson[];
  teams: ProjectTeamOption[];
  settings: ProjectSettings | null;
}) {
  const router = useRouter();
  const statuses = settings?.statuses;
  const FILTERS = [{ key: "ALL", label: "All" }, ...(statuses?.map((s) => ({ key: s.key, label: s.label })) ?? FALLBACK_STATUSES.map((k) => ({ key: k, label: labelOf(undefined, k) })))];

  // All filtering/search/pagination is client-side — no navigation, so the page never scrolls or reloads.
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .filter((p) => status === "ALL" || p.status === status)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q));
  }, [projects, status, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  // Reset to page 1 whenever the filter/search changes the result set.
  useEffect(() => { setPage(1); }, [status, search]);

  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuId]);

  const archive = async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "ARCHIVED" }) });
    router.refresh();
  };
  const remove = async (id: string, name: string) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete “${name}” permanently? This also deletes its tasks, milestones and goals. This cannot be undone.`)) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setStatus(f.key)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${status === f.key ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects…" className="w-56 rounded-lg border border-hairline bg-panel py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-brand focus:outline-none" />
          </div>
          {canManage ? (
            <button onClick={() => { setEditing(null); setFormOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-soft"><Plus className="size-4" /> New project</button>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card><p className="px-5 py-12 text-center text-sm text-slate-500">No projects{status !== "ALL" ? ` with status “${labelOf(statuses, status).toLowerCase()}”` : ""}{search ? ` matching “${search}”` : ""}.</p></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => (
            <div key={p.id} className="relative">
              <Link href={`/projects/${p.id}`}>
                <Card className="group h-full transition-colors hover:border-brand/40">
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="pr-6 font-semibold text-slate-900 group-hover:text-brand">{p.name}</h2>
                      <ProjectStatusBadge status={p.status} label={labelOf(statuses, p.status)} color={colorOf(statuses, p.status)} />
                    </div>
                    {p.description ? <p className="mt-1.5 line-clamp-2 text-sm text-slate-500">{p.description}</p> : <p className="mt-1.5 text-sm text-slate-400">No description</p>}

                    <div className="mt-4">
                      <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
                        <span>{p.doneCount}/{p.taskCount} tasks</span>
                        <span className="tabular-nums">{p.progress}%</span>
                      </div>
                      <span className="block h-1.5 overflow-hidden rounded-full bg-panel-2">
                        <span className={`block h-full rounded-full ${p.delayed ? "bg-rose-500" : "bg-brand"}`} style={{ width: `${p.progress}%` }} />
                      </span>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="truncate">{p.ownerName ? p.ownerName : p.teamName ?? "No owner"}</span>
                      <span className={`inline-flex items-center gap-1 ${p.delayed ? "font-medium text-rose-600" : "text-slate-400"}`}>
                        {p.dueDate ? `Due ${formatDate(p.dueDate)}` : "No due date"}
                      </span>
                    </div>
                  </div>
                </Card>
              </Link>

              {canManage ? (
                <div className="absolute right-3 top-3">
                  <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuId(menuId === p.id ? null : p.id); }} className="grid size-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><MoreVertical className="size-4" /></button>
                  {menuId === p.id ? (
                    <div className="absolute right-0 top-8 z-10 w-36 overflow-hidden rounded-xl border border-hairline bg-panel py-1 shadow-lg" onClick={(e) => e.preventDefault()}>
                      <button onClick={(e) => { e.stopPropagation(); setMenuId(null); setEditing(p); setFormOpen(true); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><Pencil className="size-3.5" /> Edit</button>
                      {p.status !== "ARCHIVED" ? <button onClick={(e) => { e.stopPropagation(); setMenuId(null); void archive(p.id); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><Archive className="size-3.5" /> Archive</button> : null}
                      <button onClick={(e) => { e.stopPropagation(); setMenuId(null); void remove(p.id, p.name); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50"><Trash2 className="size-3.5" /> Delete</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {filtered.length > PAGE_SIZE ? (
        <Card>
          <div className="flex items-center justify-between gap-4 px-5 py-3 text-xs text-slate-500">
            <span>Showing <span className="font-medium text-slate-700">{(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)}</span> of <span className="font-medium text-slate-700">{filtered.length}</span></span>
            <div className="flex items-center gap-1.5">
              <button disabled={current <= 1} onClick={() => setPage(current - 1)} className="inline-flex size-7 items-center justify-center rounded-lg border border-hairline bg-panel text-slate-600 hover:bg-panel-2 disabled:text-slate-300"><ChevronLeft className="size-4" /></button>
              <span className="px-1 tabular-nums">Page {current} / {pageCount}</span>
              <button disabled={current >= pageCount} onClick={() => setPage(current + 1)} className="inline-flex size-7 items-center justify-center rounded-lg border border-hairline bg-panel text-slate-600 hover:bg-panel-2 disabled:text-slate-300"><ChevronRight className="size-4" /></button>
            </div>
          </div>
        </Card>
      ) : null}

      {formOpen ? <ProjectForm open={formOpen} onClose={() => setFormOpen(false)} project={editing} people={people} teams={teams} settings={settings} /> : null}
    </div>
  );
}
