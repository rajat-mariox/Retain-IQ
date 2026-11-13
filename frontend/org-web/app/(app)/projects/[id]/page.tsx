import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, CalendarClock, Eye, Users } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card, CardHeader } from "@/components/ui/Card";
import { PriorityBadge, ProjectStatusBadge } from "@/components/ui/badges";
import { ProjectBoard } from "@/components/projects/ProjectBoard";
import { EditProjectButton } from "@/components/projects/EditProjectButton";
import { MilestonesPanel } from "@/components/projects/MilestonesPanel";
import { GoalsWorkspace } from "@/components/projects/GoalsWorkspace";
import { getProject, getProjectPeople, getProjectSettings, getProjectTeams, getSession, type ProjectDetail } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import { colorOf, labelOf } from "@/lib/project-labels";

const initials = (name: string) => name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const TASK_STATUS_LABEL: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done" };

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let project: ProjectDetail;
  try {
    project = await getProject(id);
  } catch {
    notFound();
  }
  const [session, people, teams, settings] = await Promise.all([getSession().catch(() => null), getProjectPeople().catch(() => []), getProjectTeams().catch(() => []), getProjectSettings().catch(() => null)]);
  // Per-project, from the API — an Owner is read-only where a manager is assigned,
  // so the role's project.write alone would show edit controls that then 403.
  const canManage = project.canManage;
  // Holding project.write but read-only here means a manager owns this project.
  const viewingAsOwner = Boolean(session?.role.permissions.includes("project.write")) && !canManage;
  const now = Date.now();

  return (
    <>
      <Topbar title={project.name} subtitle={project.description ?? "Project board"} />
      <PageBody>
        <nav className="text-xs text-slate-400">
          <Link href="/projects" className="hover:text-slate-600">Projects &amp; Teams</Link>
          <span className="mx-1.5">/</span>
          <span className="font-medium text-slate-600">{project.name}</span>
        </nav>

        {viewingAsOwner ? (
          <p className="flex items-start gap-2 rounded-xl border border-hairline bg-panel/60 px-4 py-2.5 text-sm text-slate-500">
            <Eye className="mt-0.5 size-4 shrink-0 text-slate-400" />
            <span>You&rsquo;re viewing this project. Its assigned manager makes the changes here.</span>
          </p>
        ) : null}

        {/* Overview */}
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div className="min-w-0 space-y-3">
              <div className="flex items-center gap-2">
                <ProjectStatusBadge status={project.status} label={labelOf(settings?.statuses, project.status)} color={colorOf(settings?.statuses, project.status)} />
                {project.delayed ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600 ring-1 ring-inset ring-rose-200">Delayed</span> : null}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-slate-600">
                <span><span className="text-slate-400">Owner:</span> {project.ownerName ?? "—"}</span>
                <span><span className="text-slate-400">Team:</span> {project.teamName ?? "—"}</span>
                <span><span className="text-slate-400">Start:</span> {project.startDate ? formatDate(project.startDate) : "—"}</span>
                <span className={project.delayed ? "text-rose-600" : ""}><span className="text-slate-400">Due:</span> {project.dueDate ? formatDate(project.dueDate) : "—"}</span>
              </div>
              {project.members.length ? (
                <div className="flex items-center gap-2 pt-1">
                  <Users className="size-4 text-slate-400" />
                  <div className="flex -space-x-1.5">
                    {project.members.slice(0, 8).map((m) => (
                      <span key={m.id} title={`${m.name}${m.isOwner ? " (owner)" : ""} · ${m.taskCount} task(s)`} className="grid size-7 place-items-center rounded-full border-2 border-panel bg-panel-2 text-[10px] font-semibold text-slate-600">{initials(m.name)}</span>
                    ))}
                  </div>
                  {project.members.length > 8 ? <span className="text-xs text-slate-400">+{project.members.length - 8}</span> : null}
                </div>
              ) : null}
            </div>
            {canManage ? <EditProjectButton project={project} people={people} teams={teams} settings={settings} /> : null}
          </div>
        </Card>

        {/* Board */}
        <ProjectBoard project={project} canManage={canManage} viewerEmployeeId={session?.employee?.id ?? null} people={people} settings={settings} />

        {/* Milestones */}
        <MilestonesPanel projectId={project.id} milestones={project.milestones} canManage={canManage} people={people} />

        {/* Goals for this project */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Goals</h2>
          <GoalsWorkspace goals={project.goals} canManage={canManage} people={people} projects={[]} lockedProjectId={project.id} />
        </div>

        {/* Activity + deadlines */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Recent activity" subtitle="Latest task updates" />
            <ul className="divide-y divide-hairline/60">
              {project.recentActivity.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No activity yet.</li> : project.recentActivity.map((a) => (
                <li key={a.taskId} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-panel-2 text-slate-500"><Activity className="size-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-700">{a.title}</p>
                    <p className="text-xs text-slate-400">{TASK_STATUS_LABEL[a.status] ?? a.status} · {timeAgo(a.at, now)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Upcoming deadlines" subtitle="Open tasks with a due date" />
            <ul className="divide-y divide-hairline/60">
              {project.deadlines.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No upcoming deadlines.</li> : project.deadlines.map((d) => {
                const overdue = d.dueDate ? new Date(d.dueDate).getTime() < now : false;
                return (
                  <li key={d.taskId} className="flex items-center gap-3 px-5 py-3">
                    <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${overdue ? "bg-rose-50 text-rose-500" : "bg-panel-2 text-slate-500"}`}><CalendarClock className="size-3.5" /></span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm text-slate-700">{d.title}</p></div>
                    <PriorityBadge priority={d.priority} />
                    <span className={`shrink-0 text-xs ${overdue ? "font-medium text-rose-600" : "text-slate-400"}`}>{d.dueDate ? formatDate(d.dueDate) : ""}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
