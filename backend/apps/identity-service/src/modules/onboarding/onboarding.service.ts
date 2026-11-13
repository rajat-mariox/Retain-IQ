import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@retainiq/database/identity";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

type Category = "TASK" | "DOCUMENT" | "POLICY" | "ACCESS" | "TRAINING";
type Assignee = "EMPLOYEE" | "HR" | "MANAGER" | "IT";

interface SeedItem {
  title: string;
  description?: string;
  category: Category;
  assignee: Assignee;
  required?: boolean;
}

/** Built-in checklist used when the org has not configured its own default template. */
const DEFAULT_ITEMS: SeedItem[] = [
  { title: "Send welcome email & first-day details", category: "TASK", assignee: "HR" },
  { title: "Collect signed offer letter", category: "DOCUMENT", assignee: "HR" },
  { title: "Collect ID & address proof", category: "DOCUMENT", assignee: "HR" },
  { title: "Collect bank & tax details", category: "DOCUMENT", assignee: "HR" },
  { title: "Create email & system accounts", category: "ACCESS", assignee: "IT" },
  { title: "Provision laptop & equipment", category: "ACCESS", assignee: "IT" },
  { title: "Acknowledge code of conduct", category: "POLICY", assignee: "EMPLOYEE" },
  { title: "Acknowledge IT & security policy", category: "POLICY", assignee: "EMPLOYEE" },
  { title: "Assign a buddy / mentor", category: "TASK", assignee: "MANAGER" },
  { title: "Complete orientation & team intro", category: "TRAINING", assignee: "MANAGER" },
];

function progressOf(tasks: { status: string; required: boolean }[]) {
  const active = tasks.filter((t) => t.status !== "SKIPPED");
  const done = active.filter((t) => t.status === "DONE").length;
  const total = active.length;
  const requiredTotal = active.filter((t) => t.required).length;
  const requiredDone = active.filter((t) => t.required && t.status === "DONE").length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0, requiredTotal, requiredDone };
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------- Templates ----------------------------
  async listTemplates() {
    const ctx = requireTenantContext();
    const rows = await this.prisma.onboardingTemplate.findMany({
      where: { orgId: ctx.orgId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { items: true } } },
    });
    return rows.map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault, items: t._count.items, createdAt: t.createdAt.toISOString() }));
  }

  async getTemplate(id: string) {
    const ctx = requireTenantContext();
    const t = await this.prisma.onboardingTemplate.findFirst({ where: { id, orgId: ctx.orgId }, include: { items: { orderBy: { order: "asc" } } } });
    if (!t) throw new NotFoundException("Template not found.");
    return { id: t.id, name: t.name, isDefault: t.isDefault, items: t.items };
  }

  async createTemplate(input: { name: string; seedDefault?: boolean }) {
    const ctx = requireTenantContext();
    return this.prisma.$transaction(async (tx) => {
      const isFirst = (await tx.onboardingTemplate.count({ where: { orgId: ctx.orgId } })) === 0;
      const t = await tx.onboardingTemplate.create({ data: { orgId: ctx.orgId, name: input.name, isDefault: isFirst } });
      if (input.seedDefault) {
        await tx.onboardingTemplateItem.createMany({
          data: DEFAULT_ITEMS.map((it, i) => ({ orgId: ctx.orgId, templateId: t.id, title: it.title, description: it.description ?? null, category: it.category, assignee: it.assignee, order: i, required: it.required ?? true })),
        });
      }
      return t;
    });
  }

  async updateTemplate(id: string, input: { name?: string; isDefault?: boolean }) {
    const ctx = requireTenantContext();
    const t = await this.prisma.onboardingTemplate.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!t) throw new NotFoundException("Template not found.");
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) await tx.onboardingTemplate.updateMany({ where: { orgId: ctx.orgId, isDefault: true }, data: { isDefault: false } });
      const data: Prisma.OnboardingTemplateUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.isDefault !== undefined) data.isDefault = input.isDefault;
      return tx.onboardingTemplate.update({ where: { id }, data });
    });
  }

  async deleteTemplate(id: string) {
    const ctx = requireTenantContext();
    const t = await this.prisma.onboardingTemplate.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!t) throw new NotFoundException("Template not found.");
    await this.prisma.onboardingTemplate.delete({ where: { id } });
    return { ok: true };
  }

  async addItem(templateId: string, input: SeedItem & { order?: number }) {
    const ctx = requireTenantContext();
    const t = await this.prisma.onboardingTemplate.findFirst({ where: { id: templateId, orgId: ctx.orgId }, select: { id: true } });
    if (!t) throw new NotFoundException("Template not found.");
    const max = await this.prisma.onboardingTemplateItem.aggregate({ where: { templateId }, _max: { order: true } });
    return this.prisma.onboardingTemplateItem.create({
      data: { orgId: ctx.orgId, templateId, title: input.title, description: input.description ?? null, category: input.category, assignee: input.assignee, required: input.required ?? true, order: input.order ?? (max._max.order ?? -1) + 1 },
    });
  }

  async updateItem(id: string, input: Partial<SeedItem> & { order?: number }) {
    const ctx = requireTenantContext();
    const item = await this.prisma.onboardingTemplateItem.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!item) throw new NotFoundException("Item not found.");
    const data: Prisma.OnboardingTemplateItemUpdateInput = {};
    for (const k of ["title", "description", "category", "assignee", "required", "order"] as const) if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
    return this.prisma.onboardingTemplateItem.update({ where: { id }, data });
  }

  async deleteItem(id: string) {
    const ctx = requireTenantContext();
    const item = await this.prisma.onboardingTemplateItem.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!item) throw new NotFoundException("Item not found.");
    await this.prisma.onboardingTemplateItem.delete({ where: { id } });
    return { ok: true };
  }

  // ---------------------------- Journeys -----------------------------
  /** HR dashboard: everyone currently onboarding + their progress, plus employees who still need a journey. */
  async overview() {
    const ctx = requireTenantContext();
    // Fresh hires (ONBOARDING) plus anyone still working an in-progress journey,
    // so advancing lifecycle to PROBATION doesn't hide an unfinished checklist.
    const employees = await this.prisma.employee.findMany({
      where: { orgId: ctx.orgId, OR: [{ lifecycleStage: "ONBOARDING" }, { onboarding: { is: { status: "IN_PROGRESS" } } }] },
      orderBy: { joinedAt: "desc" },
      select: { id: true, firstName: true, lastName: true, title: true, joinedAt: true, onboarding: { include: { tasks: { select: { status: true, required: true } } } } },
    });
    const rows = employees.map((e) => {
      const j = e.onboarding;
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        title: e.title,
        joinedAt: e.joinedAt ? e.joinedAt.toISOString() : null,
        journey: j ? { id: j.id, status: j.status, startedAt: j.startedAt.toISOString(), ...progressOf(j.tasks) } : null,
      };
    });
    return {
      rows,
      counts: {
        onboarding: rows.length,
        notStarted: rows.filter((r) => !r.journey).length,
        inProgress: rows.filter((r) => r.journey && r.journey.status === "IN_PROGRESS").length,
        completed: rows.filter((r) => r.journey && r.journey.status === "COMPLETED").length,
      },
    };
  }

  async startJourney(employeeId: string, templateId?: string) {
    const ctx = requireTenantContext();
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId: ctx.orgId }, select: { id: true, onboarding: { select: { id: true } } } });
    if (!emp) throw new NotFoundException("Employee not found.");
    if (emp.onboarding) throw new BadRequestException("This employee already has an onboarding journey.");

    // Resolve the item set: explicit template → org default template → built-in defaults.
    const template = templateId
      ? await this.prisma.onboardingTemplate.findFirst({ where: { id: templateId, orgId: ctx.orgId }, include: { items: { orderBy: { order: "asc" } } } })
      : await this.prisma.onboardingTemplate.findFirst({ where: { orgId: ctx.orgId, isDefault: true }, include: { items: { orderBy: { order: "asc" } } } });
    if (templateId && !template) throw new NotFoundException("Template not found.");

    const items: SeedItem[] = template?.items.length
      ? template.items.map((i) => ({ title: i.title, description: i.description ?? undefined, category: i.category, assignee: i.assignee, required: i.required }))
      : DEFAULT_ITEMS;

    return this.prisma.$transaction(async (tx) => {
      const journey = await tx.onboardingJourney.create({ data: { orgId: ctx.orgId, employeeId, templateId: template?.id ?? null } });
      await tx.onboardingTask.createMany({
        data: items.map((it, i) => ({ orgId: ctx.orgId, journeyId: journey.id, title: it.title, description: it.description ?? null, category: it.category, assignee: it.assignee, order: i, required: it.required ?? true })),
      });
      return { id: journey.id, employeeId, tasks: items.length };
    });
  }

  async getJourney(employeeId: string) {
    const ctx = requireTenantContext();
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, orgId: ctx.orgId },
      select: { id: true, firstName: true, lastName: true, title: true, email: true, joinedAt: true, lifecycleStage: true, onboarding: { include: { tasks: { orderBy: { order: "asc" } }, template: { select: { name: true } } } } },
    });
    if (!emp) throw new NotFoundException("Employee not found.");
    const j = emp.onboarding;
    return {
      employee: { id: emp.id, name: `${emp.firstName} ${emp.lastName}`.trim(), title: emp.title, email: emp.email, joinedAt: emp.joinedAt ? emp.joinedAt.toISOString() : null, lifecycleStage: emp.lifecycleStage },
      journey: j
        ? {
            id: j.id,
            status: j.status,
            templateName: j.template?.name ?? null,
            startedAt: j.startedAt.toISOString(),
            completedAt: j.completedAt ? j.completedAt.toISOString() : null,
            ...progressOf(j.tasks),
            tasks: j.tasks.map((t) => ({ id: t.id, title: t.title, description: t.description, category: t.category, assignee: t.assignee, order: t.order, required: t.required, status: t.status, completedAt: t.completedAt ? t.completedAt.toISOString() : null, note: t.note })),
          }
        : null,
    };
  }

  async setTaskStatus(taskId: string, input: { status: "PENDING" | "DONE" | "SKIPPED"; note?: string | null }) {
    const ctx = requireTenantContext();
    const task = await this.prisma.onboardingTask.findFirst({ where: { id: taskId, orgId: ctx.orgId }, select: { id: true, journeyId: true } });
    if (!task) throw new NotFoundException("Task not found.");
    const data: Prisma.OnboardingTaskUpdateInput = {
      status: input.status,
      completedAt: input.status === "DONE" ? new Date() : null,
      completedBy: input.status === "DONE" ? ctx.userId : null,
    };
    if (input.note !== undefined) data.note = input.note;
    await this.prisma.onboardingTask.update({ where: { id: taskId }, data });
    await this.syncJourneyCompletion(task.journeyId);
    return { ok: true };
  }

  async addTask(journeyId: string, input: SeedItem) {
    const ctx = requireTenantContext();
    const j = await this.prisma.onboardingJourney.findFirst({ where: { id: journeyId, orgId: ctx.orgId }, select: { id: true } });
    if (!j) throw new NotFoundException("Journey not found.");
    const max = await this.prisma.onboardingTask.aggregate({ where: { journeyId }, _max: { order: true } });
    const created = await this.prisma.onboardingTask.create({
      data: { orgId: ctx.orgId, journeyId, title: input.title, description: input.description ?? null, category: input.category, assignee: input.assignee, required: input.required ?? true, order: (max._max.order ?? -1) + 1 },
    });
    await this.syncJourneyCompletion(journeyId);
    return created;
  }

  async deleteTask(taskId: string) {
    const ctx = requireTenantContext();
    const task = await this.prisma.onboardingTask.findFirst({ where: { id: taskId, orgId: ctx.orgId }, select: { id: true, journeyId: true } });
    if (!task) throw new NotFoundException("Task not found.");
    await this.prisma.onboardingTask.delete({ where: { id: taskId } });
    await this.syncJourneyCompletion(task.journeyId);
    return { ok: true };
  }

  /** Flip journey status to COMPLETED when every required task is done (and back if reopened). */
  private async syncJourneyCompletion(journeyId: string) {
    const tasks = await this.prisma.onboardingTask.findMany({ where: { journeyId }, select: { status: true, required: true } });
    const p = progressOf(tasks);
    const complete = p.requiredTotal > 0 && p.requiredDone === p.requiredTotal;
    const journey = await this.prisma.onboardingJourney.findUnique({ where: { id: journeyId }, select: { status: true } });
    if (!journey) return;
    if (complete && journey.status !== "COMPLETED") await this.prisma.onboardingJourney.update({ where: { id: journeyId }, data: { status: "COMPLETED", completedAt: new Date() } });
    if (!complete && journey.status === "COMPLETED") await this.prisma.onboardingJourney.update({ where: { id: journeyId }, data: { status: "IN_PROGRESS", completedAt: null } });
  }
}
