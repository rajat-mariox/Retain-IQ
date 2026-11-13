import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import type { Prisma } from "@retainiq/database/identity";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { PermissionBundleService } from "../../common/security/permission-bundle.service.js";
import type {
  CreateGoalInput,
  CreateMilestoneInput,
  CreateProjectInput,
  CreateTaskInput,
  UpdateGoalInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
  UpdateProjectSettingsInput,
  UpdateTaskInput,
} from "./dto.js";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const DEFAULT_STATUSES = [
  { key: "PLANNING", label: "Planning", color: "#64748b" },
  { key: "ACTIVE", label: "Active", color: "#16a34a" },
  { key: "ON_HOLD", label: "On hold", color: "#d97706" },
  { key: "COMPLETED", label: "Completed", color: "#0d9488" },
  { key: "ARCHIVED", label: "Archived", color: "#94a3b8" },
];
const DEFAULT_PRIORITIES = [
  { key: "LOW", label: "Low", color: "#64748b" },
  { key: "MEDIUM", label: "Medium", color: "#2563eb" },
  { key: "HIGH", label: "High", color: "#d97706" },
  { key: "URGENT", label: "Urgent", color: "#e11d48" },
];
const DEFAULT_WORKFLOW = { requireTaskAssignee: false, autoCompleteProject: true, autoReopenProject: true, blockPastDueTasks: false };
/** A project counts as delayed when it's still open, past its due date, and under 100%. */
function isDelayed(status: string, dueDate: Date | null, progress: number): boolean {
  if (status === "COMPLETED" || status === "ARCHIVED") return false;
  return Boolean(dueDate && dueDate.getTime() < Date.now() && progress < 100);
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bundles: PermissionBundleService,
    private readonly accessScope: AccessScopeService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Publishes `task.assigned` so the notifications service can alert the
   * assignee. Resolves the employee's login account (notifications address
   * users, not employees) and enriches the payload with project/actor names so
   * the consumer never has to read back into this database.
   */
  private async publishTaskAssigned(task: { id: string; title: string; projectId: string; assigneeEmployeeId: string | null }): Promise<void> {
    const ctx = requireTenantContext();
    if (!task.assigneeEmployeeId) return;
    try {
      const [membership, project, actor] = await Promise.all([
        this.prisma.organizationMembership.findFirst({
          where: { orgId: ctx.orgId, employeeId: task.assigneeEmployeeId, status: "ACTIVE" },
          select: { userId: true },
        }),
        this.prisma.project.findUnique({ where: { id: task.projectId }, select: { name: true } }),
        this.prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } }),
      ]);
      // Don't notify someone for assigning a task to themselves.
      if (!membership?.userId || membership.userId === ctx.userId) return;

      await this.prisma.$transaction(async (tx) => {
        await this.outbox.enqueue(tx, {
          eventType: "task.assigned",
          aggregateType: "task",
          aggregateId: task.id,
          orgId: ctx.orgId,
          actorUserId: ctx.userId,
          payload: {
            assigneeUserId: membership.userId,
            taskTitle: task.title,
            projectId: task.projectId,
            projectName: project?.name ?? null,
            assignerName: actor?.email ?? "Someone",
          },
        });
      });
    } catch {
      // Notification fan-out must never fail the task write.
    }
  }

  /**
   * Management reach for the caller, honouring department/team-scoped grants.
   *   - Owner / org-wide project.write → manages every project (canManage, no filter).
   *   - Department/team-scoped project.write → manages only projects under those
   *     departments/teams (canManage with `manageWhere`).
   *   - No project.write → not a manager; `viewIds` lists the projects they may
   *     still SEE (own, team, or assigned a task in) but not edit.
   */
  private async callerScope(): Promise<{
    canManage: boolean;
    manageWhere: Prisma.ProjectWhereInput | null; // null = no restriction (org tier)
    viewIds: Set<string>;
  }> {
    const ctx = requireTenantContext();
    const bundle = await this.bundles.resolve(ctx.orgId, ctx.userId);

    if (bundle?.permissions.includes(permissions.projectWrite)) {
      const scope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, permissions.projectWrite);
      if (scope.tier === "org") return { canManage: true, manageWhere: null, viewIds: new Set() };
      // A scoped manager: restrict their manage reach to their departments/teams.
      const manageWhere = await this.accessScope.projectWhere(ctx.orgId, scope);
      return { canManage: true, manageWhere, viewIds: new Set() };
    }

    // Plain member: read-only reach over their own work.
    const employeeId = await this.callerEmployeeId();
    const ids = new Set<string>();
    if (employeeId) {
      const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { teamId: true } });
      const [owned, teamProjects, taskProjects] = await Promise.all([
        this.prisma.project.findMany({ where: { orgId: ctx.orgId, ownerEmployeeId: employeeId }, select: { id: true } }),
        emp?.teamId ? this.prisma.project.findMany({ where: { orgId: ctx.orgId, teamId: emp.teamId }, select: { id: true } }) : Promise.resolve([] as { id: string }[]),
        this.prisma.task.findMany({ where: { orgId: ctx.orgId, assigneeEmployeeId: employeeId }, select: { projectId: true }, distinct: ["projectId"] }),
      ]);
      owned.forEach((p) => ids.add(p.id));
      teamProjects.forEach((p) => ids.add(p.id));
      taskProjects.forEach((t) => ids.add(t.projectId));
    }
    return { canManage: false, manageWhere: null, viewIds: ids };
  }

  /**
   * Does anyone hold a department/team-scoped project.write grant covering this
   * project? Day-to-day project work belongs to Managers, so the Owner steps back
   * to read-only wherever a Manager is in place — and keeps write access only on
   * projects nobody manages, so an unstaffed project can never get stuck.
   */
  private async hasScopedManager(projectId: string): Promise<boolean> {
    const ctx = requireTenantContext();
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, orgId: ctx.orgId },
      select: { teamId: true, team: { select: { departmentId: true } } },
    });
    if (!project) return false;

    const scopeIds = [project.teamId, project.team?.departmentId].filter((x): x is string => Boolean(x));
    if (scopeIds.length === 0) return false; // no team → nothing a scoped grant could target

    const grant = await this.prisma.roleAssignment.findFirst({
      where: {
        orgId: ctx.orgId,
        status: "ACTIVE",
        scopeType: { in: ["DEPARTMENT", "TEAM"] },
        scopeId: { in: scopeIds },
        role: { permissions: { has: permissions.projectWrite } },
      },
      select: { id: true },
    });
    return grant !== null;
  }

  /**
   * Can the caller MANAGE (edit/delete) this specific project?
   *   - Scoped manager → yes, when the project is inside their departments/teams.
   *   - Owner / org-wide grant → only when the project has NO scoped manager
   *     (see hasScopedManager): project work is the Manager's job, the Owner
   *     watches, and steps in only where nobody is assigned.
   */
  private async canManageProject(projectId: string): Promise<boolean> {
    const scope = await this.callerScope();
    if (!scope.canManage) return false;

    if (scope.manageWhere) {
      // Department/team-scoped manager: the project must fall inside their scope.
      const match = await this.prisma.project.findFirst({
        where: { id: projectId, orgId: requireTenantContext().orgId, ...scope.manageWhere },
        select: { id: true },
      });
      return match !== null;
    }

    // Org-wide (Owner): read-only wherever a Manager already owns the project.
    return !(await this.hasScopedManager(projectId));
  }

  private async assertCanManageProject(projectId: string): Promise<void> {
    if (await this.canManageProject(projectId)) return;
    // Say which rule stopped them: an Owner is read-only because a Manager owns
    // this project; a scoped manager is out of their departments.
    const scope = await this.callerScope();
    throw new ForbiddenException(
      scope.canManage && !scope.manageWhere
        ? "This project is managed by its assigned manager. You can view it, but changes are theirs to make."
        : "This project is outside the departments and teams you manage.",
    );
  }

  /** Org-wide manage reach — required for org-level resources (goals with no project). */
  private async assertOrgLevelManage(): Promise<void> {
    const scope = await this.callerScope();
    if (!scope.canManage || scope.manageWhere) {
      throw new ForbiddenException("Organization-wide goals can only be managed with org-wide access.");
    }
  }

  /**
   * Would a NEW project with this team/owner fall inside the caller's manage
   * reach? Org-wide (Owner): always — a project that doesn't exist yet can't have
   * a manager, so creation stays with the Owner even though editing later passes
   * to whoever manages its department. Scoped managers: the team must be one they
   * reach, or the owner one of their people, so they can't create a project that
   * then sits outside their own scope.
   */
  private async assertCanCreateProject(input: { teamId?: string | null; ownerEmployeeId?: string | null }): Promise<void> {
    const ctx = requireTenantContext();
    const scope = await this.callerScope();
    if (!scope.canManage) throw new ForbiddenException("You don't have permission to create projects.");
    if (!scope.manageWhere) return; // org tier — anything goes

    const [reachTeams, reachOwners] = await Promise.all([
      this.accessScope
        .resolveScope(ctx.orgId, ctx.userId, permissions.projectWrite)
        .then((s) => this.accessScope.reachableTeamIds(ctx.orgId, s)),
      this.accessScope
        .resolveScope(ctx.orgId, ctx.userId, permissions.projectWrite)
        .then((s) => this.accessScope.visibleEmployeeIds(ctx.orgId, s)),
    ]);
    const teamOk = input.teamId ? reachTeams.includes(input.teamId) : false;
    const ownerOk = input.ownerEmployeeId ? (reachOwners ?? []).includes(input.ownerEmployeeId) : false;
    if (!teamOk && !ownerOk) {
      throw new ForbiddenException("New projects must belong to a team or owner within the departments you manage.");
    }
  }

  /**
   * One Prisma Project filter describing everything the caller may SEE:
   *   - org manager → no restriction
   *   - scoped manager → their departments/teams (manageWhere)
   *   - plain member → their own/team/assigned projects (viewIds)
   * Returns the `where` fragment to merge with `{ orgId }` (never a bare {} unless org).
   */
  private scopeFilter(scope: { canManage: boolean; manageWhere: Prisma.ProjectWhereInput | null; viewIds: Set<string> }): Prisma.ProjectWhereInput {
    if (scope.canManage) return scope.manageWhere ?? {};
    return { id: { in: [...scope.viewIds] } };
  }

  /**
   * Concrete visible project-id list for the caller, or null when unrestricted
   * (org manager). Use to bound project-linked resources (goals, tasks) that
   * have no scope of their own.
   */
  private async visibleProjectIds(scope: { canManage: boolean; manageWhere: Prisma.ProjectWhereInput | null; viewIds: Set<string> }): Promise<string[] | null> {
    if (scope.canManage && !scope.manageWhere) return null; // org tier
    if (scope.canManage) {
      const rows = await this.prisma.project.findMany({ where: { orgId: requireTenantContext().orgId, ...scope.manageWhere }, select: { id: true } });
      return rows.map((r) => r.id);
    }
    return [...scope.viewIds];
  }

  private async employeeNames(orgId: string): Promise<Map<string, string>> {
    const employees = await this.prisma.employee.findMany({
      where: { orgId },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));
  }

  /** done/total task tallies per project (DB aggregate — never loads task rows). */
  private async taskTallies(orgId: string, projectIds: string[]) {
    if (projectIds.length === 0) return { done: new Map<string, number>(), total: new Map<string, number>() };
    const [doneAgg, totalAgg] = await Promise.all([
      this.prisma.task.groupBy({ by: ["projectId"], where: { orgId, status: "DONE", projectId: { in: projectIds } }, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ["projectId"], where: { orgId, projectId: { in: projectIds } }, _count: { _all: true } }),
    ]);
    return {
      done: new Map(doneAgg.map((d) => [d.projectId, d._count._all])),
      total: new Map(totalAgg.map((d) => [d.projectId, d._count._all])),
    };
  }
  private progressOf(total: number, done: number, stored: number): number {
    return total > 0 ? Math.round((done / total) * 100) : stored;
  }

  /** Active employees for owner/assignee/member pickers — open to any member (avoids the employee.read gate). */
  async listPeople() {
    const ctx = requireTenantContext();
    const rows = await this.prisma.employee.findMany({
      where: { orgId: ctx.orgId, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, title: true, teamId: true, departmentId: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    return rows.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), title: e.title, teamId: e.teamId, departmentId: e.departmentId }));
  }

  /** The caller's employee id, or null if their login isn't linked to an employee. */
  private async callerEmployeeId(): Promise<string | null> {
    const ctx = requireTenantContext();
    const m = await this.prisma.organizationMembership.findUnique({ where: { id: ctx.membershipId }, select: { employeeId: true } });
    return m?.employeeId ?? null;
  }

  async listProjects(query: { page: number; pageSize: number; status?: string; q?: string }) {
    const ctx = requireTenantContext();
    const scope = await this.callerScope();
    const where: Record<string, unknown> = { orgId: ctx.orgId, ...this.scopeFilter(scope) };
    if (query.status && query.status !== "ALL") where.status = query.status;
    if (query.q?.trim()) where.name = { contains: query.q.trim(), mode: "insensitive" };

    const [projects, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { team: { select: { name: true } }, client: { select: { name: true } }, _count: { select: { tasks: true } } },
      }),
      this.prisma.project.count({ where }),
    ]);

    const ids = projects.map((p) => p.id);
    const tallies = await this.taskTallies(ctx.orgId, ids);
    const names = await this.employeeNames(ctx.orgId);

    return {
      items: projects.map((p) => {
        const taskTotal = p._count.tasks;
        const done = tallies.done.get(p.id) ?? 0;
        const progress = this.progressOf(taskTotal, done, p.progress);
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status,
          teamId: p.teamId,
          teamName: p.team?.name ?? null,
          clientId: p.clientId,
          clientName: p.client?.name ?? null,
          ownerEmployeeId: p.ownerEmployeeId,
          ownerName: p.ownerEmployeeId ? (names.get(p.ownerEmployeeId) ?? null) : null,
          startDate: iso(p.startDate),
          dueDate: iso(p.dueDate),
          progress,
          taskCount: taskTotal,
          doneCount: done,
          delayed: isDelayed(p.status, p.dueDate, progress),
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Portfolio KPIs + a per-project progress overview for the Projects dashboard. */
  async dashboard() {
    const ctx = requireTenantContext();
    const scope = await this.callerScope();
    const projWhere = { orgId: ctx.orgId, ...this.scopeFilter(scope) };
    const projects = await this.prisma.project.findMany({
      where: projWhere,
      select: { id: true, name: true, status: true, dueDate: true, progress: true, ownerEmployeeId: true },
      orderBy: { createdAt: "desc" },
    });
    const ids = projects.map((p) => p.id);
    // Tasks have no scope of their own — bound them to the visible projects.
    const taskWhere = scope.canManage && !scope.manageWhere ? { orgId: ctx.orgId } : { orgId: ctx.orgId, projectId: { in: ids } };
    const [taskGroups, memberCount] = await Promise.all([
      this.prisma.task.groupBy({ by: ["status"], where: taskWhere, _count: { _all: true } }),
      this.prisma.employee.count({ where: { orgId: ctx.orgId, status: "ACTIVE" } }),
    ]);

    const tallies = await this.taskTallies(ctx.orgId, ids);
    const names = await this.employeeNames(ctx.orgId);

    const withProgress = projects.map((p) => {
      const progress = this.progressOf(tallies.total.get(p.id) ?? 0, tallies.done.get(p.id) ?? 0, p.progress);
      return { ...p, progress, delayed: isDelayed(p.status, p.dueDate, progress) };
    });

    const taskByStatus = new Map(taskGroups.map((g) => [g.status, g._count._all]));
    const totalTasks = taskGroups.reduce((s, g) => s + g._count._all, 0);
    const doneTasks = taskByStatus.get("DONE") ?? 0;

    return {
      projects: {
        total: projects.length,
        active: withProgress.filter((p) => p.status === "ACTIVE").length,
        completed: withProgress.filter((p) => p.status === "COMPLETED").length,
        delayed: withProgress.filter((p) => p.delayed).length,
        onHold: withProgress.filter((p) => p.status === "ON_HOLD").length,
        planning: withProgress.filter((p) => p.status === "PLANNING").length,
      },
      tasks: { total: totalTasks, pending: totalTasks - doneTasks, completed: doneTasks },
      teamMembers: memberCount,
      // Progress overview: open projects (not archived/completed), most-at-risk first.
      overview: withProgress
        .filter((p) => p.status !== "ARCHIVED" && p.status !== "COMPLETED")
        .sort((a, b) => Number(b.delayed) - Number(a.delayed) || a.progress - b.progress)
        .slice(0, 8)
        .map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          progress: p.progress,
          dueDate: iso(p.dueDate),
          delayed: p.delayed,
          ownerName: p.ownerEmployeeId ? (names.get(p.ownerEmployeeId) ?? null) : null,
        })),
    };
  }

  async getProject(id: string) {
    const ctx = requireTenantContext();
    const scope = await this.callerScope();
    // Visible when: org manager (all), scoped manager whose filter matches, or a
    // plain member with this project in their view set.
    const visible = await this.prisma.project.findFirst({
      where: { id, orgId: ctx.orgId, ...this.scopeFilter(scope) },
      select: { id: true },
    });
    if (!visible) throw new NotFoundException("Project not found.");
    const [project, names, milestoneRows, goalRows] = await Promise.all([
      this.prisma.project.findFirst({
        where: { id, orgId: ctx.orgId },
        include: { team: { select: { id: true, name: true } }, tasks: { orderBy: { createdAt: "asc" } } },
      }),
      this.employeeNames(ctx.orgId),
      this.prisma.milestone.findMany({ where: { orgId: ctx.orgId, projectId: id }, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] }),
      this.prisma.goal.findMany({ where: { orgId: ctx.orgId, projectId: id }, orderBy: { createdAt: "desc" } }),
    ]);
    if (!project) throw new NotFoundException("Project not found.");

    const total = project.tasks.length;
    const done = project.tasks.filter((t) => t.status === "DONE").length;
    const progress = this.progressOf(total, done, project.progress);

    const tasks = project.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      assigneeEmployeeId: t.assigneeEmployeeId,
      assigneeName: t.assigneeEmployeeId ? (names.get(t.assigneeEmployeeId) ?? null) : null,
      dueDate: iso(t.dueDate),
      updatedAt: t.updatedAt.toISOString(),
    }));

    // Members = the project's team + anyone assigned a task on it.
    const memberIds = new Set<string>();
    if (project.teamId) {
      const teamEmployees = await this.prisma.employee.findMany({ where: { orgId: ctx.orgId, teamId: project.teamId, status: "ACTIVE" }, select: { id: true } });
      teamEmployees.forEach((e) => memberIds.add(e.id));
    }
    project.tasks.forEach((t) => t.assigneeEmployeeId && memberIds.add(t.assigneeEmployeeId));
    if (project.ownerEmployeeId) memberIds.add(project.ownerEmployeeId);
    const members = [...memberIds].map((mid) => ({
      id: mid,
      name: names.get(mid) ?? "Unknown",
      taskCount: project.tasks.filter((t) => t.assigneeEmployeeId === mid).length,
      isOwner: mid === project.ownerEmployeeId,
    }));

    // Recent activity: most-recently-touched tasks.
    const recentActivity = [...project.tasks]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 6)
      .map((t) => ({ taskId: t.id, title: t.title, status: t.status, at: t.updatedAt.toISOString() }));

    // Upcoming deadlines: open tasks with a due date, soonest first.
    const deadlines = project.tasks
      .filter((t) => t.status !== "DONE" && t.dueDate)
      .sort((a, b) => (a.dueDate as Date).getTime() - (b.dueDate as Date).getTime())
      .slice(0, 5)
      .map((t) => ({ taskId: t.id, title: t.title, dueDate: iso(t.dueDate), priority: t.priority }));

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      teamId: project.teamId,
      teamName: project.team?.name ?? null,
      ownerEmployeeId: project.ownerEmployeeId,
      ownerName: project.ownerEmployeeId ? (names.get(project.ownerEmployeeId) ?? null) : null,
      startDate: iso(project.startDate),
      dueDate: iso(project.dueDate),
      progress,
      taskCount: total,
      doneCount: done,
      delayed: isDelayed(project.status, project.dueDate, progress),
      tasks,
      members,
      recentActivity,
      deadlines,
      milestones: milestoneRows.map((m) => this.serializeMilestone(m, names)),
      goals: goalRows.map((g) => this.serializeGoal(g, names)),
      // Per-project, not per-role: an Owner is read-only on projects that already
      // have an assigned manager, so the UI must ask about THIS project.
      canManage: await this.canManageProject(id),
    };
  }

  /** The project's client must belong to this org — it drives billing attribution. */
  private async assertClient(orgId: string, clientId: string) {
    const c = await this.prisma.client.findFirst({ where: { id: clientId, orgId }, select: { id: true } });
    if (!c) throw new NotFoundException("Client not found.");
  }

  async createProject(input: CreateProjectInput) {
    const ctx = requireTenantContext();
    await this.assertCanCreateProject({ teamId: input.teamId, ownerEmployeeId: input.ownerEmployeeId });
    if (input.teamId) await this.assertTeam(ctx.orgId, input.teamId);
    if (input.clientId) await this.assertClient(ctx.orgId, input.clientId);
    const settings = await this.getSettings();
    return this.prisma.project.create({
      data: {
        orgId: ctx.orgId,
        name: input.name,
        description: input.description ?? null,
        status: input.status ?? (settings.defaultProjectStatus as CreateProjectInput["status"]) ?? "ACTIVE",
        ownerEmployeeId: input.ownerEmployeeId ?? null,
        teamId: input.teamId ?? null,
        clientId: input.clientId ?? null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      },
    });
  }

  async updateProject(id: string, input: UpdateProjectInput) {
    const ctx = requireTenantContext();
    const project = await this.prisma.project.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!project) throw new NotFoundException("Project not found.");
    await this.assertCanManageProject(id);
    if (input.teamId) await this.assertTeam(ctx.orgId, input.teamId);
    if (input.clientId) await this.assertClient(ctx.orgId, input.clientId);

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.status !== undefined) data.status = input.status;
    if (input.ownerEmployeeId !== undefined) data.ownerEmployeeId = input.ownerEmployeeId;
    if (input.teamId !== undefined) data.teamId = input.teamId;
    if (input.clientId !== undefined) data.clientId = input.clientId;
    if (input.startDate !== undefined) data.startDate = input.startDate ? new Date(input.startDate) : null;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    return this.prisma.project.update({ where: { id }, data });
  }

  /** Permanently delete a project. Tasks/milestones/goals cascade; time entries detach (FK SET NULL). */
  async deleteProject(id: string) {
    const ctx = requireTenantContext();
    const project = await this.prisma.project.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!project) throw new NotFoundException("Project not found.");
    await this.assertCanManageProject(id);
    await this.prisma.project.delete({ where: { id } });
    return { id, deleted: true };
  }

  private async assertTeam(orgId: string, teamId: string) {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, orgId }, select: { id: true } });
    if (!team) throw new NotFoundException("Team not found.");
  }

  async createTask(projectId: string, input: CreateTaskInput) {
    const ctx = requireTenantContext();
    const project = await this.prisma.project.findFirst({ where: { id: projectId, orgId: ctx.orgId }, select: { id: true } });
    if (!project) throw new NotFoundException("Project not found.");
    await this.assertCanManageProject(projectId);
    const settings = await this.getSettings();
    if (settings.workflow.requireTaskAssignee && !input.assigneeEmployeeId) throw new BadRequestException("An assignee is required for new tasks.");
    if (settings.workflow.blockPastDueTasks && input.dueDate && new Date(input.dueDate).getTime() < Date.now()) throw new BadRequestException("Task due date cannot be in the past.");
    const task = await this.prisma.task.create({
      data: {
        orgId: ctx.orgId,
        projectId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "TODO",
        priority: input.priority ?? (settings.defaultTaskPriority as CreateTaskInput["priority"]) ?? "MEDIUM",
        assigneeEmployeeId: input.assigneeEmployeeId ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      },
    });
    if (input.status === "DONE") await this.applyProjectWorkflow(projectId);
    await this.publishTaskAssigned(task);
    return task;
  }

  /** The caller's own assigned tasks across every project, for the "My Tasks" board. */
  async myTasks() {
    const ctx = requireTenantContext();
    const employeeId = await this.callerEmployeeId();
    if (!employeeId) return [];
    const rows = await this.prisma.task.findMany({
      where: { orgId: ctx.orgId, assigneeEmployeeId: employeeId },
      include: { project: { select: { id: true, name: true } } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      assigneeEmployeeId: t.assigneeEmployeeId,
      assigneeName: null as string | null,
      dueDate: iso(t.dueDate),
      updatedAt: t.updatedAt.toISOString(),
      projectId: t.project.id,
      projectName: t.project.name,
    }));
  }

  /**
   * Can the caller SEE this task? True when they manage its project, when the
   * project is in their view set, or when the task is assigned to them (an
   * assignee always reaches their own work, whatever the project scope).
   */
  private async canViewTask(task: { projectId: string; assigneeEmployeeId: string | null }): Promise<boolean> {
    const scope = await this.callerScope();
    const visible = await this.prisma.project.findFirst({
      where: { id: task.projectId, orgId: requireTenantContext().orgId, ...this.scopeFilter(scope) },
      select: { id: true },
    });
    if (visible) return true;
    const employeeId = await this.callerEmployeeId();
    return employeeId !== null && task.assigneeEmployeeId === employeeId;
  }

  /** Full task detail for the task page: project, assignee, and its discussion. */
  async getTask(taskId: string) {
    const ctx = requireTenantContext();
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, orgId: ctx.orgId },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!task) throw new NotFoundException("Task not found.");
    if (!(await this.canViewTask(task))) throw new NotFoundException("Task not found.");

    const [names, comments, canManage] = await Promise.all([
      this.employeeNames(ctx.orgId),
      this.listTaskComments(ctx.orgId, taskId),
      this.canManageProject(task.projectId),
    ]);
    const employeeId = await this.callerEmployeeId();

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assigneeEmployeeId: task.assigneeEmployeeId,
      assigneeName: task.assigneeEmployeeId ? (names.get(task.assigneeEmployeeId) ?? null) : null,
      dueDate: iso(task.dueDate),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      projectId: task.project.id,
      projectName: task.project.name,
      comments,
      // Drives the UI: a manager edits everything, an assignee only moves status.
      canManage,
      isAssignee: employeeId !== null && task.assigneeEmployeeId === employeeId,
    };
  }

  /** The task's discussion, oldest first, with author display names resolved. */
  private async listTaskComments(orgId: string, taskId: string) {
    const rows = await this.prisma.taskComment.findMany({
      where: { orgId, taskId },
      orderBy: { createdAt: "asc" },
    });
    if (rows.length === 0) return [];

    // Author names come from the membership's employee record; fall back to email.
    const userIds = [...new Set(rows.map((r) => r.authorUserId))];
    const members = await this.prisma.organizationMembership.findMany({
      where: { orgId, userId: { in: userIds } },
      select: { userId: true, user: { select: { email: true } }, employee: { select: { firstName: true, lastName: true } } },
    });
    const nameByUser = new Map(
      members.map((m) => [
        m.userId,
        m.employee ? `${m.employee.firstName} ${m.employee.lastName}`.trim() : (m.user?.email ?? "Unknown"),
      ]),
    );

    return rows.map((c) => ({
      id: c.id,
      body: c.body,
      authorUserId: c.authorUserId,
      authorName: nameByUser.get(c.authorUserId) ?? "Unknown",
      createdAt: c.createdAt.toISOString(),
    }));
  }

  /** Post a comment. Anyone who can see the task can join its discussion. */
  async addTaskComment(taskId: string, body: string) {
    const ctx = requireTenantContext();
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, orgId: ctx.orgId },
      select: { id: true, projectId: true, assigneeEmployeeId: true },
    });
    if (!task) throw new NotFoundException("Task not found.");
    if (!(await this.canViewTask(task))) throw new NotFoundException("Task not found.");

    const text = body.trim();
    if (!text) throw new BadRequestException("Write something before posting.");

    await this.prisma.taskComment.create({
      data: { orgId: ctx.orgId, taskId, authorUserId: ctx.userId, body: text },
    });
    return this.listTaskComments(ctx.orgId, taskId);
  }

  async updateTask(taskId: string, input: UpdateTaskInput) {
    const ctx = requireTenantContext();
    const task = await this.prisma.task.findFirst({ where: { id: taskId, orgId: ctx.orgId }, select: { id: true, projectId: true, assigneeEmployeeId: true } });
    if (!task) throw new NotFoundException("Task not found.");

    // A manager for THIS project (org-wide, or scoped to its department/team) can
    // edit the task fully. Otherwise an assignee may work on their OWN task —
    // move it between statuses and write up what they're doing — but not rename,
    // reprioritise, or reassign it, and never touch another department's work.
    const canManage = await this.canManageProject(task.projectId);
    if (!canManage) {
      const employeeId = await this.callerEmployeeId();
      const isAssignee = employeeId !== null && task.assigneeEmployeeId === employeeId;
      const keys = Object.keys(input);
      const ownFieldsOnly = keys.length > 0 && keys.every((k) => k === "status" || k === "description");
      if (!isAssignee || !ownFieldsOnly) {
        // Name the actual rule: an Owner is read-only because this project has a
        // manager; anyone else is limited to their own task's state/description.
        const scope = await this.callerScope();
        throw new ForbiddenException(
          scope.canManage && !scope.manageWhere
            ? "This project is managed by its assigned manager. You can view its tasks, but changes are theirs to make."
            : "On tasks assigned to you, you can change the state and description only.",
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.status !== undefined) data.status = input.status;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.assigneeEmployeeId !== undefined) data.assigneeEmployeeId = input.assigneeEmployeeId;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    const updated = await this.prisma.task.update({ where: { id: taskId }, data });
    if (input.status !== undefined) await this.applyProjectWorkflow(task.projectId);
    // Only on a genuine reassignment — not on every status/description edit.
    if (input.assigneeEmployeeId !== undefined && input.assigneeEmployeeId !== task.assigneeEmployeeId) {
      await this.publishTaskAssigned(updated);
    }
    return updated;
  }

  // ---- Phase 2: Teams & Departments overview -----------------------------

  /** Per-team performance: size, projects, task completion. */
  async teamsOverview() {
    const ctx = requireTenantContext();
    const [teams, employees, projects] = await Promise.all([
      this.prisma.team.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" }, include: { department: { select: { name: true } } } }),
      this.prisma.employee.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, teamId: true } }),
      this.prisma.project.findMany({ where: { orgId: ctx.orgId }, select: { id: true, teamId: true, status: true } }),
    ]);
    const tallies = await this.taskTallies(ctx.orgId, projects.map((p) => p.id));

    return teams.map((t) => {
      const members = employees.filter((e) => e.teamId === t.id);
      const teamProjects = projects.filter((p) => p.teamId === t.id);
      const totalTasks = teamProjects.reduce((s, p) => s + (tallies.total.get(p.id) ?? 0), 0);
      const doneTasks = teamProjects.reduce((s, p) => s + (tallies.done.get(p.id) ?? 0), 0);
      const lead = t.leadEmployeeId ? members.find((m) => m.id === t.leadEmployeeId) : undefined;
      return {
        id: t.id,
        name: t.name,
        departmentId: t.departmentId,
        departmentName: t.department?.name ?? null,
        leadEmployeeId: t.leadEmployeeId,
        leadName: lead ? `${lead.firstName} ${lead.lastName}`.trim() : null,
        size: members.length,
        memberNames: members.slice(0, 12).map((m) => `${m.firstName} ${m.lastName}`.trim()),
        activeProjects: teamProjects.filter((p) => p.status === "ACTIVE").length,
        totalProjects: teamProjects.length,
        totalTasks,
        doneTasks,
        progress: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
      };
    });
  }

  /** Per-department productivity: headcount, teams, projects, task completion. */
  async departmentsOverview() {
    const ctx = requireTenantContext();
    const [departments, employees, teams, projects] = await Promise.all([
      this.prisma.department.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" } }),
      this.prisma.employee.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE" }, select: { id: true, departmentId: true } }),
      this.prisma.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, departmentId: true } }),
      this.prisma.project.findMany({ where: { orgId: ctx.orgId }, select: { id: true, teamId: true, status: true } }),
    ]);
    const tallies = await this.taskTallies(ctx.orgId, projects.map((p) => p.id));
    const teamDept = new Map(teams.map((t) => [t.id, t.departmentId]));

    return departments.map((d) => {
      const deptTeamIds = new Set(teams.filter((t) => t.departmentId === d.id).map((t) => t.id));
      const deptProjects = projects.filter((p) => p.teamId && teamDept.get(p.teamId) === d.id);
      const totalTasks = deptProjects.reduce((s, p) => s + (tallies.total.get(p.id) ?? 0), 0);
      const doneTasks = deptProjects.reduce((s, p) => s + (tallies.done.get(p.id) ?? 0), 0);
      return {
        id: d.id,
        name: d.name,
        status: d.status,
        leadEmployeeId: d.leadEmployeeId,
        employees: employees.filter((e) => e.departmentId === d.id).length,
        teams: deptTeamIds.size,
        projects: deptProjects.length,
        activeProjects: deptProjects.filter((p) => p.status === "ACTIVE").length,
        totalTasks,
        doneTasks,
        productivity: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
      };
    });
  }

  // ---- Phase 3: Milestones ------------------------------------------------

  private serializeMilestone(m: { id: string; projectId: string; title: string; description: string | null; status: string; ownerEmployeeId: string | null; dueDate: Date | null; completedAt: Date | null; progress: number }, names: Map<string, string>) {
    return {
      id: m.id,
      projectId: m.projectId,
      title: m.title,
      description: m.description,
      status: m.status,
      ownerEmployeeId: m.ownerEmployeeId,
      ownerName: m.ownerEmployeeId ? (names.get(m.ownerEmployeeId) ?? null) : null,
      dueDate: iso(m.dueDate),
      completedAt: iso(m.completedAt),
      progress: m.status === "COMPLETED" ? 100 : m.progress,
    };
  }

  async createMilestone(projectId: string, input: CreateMilestoneInput) {
    const ctx = requireTenantContext();
    const project = await this.prisma.project.findFirst({ where: { id: projectId, orgId: ctx.orgId }, select: { id: true } });
    if (!project) throw new NotFoundException("Project not found.");
    await this.assertCanManageProject(projectId);
    const completed = input.status === "COMPLETED";
    const m = await this.prisma.milestone.create({
      data: {
        orgId: ctx.orgId,
        projectId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "PENDING",
        ownerEmployeeId: input.ownerEmployeeId ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        completedAt: completed ? new Date() : null,
        progress: completed ? 100 : input.progress ?? 0,
      },
    });
    return this.serializeMilestone(m, await this.employeeNames(ctx.orgId));
  }

  async updateMilestone(id: string, input: UpdateMilestoneInput) {
    const ctx = requireTenantContext();
    const existing = await this.prisma.milestone.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!existing) throw new NotFoundException("Milestone not found.");
    await this.assertCanManageProject(existing.projectId);
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.ownerEmployeeId !== undefined) data.ownerEmployeeId = input.ownerEmployeeId;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    if (input.progress !== undefined) data.progress = input.progress;
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === "COMPLETED") { data.completedAt = existing.completedAt ?? new Date(); data.progress = 100; }
      else data.completedAt = null;
    }
    const m = await this.prisma.milestone.update({ where: { id }, data });
    return this.serializeMilestone(m, await this.employeeNames(ctx.orgId));
  }

  async deleteMilestone(id: string) {
    const ctx = requireTenantContext();
    const m = await this.prisma.milestone.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true, projectId: true } });
    if (!m) throw new NotFoundException("Milestone not found.");
    await this.assertCanManageProject(m.projectId);
    await this.prisma.milestone.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---- Phase 3: Goals -----------------------------------------------------

  private serializeGoal(g: { id: string; projectId: string | null; title: string; description: string | null; status: string; metric: string | null; target: number | null; current: number; ownerEmployeeId: string | null; dueDate: Date | null }, names: Map<string, string>) {
    const progress = g.status === "ACHIEVED" ? 100 : g.target && g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
    return {
      id: g.id,
      projectId: g.projectId,
      title: g.title,
      description: g.description,
      status: g.status,
      metric: g.metric,
      target: g.target,
      current: g.current,
      ownerEmployeeId: g.ownerEmployeeId,
      ownerName: g.ownerEmployeeId ? (names.get(g.ownerEmployeeId) ?? null) : null,
      dueDate: iso(g.dueDate),
      progress,
    };
  }

  async listGoals(projectId?: string) {
    const ctx = requireTenantContext();
    const scope = await this.callerScope();
    const visibleIds = await this.visibleProjectIds(scope);
    if (visibleIds !== null && projectId && !visibleIds.includes(projectId)) return [];
    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (projectId) where.projectId = projectId;
    // Restricted callers only see goals attached to projects within their scope.
    else if (visibleIds !== null) where.projectId = { in: visibleIds };
    const [goals, names, projects] = await Promise.all([
      this.prisma.goal.findMany({ where, orderBy: { createdAt: "desc" } }),
      this.employeeNames(ctx.orgId),
      this.prisma.project.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
    ]);
    const projName = new Map(projects.map((p) => [p.id, p.name]));
    return goals.map((g) => ({ ...this.serializeGoal(g, names), projectName: g.projectId ? (projName.get(g.projectId) ?? null) : null }));
  }

  async createGoal(input: CreateGoalInput) {
    const ctx = requireTenantContext();
    if (input.projectId) {
      const p = await this.prisma.project.findFirst({ where: { id: input.projectId, orgId: ctx.orgId }, select: { id: true } });
      if (!p) throw new NotFoundException("Project not found.");
      await this.assertCanManageProject(input.projectId);
    } else {
      await this.assertOrgLevelManage(); // an org-wide goal needs org-wide reach
    }
    const g = await this.prisma.goal.create({
      data: {
        orgId: ctx.orgId,
        projectId: input.projectId ?? null,
        title: input.title,
        description: input.description ?? null,
        metric: input.metric ?? null,
        target: input.target ?? null,
        current: input.current ?? 0,
        ownerEmployeeId: input.ownerEmployeeId ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      },
    });
    return this.serializeGoal(g, await this.employeeNames(ctx.orgId));
  }

  async updateGoal(id: string, input: UpdateGoalInput) {
    const ctx = requireTenantContext();
    const existing = await this.prisma.goal.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true, projectId: true } });
    if (!existing) throw new NotFoundException("Goal not found.");
    if (existing.projectId) await this.assertCanManageProject(existing.projectId);
    else await this.assertOrgLevelManage();
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.status !== undefined) data.status = input.status;
    if (input.metric !== undefined) data.metric = input.metric;
    if (input.target !== undefined) data.target = input.target;
    if (input.current !== undefined) data.current = input.current;
    if (input.ownerEmployeeId !== undefined) data.ownerEmployeeId = input.ownerEmployeeId;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    const g = await this.prisma.goal.update({ where: { id }, data });
    return this.serializeGoal(g, await this.employeeNames(ctx.orgId));
  }

  async deleteGoal(id: string) {
    const ctx = requireTenantContext();
    const g = await this.prisma.goal.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true, projectId: true } });
    if (!g) throw new NotFoundException("Goal not found.");
    if (g.projectId) await this.assertCanManageProject(g.projectId);
    else await this.assertOrgLevelManage();
    await this.prisma.goal.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---- Phase 4: Reports & manager overview --------------------------------

  /** Aggregated data powering the project/task/team/progress reports (+ CSV export client-side). */
  async reports() {
    const ctx = requireTenantContext();
    const scope = await this.callerScope();
    const visibleIds = await this.visibleProjectIds(scope);
    const projWhere = visibleIds === null ? { orgId: ctx.orgId } : { orgId: ctx.orgId, id: { in: visibleIds } };
    const taskWhere = visibleIds === null ? { orgId: ctx.orgId } : { orgId: ctx.orgId, projectId: { in: visibleIds } };
    const [projects, tasks, names] = await Promise.all([
      this.prisma.project.findMany({ where: projWhere, orderBy: { createdAt: "desc" }, include: { team: { select: { name: true } } } }),
      this.prisma.task.findMany({ where: taskWhere, select: { status: true, priority: true, assigneeEmployeeId: true, dueDate: true, projectId: true } }),
      this.employeeNames(ctx.orgId),
    ]);
    const tallies = await this.taskTallies(ctx.orgId, projects.map((p) => p.id));

    const projectRows = projects.map((p) => {
      const total = tallies.total.get(p.id) ?? 0;
      const done = tallies.done.get(p.id) ?? 0;
      const progress = this.progressOf(total, done, p.progress);
      return {
        id: p.id,
        name: p.name,
        owner: p.ownerEmployeeId ? (names.get(p.ownerEmployeeId) ?? "—") : "—",
        team: p.team?.name ?? "—",
        status: p.status,
        tasks: total,
        done,
        progress,
        dueDate: iso(p.dueDate),
        delayed: isDelayed(p.status, p.dueDate, progress),
      };
    });

    // Task report grouped by assignee.
    const byAssignee = new Map<string, { name: string; total: number; done: number; pending: number; overdue: number }>();
    for (const t of tasks) {
      const key = t.assigneeEmployeeId ?? "__unassigned__";
      const row = byAssignee.get(key) ?? { name: t.assigneeEmployeeId ? (names.get(t.assigneeEmployeeId) ?? "Unknown") : "Unassigned", total: 0, done: 0, pending: 0, overdue: 0 };
      row.total += 1;
      if (t.status === "DONE") row.done += 1;
      else { row.pending += 1; if (t.dueDate && t.dueDate.getTime() < Date.now()) row.overdue += 1; }
      byAssignee.set(key, row);
    }

    const statusCounts = { PLANNING: 0, ACTIVE: 0, ON_HOLD: 0, COMPLETED: 0, ARCHIVED: 0 } as Record<string, number>;
    for (const p of projects) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;

    const totalTasks = tasks.length;
    const doneTasks = tasks.filter((t) => t.status === "DONE").length;

    // Members only see team rows for the teams their projects belong to.
    const allTeamRows = await this.teamsOverview();
    const scopedTeamIds = new Set(projects.map((p) => p.teamId).filter((x): x is string => Boolean(x)));
    // Org managers see every team's rollup; a scoped/limited caller sees only the
    // teams behind the projects already in their scope.
    const teamRows = visibleIds === null ? allTeamRows : allTeamRows.filter((t) => scopedTeamIds.has(t.id));

    return {
      projectRows,
      taskRows: [...byAssignee.values()].sort((a, b) => b.total - a.total),
      teamRows,
      progress: {
        overallProgress: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
        totalProjects: projects.length,
        totalTasks,
        doneTasks,
        delayed: projectRows.filter((p) => p.delayed).length,
        statusCounts,
      },
    };
  }

  /**
   * Manager monitoring view, scoped to the signed-in manager's team(s):
   * the teams they lead or belong to. Falls back to projects they own, then
   * to the whole org, so the view is never empty. `scopeLabel` says which.
   */
  async managerOverview() {
    const ctx = requireTenantContext();
    const employeeId = await this.callerEmployeeId();
    const grantScope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, permissions.projectWrite);

    let scopeLabel: string;
    let projects: (Awaited<ReturnType<typeof this.prisma.project.findMany>>[number] & { team: { name: string } | null })[];

    if (grantScope.tier === "scoped") {
      // Grant-scoped manager: exactly the projects in their departments/teams.
      const where = await this.accessScope.projectWhere(ctx.orgId, grantScope);
      projects = await this.prisma.project.findMany({ where: { orgId: ctx.orgId, ...where }, include: { team: { select: { name: true } } } });
      const deptNames = grantScope.departmentIds.length
        ? (await this.prisma.department.findMany({ where: { orgId: ctx.orgId, id: { in: grantScope.departmentIds } }, select: { name: true } })).map((d) => d.name)
        : [];
      const teamNms = grantScope.teamIds.length
        ? (await this.prisma.team.findMany({ where: { orgId: ctx.orgId, id: { in: grantScope.teamIds } }, select: { name: true } })).map((t) => t.name)
        : [];
      const labels = [...deptNames, ...teamNms];
      scopeLabel = labels.length ? labels.join(", ") : "Your scope";
    } else {
      // Org-wide manager, or legacy manager with no scoped grant: fall back to the
      // teams they lead / belong to, then owned projects, then all.
      const [ledTeams, me] = await Promise.all([
        employeeId ? this.prisma.team.findMany({ where: { orgId: ctx.orgId, leadEmployeeId: employeeId }, select: { id: true, name: true } }) : Promise.resolve([]),
        employeeId ? this.prisma.employee.findUnique({ where: { id: employeeId }, select: { teamId: true } }) : Promise.resolve(null),
      ]);
      const teamIds = new Set(ledTeams.map((t) => t.id));
      let teamNames = ledTeams.map((t) => t.name);
      if (me?.teamId && !teamIds.has(me.teamId)) {
        teamIds.add(me.teamId);
        const t = await this.prisma.team.findUnique({ where: { id: me.teamId }, select: { name: true } });
        if (t) teamNames = [...teamNames, t.name];
      }

      const allProjects = await this.prisma.project.findMany({ where: { orgId: ctx.orgId }, include: { team: { select: { name: true } } } });
      if (grantScope.tier === "org") {
        projects = allProjects;
        scopeLabel = "All projects";
      } else if (teamIds.size > 0) {
        projects = allProjects.filter((p) => p.teamId && teamIds.has(p.teamId));
        scopeLabel = teamNames.length ? `${teamNames.join(", ")} team${teamNames.length > 1 ? "s" : ""}` : "Your teams";
        if (employeeId) {
          const owned = allProjects.filter((p) => p.ownerEmployeeId === employeeId && !(p.teamId && teamIds.has(p.teamId)));
          projects = [...projects, ...owned];
        }
      } else if (employeeId && allProjects.some((p) => p.ownerEmployeeId === employeeId)) {
        projects = allProjects.filter((p) => p.ownerEmployeeId === employeeId);
        scopeLabel = "Your projects";
      } else {
        projects = allProjects;
        scopeLabel = "All projects";
      }
    }

    const projectIds = new Set(projects.map((p) => p.id));
    const [tasks, milestones, names] = await Promise.all([
      this.prisma.task.findMany({ where: { orgId: ctx.orgId, projectId: { in: [...projectIds] } }, include: { project: { select: { name: true } } } }),
      this.prisma.milestone.findMany({ where: { orgId: ctx.orgId, status: { not: "COMPLETED" }, projectId: { in: [...projectIds] } }, orderBy: { dueDate: "asc" } }),
      this.employeeNames(ctx.orgId),
    ]);
    const tallies = await this.taskTallies(ctx.orgId, projects.map((p) => p.id));
    const now = Date.now();

    const projectCards = projects.map((p) => {
      const total = tallies.total.get(p.id) ?? 0;
      const done = tallies.done.get(p.id) ?? 0;
      const progress = this.progressOf(total, done, p.progress);
      return { id: p.id, name: p.name, status: p.status, progress, delayed: isDelayed(p.status, p.dueDate, progress), dueDate: iso(p.dueDate), teamName: p.team?.name ?? null };
    });

    const openTasks = tasks.filter((t) => t.status !== "DONE");
    const delayedTasks = openTasks
      .filter((t) => t.dueDate && t.dueDate.getTime() < now)
      .sort((a, b) => (a.dueDate as Date).getTime() - (b.dueDate as Date).getTime())
      .slice(0, 12)
      .map((t) => ({ id: t.id, title: t.title, projectId: t.projectId, projectName: t.project?.name ?? null, assignee: t.assigneeEmployeeId ? (names.get(t.assigneeEmployeeId) ?? null) : null, dueDate: iso(t.dueDate), priority: t.priority }));

    // Workload: open task count per assignee.
    const workload = new Map<string, { name: string; open: number }>();
    for (const t of openTasks) {
      if (!t.assigneeEmployeeId) continue;
      const row = workload.get(t.assigneeEmployeeId) ?? { name: names.get(t.assigneeEmployeeId) ?? "Unknown", open: 0 };
      row.open += 1;
      workload.set(t.assigneeEmployeeId, row);
    }

    return {
      scopeLabel,
      teamNames: scopeLabel.split(", ").filter(Boolean),
      summary: {
        projects: projects.length,
        delayedProjects: projectCards.filter((p) => p.delayed).length,
        openTasks: openTasks.length,
        delayedTasks: openTasks.filter((t) => t.dueDate && t.dueDate.getTime() < now).length,
        upcomingMilestones: milestones.length,
      },
      atRisk: projectCards.filter((p) => p.delayed).slice(0, 8),
      delayedTasks,
      workload: [...workload.values()].sort((a, b) => b.open - a.open).slice(0, 10),
      milestones: milestones.slice(0, 8).map((m) => this.serializeMilestone(m, names)),
    };
  }

  // ---- Settings (Admin) ---------------------------------------------------

  /** Effective project settings for the org (stored, merged over defaults). */
  async getSettings() {
    const ctx = requireTenantContext();
    const row = await this.prisma.projectSetting.findUnique({ where: { orgId: ctx.orgId } });
    const statuses = Array.isArray(row?.statuses) && (row.statuses as unknown[]).length ? (row.statuses as typeof DEFAULT_STATUSES) : DEFAULT_STATUSES;
    const priorities = Array.isArray(row?.priorities) && (row.priorities as unknown[]).length ? (row.priorities as typeof DEFAULT_PRIORITIES) : DEFAULT_PRIORITIES;
    return {
      statuses,
      priorities,
      defaultProjectStatus: row?.defaultProjectStatus ?? "ACTIVE",
      defaultTaskPriority: row?.defaultTaskPriority ?? "MEDIUM",
      workflow: { ...DEFAULT_WORKFLOW, ...((row?.workflow as Record<string, boolean>) ?? {}) },
    };
  }

  async updateSettings(input: UpdateProjectSettingsInput) {
    const ctx = requireTenantContext();
    const current = await this.getSettings();
    const workflow = { ...current.workflow, ...(input.workflow ?? {}) };
    const data = {
      statuses: (input.statuses ?? current.statuses) as unknown as Prisma.InputJsonValue,
      priorities: (input.priorities ?? current.priorities) as unknown as Prisma.InputJsonValue,
      defaultProjectStatus: input.defaultProjectStatus ?? current.defaultProjectStatus,
      defaultTaskPriority: input.defaultTaskPriority ?? current.defaultTaskPriority,
      workflow: workflow as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.projectSetting.upsert({
      where: { orgId: ctx.orgId },
      create: { orgId: ctx.orgId, ...data },
      update: data,
    });
    return this.getSettings();
  }

  /** After a task change, apply auto-complete / auto-reopen workflow rules to its project. */
  private async applyProjectWorkflow(projectId: string) {
    const wf = (await this.getSettings()).workflow;
    if (!wf.autoCompleteProject && !wf.autoReopenProject) return;
    const ctx = requireTenantContext();
    const [agg, doneAgg, project] = await Promise.all([
      this.prisma.task.count({ where: { orgId: ctx.orgId, projectId } }),
      this.prisma.task.count({ where: { orgId: ctx.orgId, projectId, status: "DONE" } }),
      this.prisma.project.findFirst({ where: { id: projectId, orgId: ctx.orgId }, select: { status: true } }),
    ]);
    if (!project) return;
    const allDone = agg > 0 && doneAgg === agg;
    if (wf.autoCompleteProject && allDone && project.status === "ACTIVE") {
      await this.prisma.project.update({ where: { id: projectId }, data: { status: "COMPLETED" } });
    } else if (wf.autoReopenProject && !allDone && project.status === "COMPLETED") {
      await this.prisma.project.update({ where: { id: projectId }, data: { status: "ACTIVE" } });
    }
  }

  /** Lightweight team list for the project team picker. */
  async listTeams() {
    const ctx = requireTenantContext();
    const teams = await this.prisma.team.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return teams.map((t) => ({ id: t.id, name: t.name }));
  }

  async deleteTask(taskId: string) {
    const ctx = requireTenantContext();
    const task = await this.prisma.task.findFirst({ where: { id: taskId, orgId: ctx.orgId }, select: { id: true, projectId: true } });
    if (!task) throw new NotFoundException("Task not found.");
    await this.assertCanManageProject(task.projectId);
    await this.prisma.task.delete({ where: { id: taskId } });
    return { id: taskId, deleted: true };
  }
}
