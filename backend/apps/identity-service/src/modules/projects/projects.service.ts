import { Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import type { CreateProjectInput, CreateTaskInput, UpdateTaskInput } from "./dto.js";

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  private async employeeNames(orgId: string): Promise<Map<string, string>> {
    const employees = await this.prisma.employee.findMany({
      where: { orgId },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));
  }

  async listProjects(query: { page: number; pageSize: number }) {
    const ctx = requireTenantContext();
    const where = { orgId: ctx.orgId };
    const [projects, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { team: { select: { name: true } }, _count: { select: { tasks: true } } },
      }),
      this.prisma.project.count({ where }),
    ]);

    // Done-task tallies for this page only — DB aggregate, never load task rows.
    const ids = projects.map((p) => p.id);
    const doneAgg = ids.length
      ? await this.prisma.task.groupBy({
          by: ["projectId"],
          where: { orgId: ctx.orgId, status: "DONE", projectId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const doneByProject = new Map(doneAgg.map((d) => [d.projectId, d._count._all]));

    return {
      items: projects.map((p) => {
        const taskTotal = p._count.tasks;
        const done = doneByProject.get(p.id) ?? 0;
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status,
          teamName: p.team?.name ?? null,
          startDate: p.startDate?.toISOString() ?? null,
          dueDate: p.dueDate?.toISOString() ?? null,
          progress: taskTotal > 0 ? Math.round((done / taskTotal) * 100) : p.progress,
          taskCount: taskTotal,
          doneCount: done,
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getProject(id: string) {
    const ctx = requireTenantContext();
    const [project, names] = await Promise.all([
      this.prisma.project.findFirst({
        where: { id, orgId: ctx.orgId },
        include: { team: { select: { name: true } }, tasks: { orderBy: { createdAt: "asc" } } },
      }),
      this.employeeNames(ctx.orgId),
    ]);
    if (!project) {
      throw new NotFoundException("Project not found.");
    }
    const total = project.tasks.length;
    const done = project.tasks.filter((t) => t.status === "DONE").length;
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      teamName: project.team?.name ?? null,
      startDate: project.startDate?.toISOString() ?? null,
      dueDate: project.dueDate?.toISOString() ?? null,
      progress: total > 0 ? Math.round((done / total) * 100) : project.progress,
      tasks: project.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assigneeEmployeeId: t.assigneeEmployeeId,
        assigneeName: t.assigneeEmployeeId ? (names.get(t.assigneeEmployeeId) ?? null) : null,
        dueDate: t.dueDate?.toISOString() ?? null,
      })),
    };
  }

  async createProject(input: CreateProjectInput) {
    const ctx = requireTenantContext();
    return this.prisma.project.create({
      data: {
        orgId: ctx.orgId,
        name: input.name,
        description: input.description,
        status: input.status ?? "ACTIVE",
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      },
    });
  }

  async createTask(projectId: string, input: CreateTaskInput) {
    const ctx = requireTenantContext();
    const project = await this.prisma.project.findFirst({ where: { id: projectId, orgId: ctx.orgId }, select: { id: true } });
    if (!project) {
      throw new NotFoundException("Project not found.");
    }
    return this.prisma.task.create({
      data: {
        orgId: ctx.orgId,
        projectId,
        title: input.title,
        description: input.description,
        priority: input.priority ?? "MEDIUM",
        assigneeEmployeeId: input.assigneeEmployeeId ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      },
    });
  }

  async updateTask(taskId: string, input: UpdateTaskInput) {
    const ctx = requireTenantContext();
    const task = await this.prisma.task.findFirst({ where: { id: taskId, orgId: ctx.orgId }, select: { id: true } });
    if (!task) {
      throw new NotFoundException("Task not found.");
    }
    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: input.status,
        priority: input.priority,
        assigneeEmployeeId: input.assigneeEmployeeId,
      },
    });
  }

  async listTeams() {
    const ctx = requireTenantContext();
    const teams = await this.prisma.team.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { name: "asc" },
      include: { _count: { select: { projects: true } } },
    });
    return teams.map((t) => ({ id: t.id, name: t.name, description: t.description, projectCount: t._count.projects }));
  }
}
