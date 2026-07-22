import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../context/request-context.store.js";
import { AccessScopeService } from "../access-scope/access-scope.service.js";
import { PrismaService } from "../database/prisma.service.js";

/**
 * Decides who may approve whose leave/timesheet.
 *
 * Reach combines the reporting line with the approver's granted scope:
 *   - Owner                → anyone;
 *   - department/team-scoped attendance.approve → everyone in those
 *     departments/teams (an HR manager signs off for all of HR);
 *   - otherwise            → their own direct reports (Employee.managerId).
 *
 * attendance.approve is still required at the route — this narrows WHOM an
 * approver can act on, so a manager can't sign off on another department's people.
 * Nobody may approve their own request.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
  ) {}

  /** The caller's own employee id, or a clear error if their login isn't linked to one. */
  async callerEmployeeId(): Promise<string> {
    const ctx = requireTenantContext();
    const m = await this.prisma.organizationMembership.findUnique({ where: { id: ctx.membershipId }, select: { employeeId: true } });
    if (!m?.employeeId) throw new BadRequestException("Your account is not linked to an employee record.");
    return m.employeeId;
  }

  private isOwner(): boolean {
    return requireTenantContext().role === "Owner";
  }

  /**
   * Does someone hold a department/team-scoped attendance.approve grant covering
   * this employee? Approving is a manager's job; the Owner oversees. So the Owner
   * steps back wherever a manager is in place, and remains the approver only for
   * people nobody manages — otherwise their requests would have nowhere to go.
   */
  private async hasScopedApprover(subjectEmployeeId: string): Promise<boolean> {
    const ctx = requireTenantContext();
    const subject = await this.prisma.employee.findFirst({
      where: { id: subjectEmployeeId, orgId: ctx.orgId },
      select: { departmentId: true, teamId: true, managerId: true },
    });
    if (!subject) return false;

    // An assigned reporting manager already covers them.
    if (subject.managerId) return true;

    const scopeIds = [subject.departmentId, subject.teamId].filter((x): x is string => Boolean(x));
    if (scopeIds.length === 0) return false;

    const grant = await this.prisma.roleAssignment.findFirst({
      where: {
        orgId: ctx.orgId,
        status: "ACTIVE",
        scopeType: { in: ["DEPARTMENT", "TEAM"] },
        scopeId: { in: scopeIds },
        role: { permissions: { has: permissions.attendanceApprove } },
      },
      select: { id: true },
    });
    return grant !== null;
  }

  /**
   * May the caller approve a request submitted by `subjectEmployeeId`?
   *
   *   Owner            → only where nobody manages the person (fallback).
   *   Scoped manager   → everyone in their departments/teams.
   *   Assigned manager → their own direct reports.
   *
   * A caller can never approve their own request, whatever their role.
   */
  async canApprove(subjectEmployeeId: string): Promise<boolean> {
    const approverEmployeeId = await this.callerEmployeeId();
    if (approverEmployeeId === subjectEmployeeId) return false; // no self-approval
    if (this.isOwner()) return !(await this.hasScopedApprover(subjectEmployeeId));

    const reach = await this.approvableEmployeeIds();
    return reach === null || reach.includes(subjectEmployeeId);
  }

  /** Same as canApprove, but throws a 403 with a reason instead of returning false. */
  async assertCanApprove(subjectEmployeeId: string): Promise<void> {
    if (await this.canApprove(subjectEmployeeId)) return;
    throw new ForbiddenException(
      this.isOwner()
        ? "This person's manager handles their requests. You can see them, but the decision is theirs."
        : "You can only approve requests from people in the teams you manage.",
    );
  }

  /**
   * The set of employees whose requests the caller may act on — used both by
   * canApprove and to scope the "pending approvals" lists to the approver's queue.
   *
   *   Owner                  → only people nobody else manages (see canApprove)
   *   Department/team-scoped → everyone in those depts/teams
   *                            (plus their own direct reports)
   *   Otherwise              → their direct reports only
   *
   * The caller's own id is always excluded — canApprove blocks self-approval, and
   * leaving it out keeps it off their pending queue too.
   */
  async approvableEmployeeIds(): Promise<string[] | null> {
    if (this.isOwner()) {
      // Keep the Owner's queue in step with what they can actually approve:
      // only the unmanaged. Otherwise they'd see requests that 403 on decide.
      // Resolved set-wise (two queries) rather than per-employee.
      const ctx = requireTenantContext();
      const ownEmployeeId = await this.callerEmployeeId().catch(() => null);
      const [candidates, grants] = await Promise.all([
        this.prisma.employee.findMany({
          where: { orgId: ctx.orgId, status: { in: ["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD"] } },
          select: { id: true, departmentId: true, teamId: true, managerId: true },
        }),
        this.prisma.roleAssignment.findMany({
          where: {
            orgId: ctx.orgId,
            status: "ACTIVE",
            scopeType: { in: ["DEPARTMENT", "TEAM"] },
            role: { permissions: { has: permissions.attendanceApprove } },
          },
          select: { scopeId: true },
        }),
      ]);
      const covered = new Set(grants.map((g) => g.scopeId).filter((x): x is string => Boolean(x)));
      return candidates
        .filter((c) => c.id !== ownEmployeeId)
        .filter((c) => !c.managerId && !covered.has(c.departmentId ?? "") && !covered.has(c.teamId ?? ""))
        .map((c) => c.id);
    }
    const ctx = requireTenantContext();
    const approverEmployeeId = await this.callerEmployeeId();

    const scope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, permissions.attendanceApprove);
    if (scope.tier === "org") return null; // org-wide approver

    if (scope.tier === "scoped") {
      // Everyone inside the granted departments/teams (employeeWhere also folds
      // in the approver's own record and direct reports).
      const rows = await this.prisma.employee.findMany({
        where: { orgId: ctx.orgId, ...this.accessScope.employeeWhere(scope) },
        select: { id: true },
      });
      return rows.map((r) => r.id).filter((id) => id !== approverEmployeeId);
    }

    // No scoped grant: fall back to the reporting line.
    const reports = await this.prisma.employee.findMany({
      where: { orgId: ctx.orgId, managerId: approverEmployeeId },
      select: { id: true },
    });
    return reports.map((r) => r.id);
  }
}
