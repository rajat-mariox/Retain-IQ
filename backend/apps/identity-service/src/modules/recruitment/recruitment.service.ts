import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED"] as const;

@Injectable()
export class RecruitmentService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Requisitions (job openings) ----
  async listRequisitions() {
    const ctx = requireTenantContext();
    const [reqs, depts, apps] = await Promise.all([
      this.prisma.requisition.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" } }),
      this.prisma.department.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
      this.prisma.application.groupBy({ by: ["requisitionId", "stage"], where: { orgId: ctx.orgId }, _count: { _all: true } }),
    ]);
    const deptName = new Map(depts.map((d) => [d.id, d.name]));
    const byReq = new Map<string, { total: number; hired: number; active: number }>();
    for (const a of apps) {
      const cur = byReq.get(a.requisitionId) ?? { total: 0, hired: 0, active: 0 };
      cur.total += a._count._all;
      if (a.stage === "HIRED") cur.hired += a._count._all;
      if (a.stage !== "HIRED" && a.stage !== "REJECTED") cur.active += a._count._all;
      byReq.set(a.requisitionId, cur);
    }
    return reqs.map((r) => ({
      id: r.id,
      title: r.title,
      departmentId: r.departmentId,
      departmentName: r.departmentId ? (deptName.get(r.departmentId) ?? null) : null,
      location: r.location,
      employmentType: r.employmentType,
      description: r.description,
      openings: r.openings,
      status: r.status,
      candidates: byReq.get(r.id)?.total ?? 0,
      active: byReq.get(r.id)?.active ?? 0,
      hired: byReq.get(r.id)?.hired ?? 0,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createRequisition(input: { title: string; departmentId?: string | null; designationId?: string | null; location?: string | null; employmentType?: string | null; description?: string | null; openings?: number }) {
    const ctx = requireTenantContext();
    return this.prisma.requisition.create({
      data: { orgId: ctx.orgId, title: input.title, departmentId: input.departmentId ?? null, designationId: input.designationId ?? null, location: input.location ?? null, employmentType: input.employmentType ?? null, description: input.description ?? null, openings: input.openings ?? 1 },
    });
  }

  async updateRequisition(id: string, input: Record<string, unknown>) {
    const ctx = requireTenantContext();
    const r = await this.prisma.requisition.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!r) throw new NotFoundException("Requisition not found.");
    const data: Record<string, unknown> = {};
    for (const k of ["title", "departmentId", "designationId", "location", "employmentType", "description", "openings", "status"]) if (input[k] !== undefined) data[k] = input[k];
    return this.prisma.requisition.update({ where: { id }, data });
  }

  // ---- Pipeline (kanban board) ----
  async pipeline(requisitionId?: string) {
    const ctx = requireTenantContext();
    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (requisitionId) where.requisitionId = requisitionId;
    const apps = await this.prisma.application.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: { candidate: { select: { firstName: true, lastName: true, email: true } }, requisition: { select: { title: true } } },
    });
    const cards = apps.map((a) => ({
      id: a.id,
      stage: a.stage,
      rating: a.rating,
      candidateName: `${a.candidate.firstName} ${a.candidate.lastName}`.trim(),
      candidateEmail: a.candidate.email,
      requisitionId: a.requisitionId,
      requisitionTitle: a.requisition.title,
      appliedAt: a.appliedAt.toISOString(),
    }));
    const byStage = Object.fromEntries(STAGES.map((s) => [s, cards.filter((c) => c.stage === s)]));
    return { stages: STAGES, byStage, total: cards.length };
  }

  // ---- Candidates + applications ----
  async listCandidates(q?: string) {
    const ctx = requireTenantContext();
    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (q?.trim()) where.OR = [{ firstName: { contains: q.trim(), mode: "insensitive" } }, { lastName: { contains: q.trim(), mode: "insensitive" } }, { email: { contains: q.trim(), mode: "insensitive" } }];
    const rows = await this.prisma.candidate.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { _count: { select: { applications: true } } } });
    return rows.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim(), email: c.email, phone: c.phone, source: c.source, applications: c._count.applications, createdAt: c.createdAt.toISOString() }));
  }

  /** Add a candidate and (optionally) create their application to a requisition. */
  async createCandidate(input: { firstName: string; lastName: string; email?: string; phone?: string; source?: string; requisitionId?: string }) {
    const ctx = requireTenantContext();
    if (input.requisitionId) {
      const r = await this.prisma.requisition.findFirst({ where: { id: input.requisitionId, orgId: ctx.orgId }, select: { id: true } });
      if (!r) throw new NotFoundException("Requisition not found.");
    }
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.candidate.create({ data: { orgId: ctx.orgId, firstName: input.firstName, lastName: input.lastName, email: input.email ?? null, phone: input.phone ?? null, source: input.source ?? null } });
      let applicationId: string | null = null;
      if (input.requisitionId) {
        const app = await tx.application.create({ data: { orgId: ctx.orgId, candidateId: candidate.id, requisitionId: input.requisitionId, stage: "APPLIED" } });
        applicationId = app.id;
      }
      return { id: candidate.id, applicationId };
    });
  }

  async getApplication(id: string) {
    const ctx = requireTenantContext();
    const app = await this.prisma.application.findFirst({
      where: { id, orgId: ctx.orgId },
      include: { candidate: true, requisition: { select: { id: true, title: true } }, interviews: { orderBy: { createdAt: "asc" } }, offers: { orderBy: { createdAt: "desc" } } },
    });
    if (!app) throw new NotFoundException("Application not found.");
    return {
      id: app.id,
      stage: app.stage,
      rating: app.rating,
      notes: app.notes,
      rejectedReason: app.rejectedReason,
      hiredEmployeeId: app.hiredEmployeeId,
      appliedAt: app.appliedAt.toISOString(),
      candidate: { id: app.candidate.id, name: `${app.candidate.firstName} ${app.candidate.lastName}`.trim(), email: app.candidate.email, phone: app.candidate.phone, source: app.candidate.source },
      requisition: { id: app.requisition.id, title: app.requisition.title },
      interviews: app.interviews.map((i) => ({ id: i.id, round: i.round, scheduledAt: iso(i.scheduledAt), interviewer: i.interviewer, mode: i.mode, outcome: i.outcome, rating: i.rating, feedback: i.feedback })),
      offers: app.offers.map((o) => ({ id: o.id, title: o.title, salary: o.salary, joiningDate: iso(o.joiningDate), status: o.status, sentAt: iso(o.sentAt), decidedAt: iso(o.decidedAt), note: o.note })),
    };
  }

  async createApplication(input: { candidateId: string; requisitionId: string }) {
    const ctx = requireTenantContext();
    const [c, r] = await Promise.all([
      this.prisma.candidate.findFirst({ where: { id: input.candidateId, orgId: ctx.orgId }, select: { id: true } }),
      this.prisma.requisition.findFirst({ where: { id: input.requisitionId, orgId: ctx.orgId }, select: { id: true } }),
    ]);
    if (!c) throw new NotFoundException("Candidate not found.");
    if (!r) throw new NotFoundException("Requisition not found.");
    const existing = await this.prisma.application.findFirst({ where: { orgId: ctx.orgId, candidateId: input.candidateId, requisitionId: input.requisitionId }, select: { id: true } });
    if (existing) throw new ConflictException("This candidate already has an application for that requisition.");
    return this.prisma.application.create({ data: { orgId: ctx.orgId, candidateId: input.candidateId, requisitionId: input.requisitionId, stage: "APPLIED" } });
  }

  /** Move stage / rate / note / reject an application. */
  async updateApplication(id: string, input: { stage?: string; rating?: number | null; notes?: string | null; rejectedReason?: string | null }) {
    const ctx = requireTenantContext();
    const app = await this.prisma.application.findFirst({ where: { id, orgId: ctx.orgId }, select: { stage: true } });
    if (!app) throw new NotFoundException("Application not found.");
    const data: Record<string, unknown> = {};
    // A hired application is frozen in place, but its rating/notes stay editable.
    if (input.stage !== undefined) {
      if (app.stage === "HIRED") throw new ConflictException("A hired application can no longer be moved.");
      if (input.stage === "HIRED") throw new BadRequestException("Use the Hire action to mark an application hired.");
      data.stage = input.stage;
    }
    if (input.rating !== undefined) data.rating = input.rating;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.rejectedReason !== undefined) data.rejectedReason = input.rejectedReason;
    return this.prisma.application.update({ where: { id }, data });
  }

  // ---- Interviews ----
  async addInterview(applicationId: string, input: { round: string; scheduledAt?: string; interviewer?: string; mode?: string }) {
    const ctx = requireTenantContext();
    const app = await this.prisma.application.findFirst({ where: { id: applicationId, orgId: ctx.orgId }, select: { id: true, stage: true } });
    if (!app) throw new NotFoundException("Application not found.");
    const interview = await this.prisma.interview.create({ data: { orgId: ctx.orgId, applicationId, round: input.round, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null, interviewer: input.interviewer ?? null, mode: input.mode ?? null } });
    // Advance to INTERVIEW stage on first schedule.
    if (app.stage === "APPLIED" || app.stage === "SCREENING") await this.prisma.application.update({ where: { id: applicationId }, data: { stage: "INTERVIEW" } });
    return interview;
  }

  async updateInterview(id: string, input: { outcome?: string; rating?: number | null; feedback?: string | null; scheduledAt?: string | null; interviewer?: string | null; round?: string; mode?: string | null }) {
    const ctx = requireTenantContext();
    const i = await this.prisma.interview.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!i) throw new NotFoundException("Interview not found.");
    const data: Record<string, unknown> = {};
    for (const k of ["outcome", "rating", "feedback", "interviewer", "round", "mode"]) if (input[k as keyof typeof input] !== undefined) data[k] = input[k as keyof typeof input];
    if (input.scheduledAt !== undefined) data.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    return this.prisma.interview.update({ where: { id }, data });
  }

  // ---- Offers ----
  async addOffer(applicationId: string, input: { title?: string; salary?: string; joiningDate?: string; note?: string }) {
    const ctx = requireTenantContext();
    const app = await this.prisma.application.findFirst({ where: { id: applicationId, orgId: ctx.orgId }, select: { id: true } });
    if (!app) throw new NotFoundException("Application not found.");
    const offer = await this.prisma.offer.create({ data: { orgId: ctx.orgId, applicationId, title: input.title ?? null, salary: input.salary ?? null, joiningDate: input.joiningDate ? new Date(input.joiningDate) : null, note: input.note ?? null, status: "DRAFT" } });
    await this.prisma.application.update({ where: { id: applicationId }, data: { stage: "OFFER" } });
    return offer;
  }

  async updateOffer(id: string, input: { status?: string; salary?: string | null; joiningDate?: string | null; title?: string | null; note?: string | null }) {
    const ctx = requireTenantContext();
    const o = await this.prisma.offer.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!o) throw new NotFoundException("Offer not found.");
    const data: Record<string, unknown> = {};
    for (const k of ["salary", "title", "note"]) if (input[k as keyof typeof input] !== undefined) data[k] = input[k as keyof typeof input];
    if (input.joiningDate !== undefined) data.joiningDate = input.joiningDate ? new Date(input.joiningDate) : null;
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === "SENT") data.sentAt = new Date();
      if (input.status === "ACCEPTED" || input.status === "DECLINED" || input.status === "WITHDRAWN") data.decidedAt = new Date();
    }
    return this.prisma.offer.update({ where: { id }, data });
  }

  // ---- Hire → create employee ----
  async hire(applicationId: string, input: { employeeCode?: string; joinedAt?: string; departmentId?: string; designationId?: string; teamId?: string }) {
    const ctx = requireTenantContext();
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, orgId: ctx.orgId },
      include: { candidate: true, requisition: { select: { id: true, departmentId: true, designationId: true, title: true, openings: true } } },
    });
    if (!app) throw new NotFoundException("Application not found.");
    if (app.stage === "HIRED" || app.hiredEmployeeId) throw new ConflictException("This candidate has already been hired.");
    if (app.stage === "REJECTED") throw new ConflictException("A rejected application cannot be hired.");

    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          orgId: ctx.orgId,
          firstName: app.candidate.firstName,
          lastName: app.candidate.lastName,
          email: app.candidate.email,
          employeeCode: input.employeeCode ?? null,
          phone: app.candidate.phone,
          title: app.requisition.title,
          departmentId: input.departmentId ?? app.requisition.departmentId ?? null,
          designationId: input.designationId ?? app.requisition.designationId ?? null,
          teamId: input.teamId ?? null,
          joinedAt: input.joinedAt ? new Date(input.joinedAt) : new Date(),
          lifecycleStage: "ONBOARDING",
          status: "ACTIVE",
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        },
      });
      await tx.employmentEvent.create({ data: { orgId: ctx.orgId, employeeId: employee.id, type: "JOINED", title: `Hired for ${app.requisition.title}`, createdBy: ctx.userId } });
      await tx.application.update({ where: { id: applicationId }, data: { stage: "HIRED", hiredEmployeeId: employee.id } });

      // Close the requisition if all openings are filled.
      const hiredCount = await tx.application.count({ where: { orgId: ctx.orgId, requisitionId: app.requisition.id, stage: "HIRED" } });
      if (hiredCount >= app.requisition.openings) await tx.requisition.update({ where: { id: app.requisition.id }, data: { status: "FILLED" } });

      return { employeeId: employee.id, applicationId };
    });
  }
}
