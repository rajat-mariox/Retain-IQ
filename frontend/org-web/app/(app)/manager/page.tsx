import Link from "next/link";
import { AlertTriangle, FolderKanban, Gauge, ListChecks, ShieldAlert, Target, Users } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { PriorityBadge } from "@/components/ui/badges";
import { ProjectsTabs } from "@/components/projects/ProjectsTabs";
import { getManagerOverview, getProjectSettings, getSession } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { colorOf, labelOf } from "@/lib/project-labels";

export default async function ManagerPage() {
  const session = await getSession().catch(() => null);
  const canManage = Boolean(session?.role.permissions.includes("project.write"));
  // Manager view is exclusively for the Manager role — the Owner has their own
  // Admin view, so this stays a Manager-only surface.
  const isManager = session?.role.name === "Manager";

  return (
    <>
      <Topbar title="Manager view" subtitle="Monitor your team's projects & workload" />
      <PageBody>
        <ProjectsTabs canManage={canManage} roleName={session?.role.name} />
        {!isManager ? (
          <Card>
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <ShieldAlert className="size-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">Manager access only</p>
              <p className="text-sm text-slate-500">This team-monitoring view is available to Manager accounts.</p>
            </div>
          </Card>
        ) : (
          <ManagerContent />
        )}
      </PageBody>
    </>
  );
}

async function ManagerContent() {
  const [m, settings] = await Promise.all([getManagerOverview().catch(() => null), getProjectSettings().catch(() => null)]);
  if (!m) return <Card><p className="px-5 py-12 text-center text-sm text-slate-500">Manager view is unavailable right now.</p></Card>;
  const priorities = settings?.priorities;
  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-hairline bg-panel/60 px-4 py-2.5 text-sm">
        <Users className="size-4 text-slate-400" />
        <span className="text-slate-500">Scope:</span>
        <span className="font-medium text-slate-800">{m.scopeLabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Projects" value={String(m.summary.projects)} icon={FolderKanban} />
        <StatTile label="Delayed projects" value={String(m.summary.delayedProjects)} icon={AlertTriangle} accent="#e11d48" />
        <StatTile label="Open tasks" value={String(m.summary.openTasks)} icon={ListChecks} accent="#d97706" />
        <StatTile label="Delayed tasks" value={String(m.summary.delayedTasks)} icon={AlertTriangle} accent="#e11d48" />
        <StatTile label="Milestones due" value={String(m.summary.upcomingMilestones)} icon={Target} accent="#7c3aed" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="At-risk projects" subtitle="Delayed & under 100%" />
          <ul className="divide-y divide-hairline/60">
            {m.atRisk.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">Nothing at risk. 🎉</li> : m.atRisk.map((p) => (
              <li key={p.id}><Link href={`/projects/${p.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                <span className="min-w-0"><span className="truncate text-sm font-medium text-slate-800">{p.name}</span><span className="block text-xs text-slate-400">{p.teamName ?? "No team"}{p.dueDate ? ` · due ${formatDate(p.dueDate)}` : ""}</span></span>
                <span className="tabular-nums text-sm text-rose-600">{p.progress}%</span>
              </Link></li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Team workload" subtitle="Open tasks per member" />
          <ul className="divide-y divide-hairline/60">
            {m.workload.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No open tasks assigned.</li> : m.workload.map((w, i) => (
              <li key={`${w.name}-${i}`} className="flex items-center justify-between px-5 py-2.5"><span className="text-sm text-slate-700">{w.name}</span><span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs tabular-nums text-slate-600">{w.open} open</span></li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Delayed tasks" subtitle="Past due & open" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-sm">
              <thead><tr className="border-b border-hairline text-xs text-slate-500"><th className="px-5 py-3 text-left font-medium">Task</th><th className="px-5 py-3 text-left font-medium">Project</th><th className="px-5 py-3 text-left font-medium">Assignee</th><th className="px-5 py-3 text-right font-medium">Due</th></tr></thead>
              <tbody>
                {m.delayedTasks.map((t) => (
                  <tr key={t.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3"><span className="text-slate-800">{t.title}</span> <PriorityBadge priority={t.priority} label={labelOf(priorities, t.priority)} color={colorOf(priorities, t.priority)} /></td>
                    <td className="px-5 py-3"><Link href={`/projects/${t.projectId}`} className="text-brand hover:underline">{t.projectName ?? "—"}</Link></td>
                    <td className="px-5 py-3 text-slate-600">{t.assignee ?? "Unassigned"}</td>
                    <td className="px-5 py-3 text-right text-xs font-medium text-rose-600">{t.dueDate ? formatDate(t.dueDate) : "—"}</td>
                  </tr>
                ))}
                {m.delayedTasks.length === 0 ? <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-500">No delayed tasks.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="Upcoming milestones" subtitle="Not yet completed" />
          <ul className="divide-y divide-hairline/60">
            {m.milestones.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No upcoming milestones.</li> : m.milestones.map((ms) => {
              const overdue = ms.dueDate ? new Date(ms.dueDate).getTime() < now : false;
              return (
                <li key={ms.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0"><span className="flex items-center gap-2"><Gauge className="size-3.5 shrink-0 text-slate-400" /><span className="truncate text-sm text-slate-700">{ms.title}</span></span></span>
                  <span className="flex shrink-0 items-center gap-2"><span className="text-xs tabular-nums text-slate-400">{ms.progress}%</span>{ms.dueDate ? <span className={`text-xs ${overdue ? "font-medium text-rose-600" : "text-slate-400"}`}>{formatDate(ms.dueDate)}</span> : null}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
