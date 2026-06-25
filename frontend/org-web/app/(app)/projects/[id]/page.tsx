import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { PriorityBadge, ProjectStatusBadge } from "@/components/ui/badges";
import { getProject, type ProjectDetail, type ProjectTask } from "@/lib/api";
import { formatDate } from "@/lib/format";

const COLUMNS: { key: string; label: string }[] = [
  { key: "TODO", label: "To do" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "IN_REVIEW", label: "In review" },
  { key: "DONE", label: "Done" },
];

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let project: ProjectDetail;
  try {
    project = await getProject(id);
  } catch {
    notFound();
  }

  const byStatus = (status: string) => project.tasks.filter((t) => t.status === status);

  return (
    <>
      <Topbar title={project.name} subtitle={project.description ?? "Project board"} />
      <PageBody>
        <div className="flex items-center justify-between">
          <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" />
            All projects
          </Link>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            {project.dueDate ? <span>Due {formatDate(project.dueDate)}</span> : null}
            <span className="tabular-nums">{project.progress}% complete</span>
            <ProjectStatusBadge status={project.status} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const tasks = byStatus(col.key);
            return (
              <div key={col.key} className="rounded-2xl border border-hairline bg-panel/60 p-3">
                <div className="mb-3 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold text-slate-700">{col.label}</span>
                  <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-slate-500">{tasks.length}</span>
                </div>
                <div className="space-y-2">
                  {tasks.map((t: ProjectTask) => (
                    <div key={t.id} className="rounded-xl border border-hairline bg-panel p-3 shadow-[0_1px_2px_0_rgba(15,23,42,0.04)]">
                      <p className="text-sm font-medium text-slate-800">{t.title}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <PriorityBadge priority={t.priority} />
                        {t.assigneeName ? (
                          <span className="flex items-center gap-1.5 text-xs text-slate-500">
                            <span className="grid size-5 place-items-center rounded-full bg-panel-2 text-[9px] font-semibold text-slate-600">
                              {t.assigneeName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                            </span>
                            {t.assigneeName}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {tasks.length === 0 ? <p className="px-1 py-3 text-center text-xs text-slate-400">No tasks</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      </PageBody>
    </>
  );
}
