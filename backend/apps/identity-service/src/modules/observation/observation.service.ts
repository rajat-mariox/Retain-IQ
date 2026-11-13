import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { ApprovalService } from "../../common/approval/approval.service.js";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type ObservationType = "PRODUCTIVITY_DROP" | "BURNOUT_RISK" | "LOW_ENGAGEMENT" | "ATTENDANCE_ANOMALY" | "LATE_PATTERN" | "BEHAVIOUR" | "OTHER";

export interface CreateFromAiInput {
  orgId: string;
  employeeId: string;
  type: ObservationType;
  severity: Severity;
  title: string;
  detail?: string;
  metric?: Record<string, unknown>;
  dedupeKey: string;
}
export interface CreateManualInput {
  employeeId: string;
  type: ObservationType;
  severity: Severity;
  title: string;
  detail?: string;
}

/**
 * Observation Management — the first stage of the Observation → Escalation →
 * Incident workflow. An observation is an AI-detected or manager-raised concern
 * about a person. It routes to the manager who owns that employee (via the same
 * reach engine that powers leave/attendance approvals), and moves through a
 * lifecycle (OPEN → ACKNOWLEDGED → RESOLVED/DISMISSED, or ESCALATED in P2). Every
 * transition is recorded on an immutable timeline and audit-logged.
 */
@Injectable()
export class ObservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly accessScope: AccessScopeService,
    private readonly approval: ApprovalService,
  ) {}

  /**
   * The login userId of the manager who owns an employee — where an observation
   * routes. Precedence: the employee's assigned reporting manager; else a
   * department/team-scoped attendance.approve holder; else null (the Owner picks
   * it up in their queue). Mirrors ApprovalService's routing.
   */
  private async ownerManagerUserId(orgId: string, employeeId: string): Promise<string | null> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { managerId: true, departmentId: true, teamId: true } });
    if (!emp) return null;
    if (emp.managerId) {
      const m = await this.prisma.organizationMembership.findFirst({ where: { orgId, employeeId: emp.managerId, status: "ACTIVE" }, select: { userId: true } });
      if (m?.userId) return m.userId;
    }
    const scopeIds = [emp.departmentId, emp.teamId].filter((x): x is string => Boolean(x));
    if (scopeIds.length > 0) {
      const grant = await this.prisma.roleAssignment.findFirst({
        where: { orgId, status: "ACTIVE", scopeType: { in: ["DEPARTMENT", "TEAM"] }, scopeId: { in: scopeIds }, role: { permissions: { has: permissions.attendanceApprove } } },
        select: { userId: true },
      });
      if (grant?.userId) return grant.userId;
    }
    return null;
  }

  /** Write an immutable timeline row for an observation. */
  private async addEvent(orgId: string, observationId: string, kind: string, actorUserId: string | null, note?: string) {
    await this.prisma.observationEvent.create({ data: { orgId, observationId, kind, actorUserId, note: note ?? null } });
  }

  /** Surface a resolution/closure on the org activity feed (fire-and-forget). */
  private recordActivity(orgId: string, actorUserId: string | null, type: string, summary: string) {
    void this.prisma.platformEvent.create({ data: { orgId, actorUserId, type, summary } }).catch(() => undefined);
  }

  /** Notify a specific user (the assigned manager / raiser) via the outbox → notifications. */
  private async emit(eventType: string, orgId: string, aggregateId: string, payload: Record<string, unknown>) {
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.enqueue(tx, { eventType, aggregateType: "observation", aggregateId, orgId, payload });
    });
  }

  /** Create an observation from an AI sweep. Idempotent on dedupeKey. */
  async createFromAi(input: CreateFromAiInput): Promise<{ id: string; created: boolean }> {
    const existing = await this.prisma.observation.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true } });
    if (existing) return { id: existing.id, created: false };

    const assignedTo = await this.ownerManagerUserId(input.orgId, input.employeeId);
    const employee = await this.prisma.employee.findFirst({ where: { id: input.employeeId, orgId: input.orgId }, select: { firstName: true, lastName: true } });

    let obs;
    try {
      obs = await this.prisma.observation.create({
        data: {
          orgId: input.orgId,
          employeeId: input.employeeId,
          source: "AI",
          type: input.type,
          severity: input.severity,
          title: input.title,
          detail: input.detail ?? null,
          metricJson: (input.metric as object) ?? undefined,
          assignedTo,
          dedupeKey: input.dedupeKey,
        },
        select: { id: true },
      });
    } catch {
      // A concurrent sweep won the unique(dedupeKey) race — treat as not-created.
      const race = await this.prisma.observation.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true } });
      if (race) return { id: race.id, created: false };
      throw new BadRequestException("Could not create the observation.");
    }

    await this.addEvent(input.orgId, obs.id, "CREATED", null, "Detected by AI monitoring");
    await this.notifyAssigned(input.orgId, obs.id, assignedTo, input.title, employee);
    return { id: obs.id, created: true };
  }

  /** Create an observation manually (a manager/HR raises a concern). */
  async createManual(input: CreateManualInput) {
    const ctx = requireTenantContext();
    // A manual observation must be about someone in the caller's reach.
    await this.assertEmployeeInReach(input.employeeId);
    const assignedTo = (await this.ownerManagerUserId(ctx.orgId, input.employeeId)) ?? ctx.userId;
    const employee = await this.prisma.employee.findFirst({ where: { id: input.employeeId, orgId: ctx.orgId }, select: { firstName: true, lastName: true } });

    const obs = await this.prisma.observation.create({
      data: {
        orgId: ctx.orgId,
        employeeId: input.employeeId,
        source: "MANUAL",
        type: input.type,
        severity: input.severity,
        title: input.title,
        detail: input.detail ?? null,
        assignedTo,
        createdBy: ctx.userId,
        dedupeKey: `manual:${ctx.orgId}:${input.employeeId}:${ctx.requestId}`,
      },
      select: { id: true },
    });
    await this.addEvent(ctx.orgId, obs.id, "CREATED", ctx.userId, "Raised manually");
    await this.audit.record({ orgId: ctx.orgId, action: "observation.created", resourceType: "observation", resourceId: obs.id, after: { employeeId: input.employeeId, type: input.type, severity: input.severity } });
    await this.notifyAssigned(ctx.orgId, obs.id, assignedTo, input.title, employee);
    return this.get(obs.id);
  }

  private async notifyAssigned(orgId: string, observationId: string, assignedTo: string | null, title: string, employee: { firstName: string; lastName: string } | null) {
    if (!assignedTo) return; // unrouted — surfaces in the Owner's org-wide queue instead
    await this.emit("observation.created", orgId, `obs:${observationId}`, {
      requesterUserId: assignedTo,
      title,
      employeeName: employee ? `${employee.firstName} ${employee.lastName}`.trim() : "an employee",
      observationId,
    });
  }

  // ---- Access ----

  /** The employees whose observations the caller may see/act on (null = whole org). */
  private async reach(): Promise<string[] | null> {
    const ctx = requireTenantContext();
    if (ctx.role === "Owner") return null; // Owner sees the whole org's observations
    const scope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, permissions.observationRead);
    if (scope.tier === "org") return null;
    const rows = await this.prisma.employee.findMany({ where: { orgId: ctx.orgId, ...this.accessScope.employeeWhere(scope) }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  private async assertEmployeeInReach(employeeId: string) {
    const reach = await this.reach();
    if (reach === null || reach.includes(employeeId)) return;
    throw new ForbiddenException("You can only raise observations for people in the teams you manage.");
  }

  private async loadInReach(id: string) {
    const ctx = requireTenantContext();
    const obs = await this.prisma.observation.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!obs) throw new NotFoundException("Observation not found.");
    const reach = await this.reach();
    if (reach !== null && !reach.includes(obs.employeeId)) throw new NotFoundException("Observation not found.");
    return obs;
  }

  // ---- Reads ----

  async list(filters: { status?: string; severity?: string; employeeId?: string; mine?: boolean }) {
    const ctx = requireTenantContext();
    const reach = await this.reach();
    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (reach !== null) where.employeeId = { in: reach.length > 0 ? reach : ["00000000-0000-0000-0000-000000000000"] };
    if (filters.status) where.status = filters.status;
    if (filters.severity) where.severity = filters.severity;
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.mine) where.assignedTo = ctx.userId;

    const rows = await this.prisma.observation.findMany({ where, orderBy: [{ createdAt: "desc" }], take: 500 });
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    const emps = await this.prisma.employee.findMany({ where: { orgId: ctx.orgId, id: { in: empIds } }, select: { id: true, firstName: true, lastName: true, departmentRef: { select: { name: true } } } });
    const byEmp = new Map(emps.map((e) => [e.id, e]));

    const rank = (s: string): number => ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 })[s] ?? 9;
    const openFirst = (s: string) => (s === "OPEN" ? 0 : s === "ACKNOWLEDGED" ? 1 : s === "ESCALATED" ? 2 : 3);
    const items = rows.map((r) => {
      const e = byEmp.get(r.employeeId);
      return {
        id: r.id,
        employeeId: r.employeeId,
        employeeName: e ? `${e.firstName} ${e.lastName}`.trim() : "—",
        department: e?.departmentRef?.name ?? null,
        source: r.source,
        type: r.type,
        severity: r.severity,
        status: r.status,
        title: r.title,
        assignedTo: r.assignedTo,
        createdAt: r.createdAt.toISOString(),
      };
    });
    // Most urgent first: open states, then severity, then newest.
    items.sort((a, b) => openFirst(a.status) - openFirst(b.status) || rank(a.severity) - rank(b.severity) || (a.createdAt < b.createdAt ? 1 : -1));

    const summary = {
      open: rows.filter((r) => r.status === "OPEN").length,
      acknowledged: rows.filter((r) => r.status === "ACKNOWLEDGED").length,
      escalated: rows.filter((r) => r.status === "ESCALATED").length,
      highOrCritical: rows.filter((r) => (r.severity === "HIGH" || r.severity === "CRITICAL") && r.status !== "RESOLVED" && r.status !== "DISMISSED").length,
      mine: rows.filter((r) => r.assignedTo === ctx.userId && r.status !== "RESOLVED" && r.status !== "DISMISSED").length,
    };
    return { summary, items };
  }

  async get(id: string) {
    const ctx = requireTenantContext();
    const obs = await this.loadInReach(id);
    const [employee, events, comments] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: obs.employeeId, orgId: ctx.orgId }, select: { id: true, firstName: true, lastName: true, departmentRef: { select: { name: true } } } }),
      this.prisma.observationEvent.findMany({ where: { observationId: id }, orderBy: { createdAt: "asc" } }),
      this.prisma.observationComment.findMany({ where: { observationId: id }, orderBy: { createdAt: "asc" } }),
    ]);
    return {
      id: obs.id,
      employeeId: obs.employeeId,
      employeeName: employee ? `${employee.firstName} ${employee.lastName}`.trim() : "—",
      department: employee?.departmentRef?.name ?? null,
      source: obs.source,
      type: obs.type,
      severity: obs.severity,
      status: obs.status,
      title: obs.title,
      detail: obs.detail,
      metric: obs.metricJson,
      assignedTo: obs.assignedTo,
      createdBy: obs.createdBy,
      acknowledgedAt: obs.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: obs.resolvedAt?.toISOString() ?? null,
      resolutionNote: obs.resolutionNote,
      createdAt: obs.createdAt.toISOString(),
      timeline: events.map((e) => ({ id: e.id, kind: e.kind, actorUserId: e.actorUserId, note: e.note, createdAt: e.createdAt.toISOString() })),
      comments: comments.map((c) => ({ id: c.id, authorUserId: c.authorUserId, body: c.body, createdAt: c.createdAt.toISOString() })),
    };
  }

  // ---- Transitions ----

  async acknowledge(id: string, note?: string) {
    const ctx = requireTenantContext();
    const obs = await this.loadInReach(id);
    if (obs.status !== "OPEN") throw new BadRequestException("Only an open observation can be acknowledged.");
    await this.prisma.observation.update({ where: { id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() } });
    await this.addEvent(ctx.orgId, id, "ACKNOWLEDGED", ctx.userId, note);
    await this.audit.record({ orgId: ctx.orgId, action: "observation.acknowledged", resourceType: "observation", resourceId: id });
    return this.get(id);
  }

  async resolve(id: string, note: string) {
    const ctx = requireTenantContext();
    const obs = await this.loadInReach(id);
    if (obs.status === "RESOLVED" || obs.status === "DISMISSED") throw new BadRequestException("This observation is already closed.");
    await this.prisma.observation.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolutionNote: note } });
    await this.addEvent(ctx.orgId, id, "RESOLVED", ctx.userId, note);
    await this.audit.record({ orgId: ctx.orgId, action: "observation.resolved", resourceType: "observation", resourceId: id });
    this.recordActivity(ctx.orgId, ctx.userId, "observation.resolved", `Observation resolved: ${obs.title}`);
    await this.emit("observation.resolved", ctx.orgId, `obs:${id}:resolved`, { requesterUserId: obs.createdBy ?? obs.assignedTo, observationId: id, title: obs.title });
    return this.get(id);
  }

  async dismiss(id: string, note: string) {
    const ctx = requireTenantContext();
    const obs = await this.loadInReach(id);
    if (obs.status === "RESOLVED" || obs.status === "DISMISSED") throw new BadRequestException("This observation is already closed.");
    await this.prisma.observation.update({ where: { id }, data: { status: "DISMISSED", resolvedAt: new Date(), resolutionNote: note } });
    await this.addEvent(ctx.orgId, id, "DISMISSED", ctx.userId, note);
    await this.audit.record({ orgId: ctx.orgId, action: "observation.dismissed", resourceType: "observation", resourceId: id });
    this.recordActivity(ctx.orgId, ctx.userId, "observation.dismissed", `Observation dismissed: ${obs.title}`);
    return this.get(id);
  }

  async comment(id: string, body: string) {
    const ctx = requireTenantContext();
    await this.loadInReach(id);
    await this.prisma.observationComment.create({ data: { orgId: ctx.orgId, observationId: id, authorUserId: ctx.userId, body } });
    await this.addEvent(ctx.orgId, id, "COMMENTED", ctx.userId);
    return this.get(id);
  }
}
