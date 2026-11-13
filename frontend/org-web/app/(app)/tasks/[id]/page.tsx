import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { PriorityBadge } from "@/components/ui/badges";
import { LocalTime } from "@/components/ui/LocalTime";
import { TaskDescription, TaskDiscussion, TaskStatusControl } from "@/components/projects/TaskDetailPanels";
import { getTask, type TaskDetail } from "@/lib/api";
import { formatDate } from "@/lib/format";

const initials = (name: string) => name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/** A labelled row in the right-hand Details rail. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-hairline/60 px-5 py-3 last:border-0">
      <p className="text-xs text-slate-400">{label}</p>
      <div className="mt-0.5 text-sm text-slate-700">{children}</div>
    </div>
  );
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let task: TaskDetail;
  try {
    task = await getTask(id);
  } catch {
    notFound();
  }

  return (
    <>
      <Topbar title={task.title} subtitle={`Task in ${task.projectName}`} />
      <PageBody>
        <nav className="flex items-center gap-2 text-xs text-slate-400">
          <Link href="/tasks" className="inline-flex items-center gap-1 hover:text-slate-600">
            <ArrowLeft className="size-3.5" /> My Tasks
          </Link>
          <span>/</span>
          <Link href={`/projects/${task.projectId}`} className="hover:text-slate-600">{task.projectName}</Link>
        </nav>

        {/* Header card: title, state, assignee */}
        <div className="rounded-2xl border border-hairline bg-panel">
          <div className="border-b border-hairline/60 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-soft">Task</p>
            <h1 className="mt-0.5 text-lg font-semibold text-slate-900">{task.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {task.assigneeName ? (
                <span className="inline-flex items-center gap-1.5 text-slate-600">
                  <span className="grid size-6 place-items-center rounded-full bg-panel-2 text-[10px] font-semibold text-slate-600">{initials(task.assigneeName)}</span>
                  {task.assigneeName}
                </span>
              ) : (
                <span className="text-slate-400">Unassigned</span>
              )}
              <span className="text-slate-300">·</span>
              <span className="text-slate-500">{task.comments.length} comment{task.comments.length === 1 ? "" : "s"}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-x-8 gap-y-3 px-5 py-4 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-slate-400">State</span>
              <TaskStatusControl taskId={task.id} status={task.status} canChange={task.canManage || task.isAssignee} />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-slate-400">Project</span>
              <Link href={`/projects/${task.projectId}`} className="text-sm font-medium text-brand hover:underline">{task.projectName}</Link>
            </div>
          </div>
        </div>

        {/* Body: description + discussion, with the details rail alongside */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <section>
              <TaskDescription taskId={task.id} description={task.description} canEdit={task.canManage || task.isAssignee} />
            </section>

            <section>
              <TaskDiscussion taskId={task.id} comments={task.comments} />
            </section>
          </div>

          <aside className="rounded-2xl border border-hairline bg-panel/60 lg:col-span-1">
            <p className="border-b border-hairline/60 px-5 py-3 text-sm font-semibold text-slate-700">Details</p>
            <Detail label="Priority"><PriorityBadge priority={task.priority} /></Detail>
            <Detail label="Assignee">{task.assigneeName ?? <span className="text-slate-400">Unassigned</span>}</Detail>
            <Detail label="Due date">{task.dueDate ? formatDate(task.dueDate) : <span className="text-slate-400">—</span>}</Detail>
            <Detail label="Created"><LocalTime iso={task.createdAt} mode="date" /></Detail>
            <Detail label="Last updated"><LocalTime iso={task.updatedAt} mode="datetime" /></Detail>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
