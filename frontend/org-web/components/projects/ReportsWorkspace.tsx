"use client";

import { useState } from "react";
import { AlertTriangle, Download, FolderKanban, ListChecks } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { ProjectStatusBadge } from "@/components/ui/badges";
import { downloadCsv, downloadXlsx } from "@/lib/export";
import type { ProjectReports, ProjectSettings } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { colorOf, labelOf } from "@/lib/project-labels";

type Tab = "projects" | "tasks" | "teams" | "progress";
const TABS: { key: Tab; label: string }[] = [
  { key: "projects", label: "Projects" },
  { key: "tasks", label: "Tasks" },
  { key: "teams", label: "Teams" },
  { key: "progress", label: "Progress" },
];

const th = "px-5 py-3 text-left font-medium";
const thr = "px-5 py-3 text-right font-medium";

export function ReportsWorkspace({ reports, settings }: { reports: ProjectReports; settings: ProjectSettings | null }) {
  const [tab, setTab] = useState<Tab>("projects");
  const statuses = settings?.statuses;

  const exportBtn = (name: string, rows: Record<string, unknown>[]) => (
    <div className="flex gap-2">
      <button onClick={() => downloadCsv(name, rows)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><Download className="size-3.5" /> CSV</button>
      <button onClick={() => downloadXlsx(name, name, rows)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"><Download className="size-3.5" /> Excel</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${tab === t.key ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"}`}>{t.label}</button>
        ))}
      </div>

      {tab === "projects" ? (
        <Card>
          <CardHeader title="Project report" subtitle={`${reports.projectRows.length} projects`} action={exportBtn("project-report.csv", reports.projectRows as unknown as Record<string, unknown>[])} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="border-b border-hairline text-xs text-slate-500"><th className={th}>Project</th><th className={th}>Owner</th><th className={th}>Team</th><th className={th}>Status</th><th className={thr}>Tasks</th><th className={thr}>Progress</th><th className={thr}>Due</th></tr></thead>
              <tbody>
                {reports.projectRows.map((p) => (
                  <tr key={p.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{p.name}</td>
                    <td className="px-5 py-3 text-slate-600">{p.owner}</td>
                    <td className="px-5 py-3 text-slate-600">{p.team}</td>
                    <td className="px-5 py-3"><ProjectStatusBadge status={p.status} label={labelOf(statuses, p.status)} color={colorOf(statuses, p.status)} /></td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{p.done}/{p.tasks}</td>
                    <td className={`px-5 py-3 text-right tabular-nums ${p.delayed ? "text-rose-600" : "text-slate-700"}`}>{p.progress}%</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500">{p.dueDate ? formatDate(p.dueDate) : "—"}</td>
                  </tr>
                ))}
                {reports.projectRows.length === 0 ? <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">No projects.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === "tasks" ? (
        <Card>
          <CardHeader title="Task report" subtitle="Workload by assignee" action={exportBtn("task-report.csv", reports.taskRows as unknown as Record<string, unknown>[])} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-hairline text-xs text-slate-500"><th className={th}>Assignee</th><th className={thr}>Total</th><th className={thr}>Done</th><th className={thr}>Pending</th><th className={thr}>Overdue</th></tr></thead>
              <tbody>
                {reports.taskRows.map((r, i) => (
                  <tr key={`${r.name}-${i}`} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{r.name}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{r.total}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-emerald-600">{r.done}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.pending}</td>
                    <td className={`px-5 py-3 text-right tabular-nums ${r.overdue ? "text-rose-600" : "text-slate-400"}`}>{r.overdue}</td>
                  </tr>
                ))}
                {reports.taskRows.length === 0 ? <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">No tasks.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === "teams" ? (
        <Card>
          <CardHeader title="Team report" subtitle="Performance per team" action={exportBtn("team-report.csv", reports.teamRows.map(({ memberNames, ...r }) => r) as unknown as Record<string, unknown>[])} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-hairline text-xs text-slate-500"><th className={th}>Team</th><th className={th}>Department</th><th className={thr}>Members</th><th className={thr}>Projects</th><th className={thr}>Tasks</th><th className={thr}>Completion</th></tr></thead>
              <tbody>
                {reports.teamRows.map((t) => (
                  <tr key={t.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{t.name}</td>
                    <td className="px-5 py-3 text-slate-600">{t.departmentName ?? "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{t.size}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{t.activeProjects}/{t.totalProjects}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{t.doneTasks}/{t.totalTasks}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{t.progress}%</td>
                  </tr>
                ))}
                {reports.teamRows.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">No teams.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === "progress" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Overall progress" value={`${reports.progress.overallProgress}%`} icon={ListChecks} accent="#16a34a" />
            <StatTile label="Projects" value={String(reports.progress.totalProjects)} icon={FolderKanban} />
            <StatTile label="Tasks done" value={`${reports.progress.doneTasks}/${reports.progress.totalTasks}`} icon={ListChecks} accent="#0d9488" />
            <StatTile label="Delayed" value={String(reports.progress.delayed)} icon={AlertTriangle} accent="#e11d48" />
          </div>
          <Card>
            <CardHeader title="Projects by status" />
            <div className="space-y-3 p-5">
              {Object.entries(reports.progress.statusCounts).map(([status, count]) => {
                const pct = reports.progress.totalProjects ? Math.round((count / reports.progress.totalProjects) * 100) : 0;
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-sm text-slate-600">{labelOf(statuses, status)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2"><span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></span>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500">{count}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
