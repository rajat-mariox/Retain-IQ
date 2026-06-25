import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { Card } from "@/components/ui/Card";
import { ProjectStatusBadge } from "@/components/ui/badges";
import { PageNav } from "@/components/ui/PageNav";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { getProjects, getSession } from "@/lib/api";
import { formatDate } from "@/lib/format";

const PAGE_SIZE = 9;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [projects, session] = await Promise.all([
    getProjects(page, PAGE_SIZE).catch(() => ({ items: [], total: 0, page, pageSize: PAGE_SIZE })),
    getSession().catch(() => null),
  ]);
  const canManage = Boolean(session?.role.permissions.includes("project.write"));

  return (
    <>
      <Topbar title="Projects" subtitle="Work across your organization" />
      <PageBody>
        {canManage ? (
          <div className="flex justify-end">
            <NewProjectButton />
          </div>
        ) : null}

        {projects.items.length === 0 ? (
          <Card>
            <p className="px-5 py-10 text-center text-sm text-slate-500">No projects yet.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.items.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="group h-full transition-colors hover:border-brand/40">
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-semibold text-slate-900 group-hover:text-brand">{p.name}</h2>
                      <ProjectStatusBadge status={p.status} />
                    </div>
                    {p.description ? <p className="mt-1.5 line-clamp-2 text-sm text-slate-500">{p.description}</p> : null}

                    <div className="mt-4">
                      <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
                        <span>{p.doneCount}/{p.taskCount} tasks</span>
                        <span className="tabular-nums">{p.progress}%</span>
                      </div>
                      <span className="block h-1.5 overflow-hidden rounded-full bg-panel-2">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${p.progress}%` }} />
                      </span>
                    </div>

                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                      <span>{p.teamName ?? "No team"}</span>
                      <span className="inline-flex items-center gap-1 text-slate-400 group-hover:text-brand">
                        {p.dueDate ? `Due ${formatDate(p.dueDate)}` : "No due date"}
                        <ChevronRight className="size-3.5" />
                      </span>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {projects.total > 0 ? (
          <Card>
            <PageNav page={projects.page} pageSize={projects.pageSize} total={projects.total} basePath="/projects" />
          </Card>
        ) : null}
      </PageBody>
    </>
  );
}
