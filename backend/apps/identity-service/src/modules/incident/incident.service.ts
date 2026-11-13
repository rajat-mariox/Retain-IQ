import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AuditService } from "../../common/audit/audit.service.js";

type Category = "ATTENDANCE" | "PRODUCTIVITY" | "BEHAVIOUR" | "SECURITY" | "COMPLIANCE";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface OpenManualInput {
  employeeId?: string | null;
  category: Category;
  severity: Severity;
  title: string;
  summary?: string;
}

/**
 * Incident Management (stage 3) — a standalone module, separate from Observation.
 * A formal, investigable case with a human reference (INC-YYYY-NNNN). Opened by
 * promoting a serious Escalation, or manually by HR. Gated by incident.manage.
 * Own lifecycle: OPEN → INVESTIGATING → RESOLVED → CLOSED.
 */
@Injectable()
export class IncidentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /** Next per-org reference: INC-YYYY-NNNN, zero-padded, sequential within the year. */
  private async nextReference(orgId: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `INC-${year}-`;
    const last = await this.prisma.incident.findFirst({
      where: { orgId, reference: { startsWith: prefix } },
      orderBy: { reference: "desc" },
      select: { reference: true },
    });
    const n = last ? Number(last.reference.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(n).padStart(4, "0")}`;
  }

  private async addEvent(orgId: string, incidentId: string, kind: string, actorUserId: string | null, note?: string) {
    await this.prisma.incidentEvent.create({ data: { orgId, incidentId, kind, actorUserId, note: note ?? null } });
  }

  /** Surface a resolution/closure on the org activity feed (fire-and-forget). */
  private recordActivity(orgId: string, actorUserId: string | null, type: string, summary: string) {
    void this.prisma.platformEvent.create({ data: { orgId, actorUserId, type, summary } }).catch(() => undefined);
  }

  private async emit(eventType: string, orgId: string, aggregateId: string, payload: Record<string, unknown>) {
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.enqueue(tx, { eventType, aggregateType: "incident", aggregateId, orgId, payload });
    });
  }

  /** An HR/incident authority (login userId) to assign the investigation to. */
  private async investigatorUserId(orgId: string): Promise<string | null> {
    const inc = await this.prisma.roleAssignment.findFirst({ where: { orgId, status: "ACTIVE", role: { permissions: { has: permissions.incidentManage } } }, select: { userId: true } });
    if (inc?.userId) return inc.userId;
    const owner = await this.prisma.organizationMembership.findFirst({ where: { orgId, status: "ACTIVE", role: { name: "Owner" } }, select: { userId: true } });
    return owner?.userId ?? null;
  }

  // ---- Open ----

  /** Promote an escalation into a formal incident (links the chain back). */
  async openFromEscalation(escalationId: string, category: Category, summary?: string) {
    const ctx = requireTenantContext();
    const esc = await this.prisma.escalation.findFirst({ where: { id: escalationId, orgId: ctx.orgId }, include: { observation: { select: { title: true, severity: true } } } });
    if (!esc) throw new NotFoundException("Escalation not found.");
    if (esc.status === "PROMOTED") throw new BadRequestException("This escalation was already promoted to an incident.");
    const existing = await this.prisma.incident.findFirst({ where: { orgId: ctx.orgId, escalationId }, select: { id: true } });
    if (existing) throw new BadRequestException("An incident already exists for this escalation.");

    const reference = await this.nextReference(ctx.orgId);
    const assignedTo = await this.investigatorUserId(ctx.orgId);
    const incident = await this.prisma.incident.create({
      data: {
        orgId: ctx.orgId,
        reference,
        employeeId: esc.employeeId,
        escalationId,
        category,
        severity: esc.severity,
        title: esc.observation.title,
        summary: summary ?? esc.reason ?? null,
        assignedTo,
        openedBy: ctx.userId,
      },
      select: { id: true },
    });
    await this.prisma.escalation.update({ where: { id: escalationId }, data: { status: "PROMOTED" } });
    await this.prisma.escalationEvent.create({ data: { orgId: ctx.orgId, escalationId, kind: "PROMOTED", level: esc.level, actorUserId: ctx.userId, note: `Promoted to incident ${reference}` } });
    await this.addEvent(ctx.orgId, incident.id, "OPENED", ctx.userId, `Promoted from escalation (${reference})`);
    await this.audit.record({ orgId: ctx.orgId, action: "incident.opened", resourceType: "incident", resourceId: incident.id, after: { reference, escalationId, category } });
    await this.notifyOpened(ctx.orgId, incident.id, assignedTo, reference, esc.observation.title, esc.severity as Severity);
    return this.get(incident.id);
  }

  /** Open an incident manually (HR raises a formal case). */
  async openManual(input: OpenManualInput) {
    const ctx = requireTenantContext();
    const reference = await this.nextReference(ctx.orgId);
    const assignedTo = await this.investigatorUserId(ctx.orgId);
    const incident = await this.prisma.incident.create({
      data: {
        orgId: ctx.orgId,
        reference,
        employeeId: input.employeeId ?? null,
        category: input.category,
        severity: input.severity,
        title: input.title,
        summary: input.summary ?? null,
        assignedTo,
        openedBy: ctx.userId,
      },
      select: { id: true },
    });
    await this.addEvent(ctx.orgId, incident.id, "OPENED", ctx.userId, "Opened manually");
    await this.audit.record({ orgId: ctx.orgId, action: "incident.opened", resourceType: "incident", resourceId: incident.id, after: { reference, category: input.category } });
    await this.notifyOpened(ctx.orgId, incident.id, assignedTo, reference, input.title, input.severity);
    return this.get(incident.id);
  }

  private async notifyOpened(orgId: string, incidentId: string, assignedTo: string | null, reference: string, title: string, severity: Severity) {
    if (assignedTo) {
      await this.emit("incident.opened", orgId, `inc:${incidentId}`, { requesterUserId: assignedTo, reference, title, severity, incidentId });
    }
  }

  // ---- Reads ----

  async list(filters: { status?: string; category?: string; mine?: boolean }) {
    const ctx = requireTenantContext();
    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.mine) where.assignedTo = ctx.userId;

    const rows = await this.prisma.incident.findMany({ where, orderBy: [{ createdAt: "desc" }], take: 500 });
    const empIds = [...new Set(rows.map((r) => r.employeeId).filter((x): x is string => Boolean(x)))];
    const emps = empIds.length > 0 ? await this.prisma.employee.findMany({ where: { orgId: ctx.orgId, id: { in: empIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
    const byEmp = new Map(emps.map((e) => [e.id, e]));

    const items = rows.map((r) => {
      const e = r.employeeId ? byEmp.get(r.employeeId) : null;
      return {
        id: r.id,
        reference: r.reference,
        employeeName: e ? `${e.firstName} ${e.lastName}`.trim() : null,
        category: r.category,
        severity: r.severity,
        status: r.status,
        title: r.title,
        fromEscalation: Boolean(r.escalationId),
        createdAt: r.createdAt.toISOString(),
      };
    });
    const summary = {
      open: rows.filter((r) => r.status === "OPEN").length,
      investigating: rows.filter((r) => r.status === "INVESTIGATING").length,
      resolved: rows.filter((r) => r.status === "RESOLVED").length,
      mine: rows.filter((r) => r.assignedTo === ctx.userId && r.status !== "CLOSED").length,
    };
    return { summary, items };
  }

  async get(id: string) {
    const ctx = requireTenantContext();
    const inc = await this.prisma.incident.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!inc) throw new NotFoundException("Incident not found.");
    const [employee, events, comments] = await Promise.all([
      inc.employeeId ? this.prisma.employee.findFirst({ where: { id: inc.employeeId, orgId: ctx.orgId }, select: { firstName: true, lastName: true, departmentRef: { select: { name: true } } } }) : Promise.resolve(null),
      this.prisma.incidentEvent.findMany({ where: { incidentId: id }, orderBy: { createdAt: "asc" } }),
      this.prisma.incidentComment.findMany({ where: { incidentId: id }, orderBy: { createdAt: "asc" } }),
    ]);
    return {
      id: inc.id,
      reference: inc.reference,
      employeeId: inc.employeeId,
      employeeName: employee ? `${employee.firstName} ${employee.lastName}`.trim() : null,
      department: employee?.departmentRef?.name ?? null,
      escalationId: inc.escalationId,
      category: inc.category,
      severity: inc.severity,
      status: inc.status,
      title: inc.title,
      summary: inc.summary,
      assignedTo: inc.assignedTo,
      investigationNote: inc.investigationNote,
      resolutionNote: inc.resolutionNote,
      resolvedAt: inc.resolvedAt?.toISOString() ?? null,
      closedAt: inc.closedAt?.toISOString() ?? null,
      createdAt: inc.createdAt.toISOString(),
      timeline: events.map((e) => ({ id: e.id, kind: e.kind, actorUserId: e.actorUserId, note: e.note, createdAt: e.createdAt.toISOString() })),
      comments: comments.map((c) => ({ id: c.id, authorUserId: c.authorUserId, body: c.body, createdAt: c.createdAt.toISOString() })),
    };
  }

  // ---- Transitions ----

  private async load(id: string) {
    const ctx = requireTenantContext();
    const inc = await this.prisma.incident.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!inc) throw new NotFoundException("Incident not found.");
    return inc;
  }

  async startInvestigation(id: string, note?: string) {
    const ctx = requireTenantContext();
    const inc = await this.load(id);
    if (inc.status !== "OPEN") throw new BadRequestException("Only an open incident can move to investigating.");
    await this.prisma.incident.update({ where: { id }, data: { status: "INVESTIGATING", investigationNote: note ?? inc.investigationNote } });
    await this.addEvent(ctx.orgId, id, "INVESTIGATING", ctx.userId, note);
    await this.audit.record({ orgId: ctx.orgId, action: "incident.investigating", resourceType: "incident", resourceId: id });
    return this.get(id);
  }

  async resolve(id: string, note: string) {
    const ctx = requireTenantContext();
    const inc = await this.load(id);
    if (inc.status === "RESOLVED" || inc.status === "CLOSED") throw new BadRequestException("This incident is already resolved.");
    await this.prisma.incident.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolutionNote: note } });
    await this.addEvent(ctx.orgId, id, "RESOLVED", ctx.userId, note);
    await this.audit.record({ orgId: ctx.orgId, action: "incident.resolved", resourceType: "incident", resourceId: id });
    this.recordActivity(ctx.orgId, ctx.userId, "incident.resolved", `Incident ${inc.reference} resolved: ${inc.title}`);
    await this.emit("incident.resolved", ctx.orgId, `inc:${id}:resolved`, { requesterUserId: inc.openedBy ?? inc.assignedTo, reference: inc.reference, title: inc.title });
    return this.get(id);
  }

  async close(id: string, note?: string) {
    const ctx = requireTenantContext();
    const inc = await this.load(id);
    if (inc.status === "CLOSED") throw new BadRequestException("This incident is already closed.");
    if (inc.status !== "RESOLVED") throw new BadRequestException("Resolve the incident before closing it.");
    await this.prisma.incident.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
    await this.addEvent(ctx.orgId, id, "CLOSED", ctx.userId, note);
    await this.audit.record({ orgId: ctx.orgId, action: "incident.closed", resourceType: "incident", resourceId: id });
    this.recordActivity(ctx.orgId, ctx.userId, "incident.closed", `Incident ${inc.reference} closed: ${inc.title}`);
    return this.get(id);
  }

  async comment(id: string, body: string) {
    const ctx = requireTenantContext();
    await this.load(id);
    await this.prisma.incidentComment.create({ data: { orgId: ctx.orgId, incidentId: id, authorUserId: ctx.userId, body } });
    await this.addEvent(ctx.orgId, id, "COMMENTED", ctx.userId);
    return this.get(id);
  }
}
