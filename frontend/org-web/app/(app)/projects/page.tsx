import Link from "next/link";
import { AlertTriangle, CheckCheck, CheckCircle2, ChevronRight, Clock, FolderKanban, ListTodo, PlayCircle, Users } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { ProjectStatusBadge } from "@/components/ui/badges";
import { ProjectsTabs } from "@/components/projects/ProjectsTabs";
import { getProjectDashboard, getProjectSettings, getSession } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { colorOf, labelOf } from "@/lib/project-labels";

export default async function ProjectsOverviewPage() {
  const [dashboard, session, settings] = await Promise.all([
    getProjectDashboard().catch(() => null),
    getSession().catch(() => null),
    getProjectSettings().catch(() => null),
  ]);
  const canManage = Boolean(session?.role.permissions.includes("project.write"));
  const statuses = settings?.statuses;

  // Status distribution (mutually-exclusive; archived = remainder) for the portfolio breakdown.
  const dist = dashboard
    ? [
        { key: "ACTIVE", count: dashboard.projects.active },
        { key: "PLANNING", count: dashboard.projects.planning },
        { key: "ON_HOLD", count: dashboard.projects.onHold },
        { key: "COMPLETED", count: dashboard.projects.completed },
        { key: "ARCHIVED", count: Math.max(0, dashboard.projects.total - dashboard.projects.active - dashboard.projects.planning - dashboard.projects.onHold - dashboard.projects.completed) },
      ].filter((d) => d.count > 0)
    : [];

  return (
    <>
      <Topbar title="Projects & Teams" subtitle="Portfolio overview" />
      <PageBody>
        <ProjectsTabs canManage={canManage} roleName={session?.role.name} />

        {dashboard ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Total projects" value={String(dashboard.projects.total)} icon={FolderKanban} hint={`${dashboard.projects.planning} planning`} />
              <StatTile label="Active" value={String(dashboard.projects.active)} icon={PlayCircle} accent="#16a34a" hint={`${dashboard.projects.onHold} on hold`} />
              <StatTile label="Completed" value={String(dashboard.projects.completed)} icon={CheckCircle2} accent="#0d9488" />
              <StatTile label="Delayed" value={String(dashboard.projects.delayed)} icon={AlertTriangle} accent="#e11d48" hint="past due & under 100%" />
              <StatTile label="Total tasks" value={String(dashboard.tasks.total)} icon={ListTodo} />
              <StatTile label="Pending tasks" value={String(dashboard.tasks.pending)} icon={Clock} accent="#d97706" />
              <StatTile label="Completed tasks" value={String(dashboard.tasks.completed)} icon={CheckCheck} accent="#16a34a" />
              <StatTile label="Team members" value={String(dashboard.teamMembers)} icon={Users} accent="#7c3aed" />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              {/* Portfolio breakdown — aggregate, distinct from the Projects list */}
              <Card className="lg:col-span-2">
                <CardHeader title="Portfolio by status" subtitle="How your projects are distributed" />
                <div className="space-y-3 p-5">
                  {dist.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No projects yet.</p> : dist.map((d) => {
                    const pct = dashboard.projects.total ? Math.round((d.count / dashboard.projects.total) * 100) : 0;
                    const color = colorOf(statuses, d.key) ?? "#1f883d";
                    return (
                      <div key={d.key} className="flex items-center gap-3">
                        <span className="w-24 shrink-0 text-sm text-slate-600">{labelOf(statuses, d.key)}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2"><span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} /></span>
                        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500">{d.count}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Attention snapshot — the few projects a manager should look at now */}
              <Card className="lg:col-span-3">
                <CardHeader
                  title="Needs attention"
                  subtitle="Open projects, most at-risk first"
                  action={<Link href="/projects/all" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">All projects <ChevronRight className="size-3.5" /></Link>}
                />
                <div className="divide-y divide-hairline/60">
                  {dashboard.overview.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing needs attention. 🎉</p>
                  ) : dashboard.overview.map((p) => (
                    <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-slate-800">{p.name}</span>
                          <ProjectStatusBadge status={p.status} label={labelOf(statuses, p.status)} color={colorOf(statuses, p.status)} />
                          {p.delayed ? <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 ring-1 ring-inset ring-rose-200">Delayed</span> : null}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-400">{p.ownerName ?? "No owner"}{p.dueDate ? ` · due ${formatDate(p.dueDate)}` : ""}</p>
                      </div>
                      <div className="w-32 shrink-0">
                        <div className="mb-1 flex justify-end text-xs text-slate-500"><span className="tabular-nums">{p.progress}%</span></div>
                        <span className="block h-1.5 overflow-hidden rounded-full bg-panel-2"><span className={`block h-full rounded-full ${p.delayed ? "bg-rose-500" : "bg-brand"}`} style={{ width: `${p.progress}%` }} /></span>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            </div>
          </>
        ) : (
          <Card><p className="px-5 py-12 text-center text-sm text-slate-500">Dashboard unavailable right now.</p></Card>
        )}
      </PageBody>
    </>
  );
}
