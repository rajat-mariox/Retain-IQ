import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@retainiq/database/identity";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Default competencies suggested in the UI; stored as free-form strings so orgs can add their own. */
export const DEFAULT_COMPETENCIES = ["Quality of work", "Communication", "Ownership", "Collaboration", "Technical skill"];

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  // ------------------------------ Cycles ------------------------------
  async listCycles() {
    const ctx = requireTenantContext();
    const [cycles, grouped] = await Promise.all([
      this.prisma.reviewCycle.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" } }),
      this.prisma.performanceReview.groupBy({ by: ["cycleId", "status"], where: { orgId: ctx.orgId }, _count: { _all: true } }),
    ]);
    const byCycle = new Map<string, { total: number; done: number; ratingSum: number; ratingCount: number }>();
    for (const g of grouped) {
      const cur = byCycle.get(g.cycleId) ?? { total: 0, done: 0, ratingSum: 0, ratingCount: 0 };
      cur.total += g._count._all;
      if (g.status === "SUBMITTED" || g.status === "ACKNOWLEDGED") cur.done += g._count._all;
      byCycle.set(g.cycleId, cur);
    }
    return cycles.map((c) => {
      const s = byCycle.get(c.id) ?? { total: 0, done: 0 };
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        periodStart: iso(c.periodStart),
        periodEnd: iso(c.periodEnd),
        reviews: s.total,
        completed: s.done,
        percent: s.total ? Math.round((s.done / s.total) * 100) : 0,
        createdAt: c.createdAt.toISOString(),
      };
    });
  }

  async createCycle(input: { name: string; periodStart?: string; periodEnd?: string }) {
    const ctx = requireTenantContext();
    return this.prisma.reviewCycle.create({
      data: { orgId: ctx.orgId, name: input.name, periodStart: input.periodStart ? new Date(input.periodStart) : null, periodEnd: input.periodEnd ? new Date(input.periodEnd) : null },
    });
  }

  async updateCycle(id: string, input: { name?: string; status?: string; periodStart?: string | null; periodEnd?: string | null }) {
    const ctx = requireTenantContext();
    const c = await this.prisma.reviewCycle.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!c) throw new NotFoundException("Review cycle not found.");
    const data: Prisma.ReviewCycleUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.status !== undefined) data.status = input.status as Prisma.ReviewCycleUpdateInput["status"];
    if (input.periodStart !== undefined) data.periodStart = input.periodStart ? new Date(input.periodStart) : null;
    if (input.periodEnd !== undefined) data.periodEnd = input.periodEnd ? new Date(input.periodEnd) : null;
    return this.prisma.reviewCycle.update({ where: { id }, data });
  }

  async deleteCycle(id: string) {
    const ctx = requireTenantContext();
    const c = await this.prisma.reviewCycle.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!c) throw new NotFoundException("Review cycle not found.");
    await this.prisma.reviewCycle.delete({ where: { id } });
    return { ok: true };
  }

  /** Create review rows for the selected (or all active) employees, skipping any that already exist. */
  async generateReviews(cycleId: string, input: { employeeIds?: string[] }) {
    const ctx = requireTenantContext();
    const cycle = await this.prisma.reviewCycle.findFirst({ where: { id: cycleId, orgId: ctx.orgId }, select: { id: true } });
    if (!cycle) throw new NotFoundException("Review cycle not found.");
    const employees = await this.prisma.employee.findMany({
      where: { orgId: ctx.orgId, status: { not: "EXITED" }, ...(input.employeeIds?.length ? { id: { in: input.employeeIds } } : {}) },
      select: { id: true, managerId: true },
    });
    if (employees.length === 0) throw new BadRequestException("No eligible employees to add.");
    const res = await this.prisma.performanceReview.createMany({
      data: employees.map((e) => ({ orgId: ctx.orgId, cycleId, employeeId: e.id, reviewerEmployeeId: e.managerId })),
      skipDuplicates: true,
    });
    return { added: res.count };
  }

  // ------------------------------ Reviews -----------------------------
  async listReviews(cycleId: string) {
    const ctx = requireTenantContext();
    const cycle = await this.prisma.reviewCycle.findFirst({ where: { id: cycleId, orgId: ctx.orgId }, select: { id: true, name: true, status: true } });
    if (!cycle) throw new NotFoundException("Review cycle not found.");
    const reviews = await this.prisma.performanceReview.findMany({
      where: { orgId: ctx.orgId, cycleId },
      include: { employee: { select: { firstName: true, lastName: true, title: true } }, ratings: { select: { score: true } } },
      orderBy: { createdAt: "asc" },
    });
    return {
      cycle: { id: cycle.id, name: cycle.name, status: cycle.status },
      reviews: reviews.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
        title: r.employee.title,
        status: r.status,
        overallRating: r.overallRating,
        competencyAvg: r.ratings.length ? Math.round((r.ratings.reduce((a, x) => a + x.score, 0) / r.ratings.length) * 10) / 10 : null,
        submittedAt: iso(r.submittedAt),
      })),
    };
  }

  async getReview(id: string) {
    const ctx = requireTenantContext();
    const r = await this.prisma.performanceReview.findFirst({
      where: { id, orgId: ctx.orgId },
      include: { employee: { select: { id: true, firstName: true, lastName: true, title: true, email: true } }, cycle: { select: { id: true, name: true, status: true } }, ratings: { orderBy: { competency: "asc" } } },
    });
    if (!r) throw new NotFoundException("Review not found.");
    let reviewerName: string | null = null;
    if (r.reviewerEmployeeId) {
      const rev = await this.prisma.employee.findFirst({ where: { id: r.reviewerEmployeeId, orgId: ctx.orgId }, select: { firstName: true, lastName: true } });
      if (rev) reviewerName = `${rev.firstName} ${rev.lastName}`.trim();
    }
    return {
      id: r.id,
      status: r.status,
      overallRating: r.overallRating,
      selfAssessment: r.selfAssessment,
      strengths: r.strengths,
      improvements: r.improvements,
      managerComment: r.managerComment,
      submittedAt: iso(r.submittedAt),
      acknowledgedAt: iso(r.acknowledgedAt),
      reviewerName,
      employee: { id: r.employee.id, name: `${r.employee.firstName} ${r.employee.lastName}`.trim(), title: r.employee.title, email: r.employee.email },
      cycle: { id: r.cycle.id, name: r.cycle.name, status: r.cycle.status },
      ratings: r.ratings.map((x) => ({ id: x.id, competency: x.competency, score: x.score, comment: x.comment })),
      competencyOptions: DEFAULT_COMPETENCIES,
    };
  }

  async createReview(cycleId: string, employeeId: string) {
    const ctx = requireTenantContext();
    const [cycle, emp, existing] = await Promise.all([
      this.prisma.reviewCycle.findFirst({ where: { id: cycleId, orgId: ctx.orgId }, select: { id: true } }),
      this.prisma.employee.findFirst({ where: { id: employeeId, orgId: ctx.orgId }, select: { id: true, managerId: true } }),
      this.prisma.performanceReview.findFirst({ where: { orgId: ctx.orgId, cycleId, employeeId }, select: { id: true } }),
    ]);
    if (!cycle) throw new NotFoundException("Review cycle not found.");
    if (!emp) throw new NotFoundException("Employee not found.");
    if (existing) throw new BadRequestException("This employee already has a review in that cycle.");
    return this.prisma.performanceReview.create({ data: { orgId: ctx.orgId, cycleId, employeeId, reviewerEmployeeId: emp.managerId } });
  }

  async updateReview(id: string, input: { selfAssessment?: string | null; strengths?: string | null; improvements?: string | null; managerComment?: string | null; overallRating?: number | null; status?: string }) {
    const ctx = requireTenantContext();
    const r = await this.prisma.performanceReview.findFirst({ where: { id, orgId: ctx.orgId }, select: { status: true } });
    if (!r) throw new NotFoundException("Review not found.");
    const data: Prisma.PerformanceReviewUpdateInput = {};
    for (const k of ["selfAssessment", "strengths", "improvements", "managerComment", "overallRating"] as const) if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
    if (input.status !== undefined) {
      data.status = input.status as Prisma.PerformanceReviewUpdateInput["status"];
      if (input.status === "SUBMITTED") data.submittedAt = new Date();
      if (input.status === "ACKNOWLEDGED") data.acknowledgedAt = new Date();
    }
    return this.prisma.performanceReview.update({ where: { id }, data });
  }

  /** Replace the review's competency ratings in one shot. */
  async setRatings(reviewId: string, ratings: { competency: string; score: number; comment?: string | null }[]) {
    const ctx = requireTenantContext();
    const r = await this.prisma.performanceReview.findFirst({ where: { id: reviewId, orgId: ctx.orgId }, select: { id: true } });
    if (!r) throw new NotFoundException("Review not found.");
    return this.prisma.$transaction(async (tx) => {
      await tx.reviewRating.deleteMany({ where: { reviewId } });
      if (ratings.length) {
        await tx.reviewRating.createMany({ data: ratings.map((x) => ({ orgId: ctx.orgId, reviewId, competency: x.competency, score: x.score, comment: x.comment ?? null })) });
      }
      return { count: ratings.length };
    });
  }

  // --------------------------- Achievements ---------------------------
  async listAchievements(employeeId: string) {
    const ctx = requireTenantContext();
    const rows = await this.prisma.achievement.findMany({ where: { orgId: ctx.orgId, employeeId }, orderBy: { awardedOn: "desc" } });
    return rows.map((a) => ({ id: a.id, title: a.title, description: a.description, category: a.category, awardedOn: iso(a.awardedOn) }));
  }

  async addAchievement(employeeId: string, input: { title: string; description?: string; category?: string; awardedOn?: string }) {
    const ctx = requireTenantContext();
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId: ctx.orgId }, select: { id: true } });
    if (!emp) throw new NotFoundException("Employee not found.");
    // Recognition = a public, celebratory achievement. Notify the recognised
    // employee (via their membership) so it lands on their timeline/inbox.
    const membership = await this.prisma.organizationMembership.findFirst({ where: { orgId: ctx.orgId, employeeId, status: "ACTIVE" }, select: { userId: true } });
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.achievement.create({
        data: { orgId: ctx.orgId, employeeId, title: input.title, description: input.description ?? null, category: input.category ?? null, awardedOn: input.awardedOn ? new Date(input.awardedOn) : new Date(), createdBy: ctx.userId },
      });
      await this.outbox.enqueue(tx, {
        eventType: "recognition.created",
        aggregateType: "achievement", aggregateId: created.id, orgId: ctx.orgId,
        payload: { achievementId: created.id, employeeId, title: input.title, category: input.category ?? "OTHER", requesterUserId: membership?.userId ?? null },
      });
      return created;
    });
  }

  async deleteAchievement(id: string) {
    const ctx = requireTenantContext();
    const a = await this.prisma.achievement.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!a) throw new NotFoundException("Achievement not found.");
    await this.prisma.achievement.delete({ where: { id } });
    return { ok: true };
  }

  // --------------------- Per-employee performance ---------------------
  async employeeHistory(employeeId: string) {
    const ctx = requireTenantContext();
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId: ctx.orgId }, select: { id: true, firstName: true, lastName: true, title: true } });
    if (!emp) throw new NotFoundException("Employee not found.");
    const [reviews, achievements] = await Promise.all([
      this.prisma.performanceReview.findMany({
        where: { orgId: ctx.orgId, employeeId },
        include: { cycle: { select: { name: true } }, ratings: { select: { score: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.listAchievements(employeeId),
    ]);
    const rated = reviews.filter((r) => r.overallRating != null);
    return {
      employee: { id: emp.id, name: `${emp.firstName} ${emp.lastName}`.trim(), title: emp.title },
      averageRating: rated.length ? Math.round((rated.reduce((a, r) => a + (r.overallRating ?? 0), 0) / rated.length) * 10) / 10 : null,
      reviews: reviews.map((r) => ({
        id: r.id,
        cycleName: r.cycle.name,
        status: r.status,
        overallRating: r.overallRating,
        competencyAvg: r.ratings.length ? Math.round((r.ratings.reduce((a, x) => a + x.score, 0) / r.ratings.length) * 10) / 10 : null,
        submittedAt: iso(r.submittedAt),
      })),
      achievements,
    };
  }
}
