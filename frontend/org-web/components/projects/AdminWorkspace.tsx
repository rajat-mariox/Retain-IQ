"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Check, FolderKanban, ListChecks, Users } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import type { LabelEntry, ProjectDashboard, ProjectSettings } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
type Tab = "overview" | "labels" | "workflow" | "permissions";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "labels", label: "Statuses & Priorities" },
  { key: "workflow", label: "Workflow" },
  { key: "permissions", label: "Permissions" },
];
const WORKFLOW_LABELS: Record<string, { title: string; hint: string }> = {
  autoCompleteProject: { title: "Auto-complete projects", hint: "Mark a project Completed when all its tasks are Done." },
  autoReopenProject: { title: "Auto-reopen projects", hint: "Reopen a completed project if a task moves back out of Done." },
  requireTaskAssignee: { title: "Require task assignee", hint: "Every new task must have an assignee." },
  blockPastDueTasks: { title: "Block past-due tasks", hint: "Reject new tasks with a due date in the past." },
};
const PERMISSIONS = [
  { action: "View projects, tasks & reports", owner: true, manager: true, employee: true },
  { action: "Create / edit / archive projects", owner: true, manager: true, employee: false },
  { action: "Create, assign & move tasks", owner: true, manager: true, employee: false },
  { action: "Manage milestones & goals", owner: true, manager: true, employee: false },
  { action: "Change project settings", owner: true, manager: true, employee: false },
];

export function AdminWorkspace({ settings, dashboard }: { settings: ProjectSettings; dashboard: ProjectDashboard | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [statuses, setStatuses] = useState<LabelEntry[]>(settings.statuses);
  const [priorities, setPriorities] = useState<LabelEntry[]>(settings.priorities);
  const [defaultProjectStatus, setDPS] = useState(settings.defaultProjectStatus);
  const [defaultTaskPriority, setDTP] = useState(settings.defaultTaskPriority);
  const [workflow, setWorkflow] = useState(settings.workflow);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/projects/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses, priorities, defaultProjectStatus, defaultTaskPriority, workflow }),
      });
      if (!res.ok) { const d = (await res.json().catch(() => ({}))) as { error?: string }; setError(d.error ?? "Could not save settings."); return; }
      setSaved(true);
      router.refresh();
    } finally { setBusy(false); }
  }

  const editLabel = (list: LabelEntry[], setList: (v: LabelEntry[]) => void, i: number, field: "label" | "color", value: string) =>
    setList(list.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)));

  const SaveBar = () => (
    <div className="flex items-center justify-end gap-3">
      {error ? <span className="text-sm text-rose-600">{error}</span> : null}
      {saved && !busy ? <span className="inline-flex items-center gap-1 text-sm text-emerald-600"><Check className="size-4" /> Saved</span> : null}
      <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-soft disabled:opacity-60">{busy ? "Saving…" : "Save changes"}</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setSaved(false); }} className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${tab === t.key ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"}`}>{t.label}</button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Projects" value={String(dashboard?.projects.total ?? 0)} icon={FolderKanban} hint={`${dashboard?.projects.active ?? 0} active`} />
            <StatTile label="Tasks" value={String(dashboard?.tasks.total ?? 0)} icon={ListChecks} accent="#0d9488" hint={`${dashboard?.tasks.pending ?? 0} pending`} />
            <StatTile label="Team members" value={String(dashboard?.teamMembers ?? 0)} icon={Users} accent="#7c3aed" />
            <StatTile label="Delayed" value={String(dashboard?.projects.delayed ?? 0)} icon={FolderKanban} accent="#e11d48" />
          </div>
          <Card>
            <CardHeader title="Management" subtitle="Administer the workspace" />
            <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Link href="/teams" className="flex items-center gap-3 rounded-xl border border-hairline p-4 hover:border-brand/40 hover:bg-slate-50"><span className="grid size-9 place-items-center rounded-lg bg-brand/10 text-brand"><Users className="size-4" /></span><div><p className="text-sm font-medium text-slate-800">Teams</p><p className="text-xs text-slate-500">Structure & performance</p></div></Link>
              <Link href="/departments" className="flex items-center gap-3 rounded-xl border border-hairline p-4 hover:border-brand/40 hover:bg-slate-50"><span className="grid size-9 place-items-center rounded-lg bg-brand/10 text-brand"><Building2 className="size-4" /></span><div><p className="text-sm font-medium text-slate-800">Departments</p><p className="text-xs text-slate-500">Productivity</p></div></Link>
              <Link href="/employees" className="flex items-center gap-3 rounded-xl border border-hairline p-4 hover:border-brand/40 hover:bg-slate-50"><span className="grid size-9 place-items-center rounded-lg bg-brand/10 text-brand"><Users className="size-4" /></span><div><p className="text-sm font-medium text-slate-800">Members</p><p className="text-xs text-slate-500">Add & assign people</p></div></Link>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "labels" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Project statuses" subtitle="Rename and colour each status; pick the default for new projects" />
            <CardBody className="space-y-2">
              {statuses.map((s, i) => (
                <div key={s.key} className="flex items-center gap-3">
                  <input type="color" value={s.color} onChange={(e) => editLabel(statuses, setStatuses, i, "color", e.target.value)} className="size-8 shrink-0 cursor-pointer rounded border border-hairline bg-panel" />
                  <input value={s.label} onChange={(e) => editLabel(statuses, setStatuses, i, "label", e.target.value)} className={input} />
                  <span className="w-24 shrink-0 text-xs text-slate-400">{s.key}</span>
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600"><input type="radio" name="dps" checked={defaultProjectStatus === s.key} onChange={() => setDPS(s.key)} /> Default</label>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Task priorities" subtitle="Rename and colour each priority; pick the default for new tasks" />
            <CardBody className="space-y-2">
              {priorities.map((p, i) => (
                <div key={p.key} className="flex items-center gap-3">
                  <input type="color" value={p.color} onChange={(e) => editLabel(priorities, setPriorities, i, "color", e.target.value)} className="size-8 shrink-0 cursor-pointer rounded border border-hairline bg-panel" />
                  <input value={p.label} onChange={(e) => editLabel(priorities, setPriorities, i, "label", e.target.value)} className={input} />
                  <span className="w-24 shrink-0 text-xs text-slate-400">{p.key}</span>
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600"><input type="radio" name="dtp" checked={defaultTaskPriority === p.key} onChange={() => setDTP(p.key)} /> Default</label>
                </div>
              ))}
            </CardBody>
          </Card>
          <SaveBar />
        </div>
      ) : null}

      {tab === "workflow" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Workflow rules" subtitle="Automations enforced across the module" />
            <CardBody className="divide-y divide-hairline/60 p-0">
              {(Object.keys(WORKFLOW_LABELS) as (keyof typeof workflow)[]).map((key) => (
                <label key={key} className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4">
                  <span><span className="block text-sm font-medium text-slate-800">{WORKFLOW_LABELS[key].title}</span><span className="block text-xs text-slate-500">{WORKFLOW_LABELS[key].hint}</span></span>
                  <button type="button" role="switch" aria-checked={workflow[key]} onClick={() => setWorkflow({ ...workflow, [key]: !workflow[key] })} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${workflow[key] ? "bg-brand" : "bg-slate-300"}`}>
                    <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${workflow[key] ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                </label>
              ))}
            </CardBody>
          </Card>
          <SaveBar />
        </div>
      ) : null}

      {tab === "permissions" ? (
        <Card>
          <CardHeader title="Role permissions" subtitle="Who can do what in Projects & Teams (managed via Roles)" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-hairline text-xs text-slate-500"><th className="px-5 py-3 text-left font-medium">Action</th><th className="px-5 py-3 text-center font-medium">Owner</th><th className="px-5 py-3 text-center font-medium">Manager</th><th className="px-5 py-3 text-center font-medium">Employee</th></tr></thead>
              <tbody>
                {PERMISSIONS.map((r) => (
                  <tr key={r.action} className="border-b border-hairline/60 last:border-0">
                    <td className="px-5 py-3 text-slate-700">{r.action}</td>
                    {[r.owner, r.manager, r.employee].map((v, i) => (
                      <td key={i} className="px-5 py-3 text-center">{v ? <Check className="mx-auto size-4 text-emerald-600" /> : <span className="text-slate-300">—</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
