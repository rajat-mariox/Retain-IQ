import Link from "next/link";
import { Users } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { PageBody } from "@/components/layout/PageBody";
import { MyTasksBoard } from "@/components/projects/MyTasksBoard";
import { getMyTasks, getSession } from "@/lib/api";

export default async function MyTasksPage() {
  const session = await getSession().catch(() => null);
  // My Tasks is a team-member surface. Owner (org owner, never assigned tasks)
  // and Manager (they run the board & monitor their team) work from the Manager
  // view / project board instead, so send them there rather than an empty board.
  const canManage = Boolean(
    session && (session.role.permissions.includes("employee.read") || session.role.name === "Owner"),
  );
  if (canManage) {
    return (
      <>
        <Topbar title="My Tasks" subtitle="Assigned work for team members" />
        <PageBody>
          <div className="rounded-2xl border border-hairline bg-panel/60 p-10 text-center">
            <span className="mx-auto mb-3 grid size-10 place-items-center rounded-xl bg-panel-2 text-slate-400"><Users className="size-5" /></span>
            <p className="text-sm font-medium text-slate-700">This view is for team members</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">You manage tasks from the project board and the Manager view — assign work, track your team, and review progress there.</p>
            <div className="mt-4 flex justify-center gap-2">
              {session?.role.name === "Manager" ? (
                <Link href="/manager" className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft">Go to Manager view</Link>
              ) : null}
              <Link href="/projects" className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Projects &amp; Teams</Link>
            </div>
          </div>
        </PageBody>
      </>
    );
  }

  const tasks = await getMyTasks().catch(() => []);

  return (
    <>
      <Topbar title="My Tasks" subtitle="Tasks assigned to you — drag a card to move it between statuses" />
      <PageBody>
        {tasks.length === 0 ? (
          <div className="rounded-2xl border border-hairline bg-panel/60 p-10 text-center">
            <p className="text-sm font-medium text-slate-700">No tasks assigned to you yet</p>
            <p className="mt-1 text-sm text-slate-400">When a manager assigns you a task, it will show up here.</p>
          </div>
        ) : (
          <MyTasksBoard initialTasks={tasks} />
        )}
      </PageBody>
    </>
  );
}
