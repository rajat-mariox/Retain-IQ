import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * Escalation matrix — per severity, the level to START at and the SLA (hours) for
 * each level before it auto-bumps to the next. maxLevel caps the ladder. LOW never
 * auto-escalates (slaHours undefined). CRITICAL starts at the dept-head level and
 * notifies the Owner immediately.
 */
const MATRIX: Record<Severity, { startLevel: number; maxLevel: number; slaHours: Record<number, number | undefined> }> = {
  LOW: { startLevel: 1, maxLevel: 2, slaHours: { 1: undefined, 2: undefined } },
  MEDIUM: { startLevel: 1, maxLevel: 3, slaHours: { 1: 72, 2: 72, 3: undefined } },
  HIGH: { startLevel: 1, maxLevel: 3, slaHours: { 1: 24, 2: 24, 3: undefined } },
  CRITICAL: { startLevel: 2, maxLevel: 3, slaHours: { 2: 4, 3: undefined } },
};

const LEVEL_LABEL: Record<number, string> = { 1: "Manager", 2: "Department head", 3: "HR / Owner" };

/**
 * Escalation flow (stage 2). Takes an observation up a severity-driven authority
 * ladder with per-level SLAs. Managers escalate manually; a cron auto-bumps
 * anything past its SLA. Level → authority reuses the reporting line and the
 * role-grant reach, so an escalation always lands on a real person.
 */
@Injectable()
export class EscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly accessScope: AccessScopeService,
  ) {}

  private dueAtFor(severity: Severity, level: number): Date | null {
    const hours = MATRIX[severity].slaHours[level];
    return hours ? new Date(Date.now() + hours * 3600 * 1000) : null;
  }

  /**
   * The login userId of the authority at a given level for an employee.
   *   L1 → the employee's reporting manager.
   *   L2 → that manager's own manager (dept head), else a DEPARTMENT-scoped
   *        observation.manage holder for the employee's department.
   *   L3 → an incident.manage holder (HR), else the org Owner.
   */
  private async authorityFor(orgId: string, employeeId: string, level: number): Promise<string | null> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { managerId: true, departmentId: true, teamId: true } });
    if (!emp) return null;

    const userIdOfEmployee = async (empId: string | null): Promise<string | null> => {
      if (!empId) return null;
      const m = await this.prisma.organizationMembership.findFirst({ where: { orgId, employeeId: empId, status: "ACTIVE" }, select: { userId: true } });
      return m?.userId ?? null;
    };

    if (level <= 1) return userIdOfEmployee(emp.managerId);

    if (level === 2) {
      // The manager's manager (a real dept head in the reporting line).
      if (emp.managerId) {
        const mgr = await this.prisma.employee.findFirst({ where: { id: emp.managerId, orgId }, select: { managerId: true } });
        const up = await userIdOfEmployee(mgr?.managerId ?? null);
        if (up) return up;
      }
      // Else a department/team-scoped observation.manage grant.
      const scopeIds = [emp.departmentId, emp.teamId].filter((x): x is string => Boolean(x));
      if (scopeIds.length > 0) {
        const grant = await this.prisma.roleAssignment.findFirst({
          where: { orgId, status: "ACTIVE", scopeType: { in: ["DEPARTMENT", "TEAM"] }, scopeId: { in: scopeIds }, role: { permissions: { has: permissions.observationManage } } },
          select: { userId: true },
        });
        if (grant?.userId) return grant.userId;
      }
    }

    // Level 3 (or fallthrough): an incident.manage holder, else the Owner.
    const inc = await this.prisma.roleAssignment.findFirst({
      where: { orgId, status: "ACTIVE", role: { permissions: { has: permissions.incidentManage } } },
      select: { userId: true },
    });
    if (inc?.userId) return inc.userId;
    const owner = await this.prisma.organizationMembership.findFirst({ where: { orgId, status: "ACTIVE", role: { name: "Owner" } }, select: { userId: true } });
    return owner?.userId ?? null;
  }

  private async addEvent(orgId: string, escalationId: string, kind: string, level: number | null, actorUserId: string | null, note?: string) {
    await this.prisma.escalationEvent.create({ data: { orgId, escalationId, kind, level, actorUserId, note: note ?? null } });
  }

  /** Surface a resolution on the org activity feed (fire-and-forget). */
  private recordActivity(orgId: string, actorUserId: string | null, type: string, summary: string) {
    void this.prisma.platformEvent.create({ data: { orgId, actorUserId, type, summary } }).catch(() => undefined);
  }

  private async emit(eventType: string, orgId: string, aggregateId: string, payload: Record<string, unknown>) {
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.enqueue(tx, { eventType, aggregateType: "escalation", aggregateId, orgId, payload });
    });
  }

  // ---- Access (mirrors ObservationService.reach) ----

  private async reach(): Promise<string[] | null> {
    const ctx = requireTenantContext();
    if (ctx.role === "Owner") return null;
    const scope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, permissions.observationRead);
    if (scope.tier === "org") return null;
    const rows = await this.prisma.employee.findMany({ where: { orgId: ctx.orgId, ...this.accessScope.employeeWhere(scope) }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  private async loadInReach(id: string) {
    const ctx = requireTenantContext();
    const esc = await this.prisma.escalation.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!esc) throw new NotFoundException("Escalation not found.");
    const reach = await this.reach();
    if (reach !== null && !reach.includes(esc.employeeId)) throw new NotFoundException("Escalation not found.");
    return esc;
  }

  // ---- Escalate (from the observation detail) ----

  async escalate(observationId: string, reason?: string) {
    const ctx = requireTenantContext();
    const obs = await this.prisma.observation.findFirst({ where: { id: observationId, orgId: ctx.orgId } });
    if (!obs) throw new NotFoundException("Observation not found.");
    // Reach check: only manage people you own.
    const reach = await this.reach();
    if (reach !== null && !reach.includes(obs.employeeId)) throw new ForbiddenException("You can only escalate observations for people you manage.");
    if (obs.status === "RESOLVED" || obs.status === "DISMISSED") throw new BadRequestException("This observation is already closed.");
    const existing = await this.prisma.escalation.findUnique({ where: { observationId }, select: { id: true } });
    if (existing) throw new BadRequestException("This observation is already escalated.");

    const severity = obs.severity as Severity;
    const level = MATRIX[severity].startLevel;
    const assignedTo = await this.authorityFor(ctx.orgId, obs.employeeId, level);
    const dueAt = this.dueAtFor(severity, level);

    const esc = await this.prisma.escalation.create({
      data: { orgId: ctx.orgId, observationId, employeeId: obs.employeeId, severity: obs.severity, level, status: "PENDING", escalatedBy: ctx.userId, assignedTo, reason: reason ?? null, dueAt },
      select: { id: true },
    });
    await this.prisma.observation.update({ where: { id: observationId }, data: { status: "ESCALATED" } });
    await this.prisma.observationEvent.create({ data: { orgId: ctx.orgId, observationId, kind: "ESCALATED", actorUserId: ctx.userId, note: reason ?? `Escalated to ${LEVEL_LABEL[level] ?? `level ${level}`}` } });
    await this.addEvent(ctx.orgId, esc.id, "CREATED", level, ctx.userId, reason);
    await this.audit.record({ orgId: ctx.orgId, action: "escalation.created", resourceType: "escalation", resourceId: esc.id, after: { observationId, level, severity } });
    await this.notify(ctx.orgId, esc.id, assignedTo, obs.title, severity, level);
    return this.get(esc.id);
  }

  private async notify(orgId: string, escalationId: string, assignedTo: string | null, title: string, severity: Severity, level: number) {
    if (assignedTo) {
      await this.emit("escalation.created", orgId, `esc:${escalationId}:l${level}`, { requesterUserId: assignedTo, title, severity, level, levelLabel: LEVEL_LABEL[level] ?? `Level ${level}`, escalationId });
    }
    // CRITICAL always also pings the Owner.
    if (severity === "CRITICAL") {
      const owner = await this.prisma.organizationMembership.findFirst({ where: { orgId, status: "ACTIVE", role: { name: "Owner" } }, select: { userId: true } });
      if (owner?.userId && owner.userId !== assignedTo) {
        await this.emit("escalation.created", orgId, `esc:${escalationId}:owner`, { requesterUserId: owner.userId, title, severity, level, levelLabel: LEVEL_LABEL[level] ?? `Level ${level}`, escalationId });
      }
    }
  }

  // ---- Reads ----

  async list(filters: { status?: string; mine?: boolean; employeeId?: string }) {
    const ctx = requireTenantContext();
    const reach = await this.reach();
    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (reach !== null) where.employeeId = { in: reach.length > 0 ? reach : ["00000000-0000-0000-0000-000000000000"] };
    if (filters.status) where.status = filters.status;
    if (filters.mine) where.assignedTo = ctx.userId;
    if (filters.employeeId) where.employeeId = filters.employeeId;

    const rows = await this.prisma.escalation.findMany({ where, orderBy: [{ createdAt: "desc" }], take: 500, include: { observation: { select: { title: true, type: true } } } });
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    const emps = await this.prisma.employee.findMany({ where: { orgId: ctx.orgId, id: { in: empIds } }, select: { id: true, firstName: true, lastName: true } });
    const byEmp = new Map(emps.map((e) => [e.id, e]));

    const items = rows.map((r) => {
      const e = byEmp.get(r.employeeId);
      return {
        id: r.id,
        observationId: r.observationId,
        employeeName: e ? `${e.firstName} ${e.lastName}`.trim() : "—",
        title: r.observation.title,
        severity: r.severity,
        level: r.level,
        levelLabel: LEVEL_LABEL[r.level] ?? `Level ${r.level}`,
        status: r.status,
        dueAt: r.dueAt?.toISOString() ?? null,
        overdue: Boolean(r.dueAt && r.status === "PENDING" && r.dueAt.getTime() < Date.now()),
        createdAt: r.createdAt.toISOString(),
      };
    });
    const summary = {
      pending: rows.filter((r) => r.status === "PENDING").length,
      overdue: items.filter((i) => i.overdue).length,
      mine: rows.filter((r) => r.assignedTo === ctx.userId && r.status === "PENDING").length,
    };
    return { summary, items };
  }

  /**
   * Open observation + escalation counts grouped by department and by team — the
   * rollup surfaced on the department/team management pages. Reach-scoped, owners
   * excluded. Only OPEN/ACKNOWLEDGED observations and PENDING/ACKNOWLEDGED
   * escalations count (closed items don't need attention).
   */
  async rollupByGroup() {
    const ctx = requireTenantContext();
    const reach = await this.reach();
    const empWhere: Record<string, unknown> = { orgId: ctx.orgId };
    if (reach !== null) empWhere.id = { in: reach.length > 0 ? reach : ["00000000-0000-0000-0000-000000000000"] };

    // Map each in-reach employee to its department/team.
    const employees = await this.prisma.employee.findMany({ where: empWhere, select: { id: true, departmentId: true, teamId: true } });
    const empDept = new Map(employees.map((e) => [e.id, e.departmentId]));
    const empTeam = new Map(employees.map((e) => [e.id, e.teamId]));
    const empIds = employees.map((e) => e.id);
    if (empIds.length === 0) return { departments: [], teams: [] };

    const [openObs, openEsc] = await Promise.all([
      this.prisma.observation.findMany({ where: { orgId: ctx.orgId, employeeId: { in: empIds }, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, select: { employeeId: true } }),
      this.prisma.escalation.findMany({ where: { orgId: ctx.orgId, employeeId: { in: empIds }, status: { in: ["PENDING", "ACKNOWLEDGED"] } }, select: { employeeId: true, dueAt: true, status: true } }),
    ]);

    type Bucket = { observations: number; escalations: number; overdue: number };
    const deptBuckets = new Map<string, Bucket>();
    const teamBuckets = new Map<string, Bucket>();
    const bump = (m: Map<string, Bucket>, key: string | null, field: keyof Bucket) => {
      if (!key) return;
      const b = m.get(key) ?? { observations: 0, escalations: 0, overdue: 0 };
      b[field] += 1;
      m.set(key, b);
    };
    for (const o of openObs) { bump(deptBuckets, empDept.get(o.employeeId) ?? null, "observations"); bump(teamBuckets, empTeam.get(o.employeeId) ?? null, "observations"); }
    for (const e of openEsc) {
      bump(deptBuckets, empDept.get(e.employeeId) ?? null, "escalations");
      bump(teamBuckets, empTeam.get(e.employeeId) ?? null, "escalations");
      if (e.dueAt && e.status === "PENDING" && e.dueAt.getTime() < Date.now()) {
        bump(deptBuckets, empDept.get(e.employeeId) ?? null, "overdue");
        bump(teamBuckets, empTeam.get(e.employeeId) ?? null, "overdue");
      }
    }

    const deptIds = [...deptBuckets.keys()];
    const teamIds = [...teamBuckets.keys()];
    const [depts, teams] = await Promise.all([
      deptIds.length ? this.prisma.department.findMany({ where: { orgId: ctx.orgId, id: { in: deptIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      teamIds.length ? this.prisma.team.findMany({ where: { orgId: ctx.orgId, id: { in: teamIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const deptName = new Map(depts.map((d) => [d.id, d.name]));
    const teamName = new Map(teams.map((t) => [t.id, t.name]));

    return {
      departments: deptIds.map((id) => ({ id, name: deptName.get(id) ?? "—", ...deptBuckets.get(id)! })).sort((a, b) => b.escalations - a.escalations || b.observations - a.observations),
      teams: teamIds.map((id) => ({ id, name: teamName.get(id) ?? "—", ...teamBuckets.get(id)! })).sort((a, b) => b.escalations - a.escalations || b.observations - a.observations),
    };
  }

  async get(id: string) {
    const ctx = requireTenantContext();
    const esc = await this.loadInReach(id);
    const [employee, events, observation] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: esc.employeeId, orgId: ctx.orgId }, select: { firstName: true, lastName: true, departmentRef: { select: { name: true } } } }),
      this.prisma.escalationEvent.findMany({ where: { escalationId: id }, orderBy: { createdAt: "asc" } }),
      this.prisma.observation.findFirst({ where: { id: esc.observationId, orgId: ctx.orgId }, select: { title: true, type: true, detail: true } }),
    ]);
    return {
      id: esc.id,
      observationId: esc.observationId,
      employeeName: employee ? `${employee.firstName} ${employee.lastName}`.trim() : "—",
      department: employee?.departmentRef?.name ?? null,
      title: observation?.title ?? "",
      type: observation?.type ?? null,
      detail: observation?.detail ?? null,
      severity: esc.severity,
      level: esc.level,
      levelLabel: LEVEL_LABEL[esc.level] ?? `Level ${esc.level}`,
      status: esc.status,
      assignedTo: esc.assignedTo,
      reason: esc.reason,
      dueAt: esc.dueAt?.toISOString() ?? null,
      overdue: Boolean(esc.dueAt && esc.status === "PENDING" && esc.dueAt.getTime() < Date.now()),
      resolvedAt: esc.resolvedAt?.toISOString() ?? null,
      resolutionNote: esc.resolutionNote,
      createdAt: esc.createdAt.toISOString(),
      maxLevel: MATRIX[esc.severity as Severity].maxLevel,
      timeline: events.map((e) => ({ id: e.id, kind: e.kind, level: e.level, actorUserId: e.actorUserId, note: e.note, createdAt: e.createdAt.toISOString() })),
    };
  }

  // ---- Transitions ----

  async acknowledge(id: string, note?: string) {
    const ctx = requireTenantContext();
    const esc = await this.loadInReach(id);
    if (esc.status !== "PENDING") throw new BadRequestException("Only a pending escalation can be acknowledged.");
    await this.prisma.escalation.update({ where: { id }, data: { status: "ACKNOWLEDGED" } });
    await this.addEvent(ctx.orgId, id, "ACKNOWLEDGED", esc.level, ctx.userId, note);
    await this.audit.record({ orgId: ctx.orgId, action: "escalation.acknowledged", resourceType: "escalation", resourceId: id });
    return this.get(id);
  }

  async resolve(id: string, note: string) {
    const ctx = requireTenantContext();
    const esc = await this.loadInReach(id);
    if (esc.status === "RESOLVED" || esc.status === "PROMOTED") throw new BadRequestException("This escalation is already closed.");
    await this.prisma.escalation.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolutionNote: note } });
    await this.addEvent(ctx.orgId, id, "RESOLVED", esc.level, ctx.userId, note);
    // Close the parent observation too — the concern was handled.
    await this.prisma.observation.update({ where: { id: esc.observationId }, data: { status: "RESOLVED", resolvedAt: new Date(), resolutionNote: note } }).catch(() => undefined);
    await this.prisma.observationEvent.create({ data: { orgId: ctx.orgId, observationId: esc.observationId, kind: "RESOLVED", actorUserId: ctx.userId, note: `Resolved via escalation: ${note}` } }).catch(() => undefined);
    await this.audit.record({ orgId: ctx.orgId, action: "escalation.resolved", resourceType: "escalation", resourceId: id });
    const obs = await this.prisma.observation.findFirst({ where: { id: esc.observationId, orgId: ctx.orgId }, select: { title: true } });
    this.recordActivity(ctx.orgId, ctx.userId, "escalation.resolved", `Escalation resolved: ${obs?.title ?? "case"}`);
    return this.get(id);
  }

  /** Manually bump to the next level (or the SLA sweep calls bumpOne). */
  async bump(id: string, note?: string) {
    const ctx = requireTenantContext();
    const esc = await this.loadInReach(id);
    return this.bumpInternal(esc, ctx.userId, note ?? "Escalated to the next level");
  }

  private async bumpInternal(esc: { id: string; orgId: string; observationId: string; employeeId: string; severity: string; level: number; status: string; assignedTo: string | null }, actorUserId: string | null, note: string) {
    if (esc.status !== "PENDING" && esc.status !== "ACKNOWLEDGED") throw new BadRequestException("Only an active escalation can be bumped.");
    const severity = esc.severity as Severity;
    const nextLevel = esc.level + 1;
    if (nextLevel > MATRIX[severity].maxLevel) throw new BadRequestException("Already at the top of the escalation ladder.");
    const assignedTo = await this.authorityFor(esc.orgId, esc.employeeId, nextLevel);
    const dueAt = this.dueAtFor(severity, nextLevel);
    await this.prisma.escalation.update({ where: { id: esc.id }, data: { level: nextLevel, status: "PENDING", assignedTo, dueAt } });
    await this.addEvent(esc.orgId, esc.id, "BUMPED", nextLevel, actorUserId, note);
    await this.audit.record({ orgId: esc.orgId, action: "escalation.bumped", resourceType: "escalation", resourceId: esc.id, after: { level: nextLevel } });
    const obs = await this.prisma.observation.findFirst({ where: { id: esc.observationId, orgId: esc.orgId }, select: { title: true } });
    await this.notify(esc.orgId, esc.id, assignedTo, obs?.title ?? "Escalation", severity, nextLevel);
    return this.get(esc.id);
  }
}
