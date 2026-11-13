import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { hashPassword } from "../../common/crypto/password.util.js";
import { generateTempPassword } from "../../common/crypto/temp-password.util.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { logger } from "../../common/observability/observability.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { SeatLimitService } from "../../common/seat-limit/seat-limit.service.js";
import { ensureSystemRoles } from "../../common/security/roles.util.js";
import type { AddMemberInput } from "./dto.js";

@Injectable()
export class MembersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seatLimit: SeatLimitService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Re-project every active membership on boot.
   *
   * Downstream read models (notifications' OrgRecipient) are built purely from
   * `org.member.upserted`. Members created before that event existed — or while
   * a consumer was down — would otherwise never appear, silently breaking
   * role-based audiences like "approvers". The downstream upsert is idempotent,
   * so replaying is safe and self-healing.
   */
  async onModuleInit(): Promise<void> {
    try {
      const memberships = await this.prisma.organizationMembership.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          orgId: true,
          userId: true,
          status: true,
          user: { select: { email: true } },
          role: { select: { name: true } },
          employee: { select: { firstName: true, lastName: true } },
        },
      });
      if (memberships.length === 0) return;

      await this.prisma.$transaction(async (tx) => {
        for (const m of memberships) {
          await this.outbox.enqueue(tx, {
            eventType: "org.member.upserted",
            aggregateType: "organizationMembership",
            aggregateId: m.id,
            orgId: m.orgId,
            payload: {
              orgId: m.orgId,
              userId: m.userId,
              roleName: m.role?.name ?? "Employee",
              status: m.status,
              email: m.user?.email ?? null,
              name: m.employee ? `${m.employee.firstName} ${m.employee.lastName}`.trim() : null,
            },
          });
        }
      });
      logger.info({ count: memberships.length }, "re-projected org memberships to read models");
    } catch (error) {
      // Never block startup on a projection refresh.
      logger.warn({ err: String(error) }, "membership re-projection on boot failed");
    }
  }

  /** Adds an employee + a login account with a temporary password (first-login change). */
  async addMember(input: AddMemberInput) {
    const ctx = requireTenantContext();
    const email = input.email.toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException("A user with this email already exists.");
    }

    // Validate department (if given) belongs to the org.
    if (input.departmentId) {
      const dept = await this.prisma.department.findFirst({ where: { id: input.departmentId, orgId: ctx.orgId } });
      if (!dept) throw new NotFoundException("Department not found.");
    }

    // Resolve the base-role grant scope. DEPARTMENT defaults to the member's department.
    const scopeType = input.scopeType ?? "ORG";
    let scopeId: string | null = null;
    if (scopeType === "DEPARTMENT") {
      scopeId = input.scopeId ?? input.departmentId ?? null;
      if (!scopeId) throw new BadRequestException("A department is required for department scope.");
      const dept = await this.prisma.department.findFirst({ where: { id: scopeId, orgId: ctx.orgId } });
      if (!dept) throw new NotFoundException("Scope department not found.");
    } else if (scopeType === "TEAM") {
      scopeId = input.scopeId ?? null;
      if (!scopeId) throw new BadRequestException("A team is required for team scope.");
      const team = await this.prisma.team.findFirst({ where: { id: scopeId, orgId: ctx.orgId } });
      if (!team) throw new NotFoundException("Scope team not found.");
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const created = await this.prisma.$transaction(async (tx) => {
      // Seat check inside the tx (advisory-locked) so concurrent adds can't both
      // pass and overshoot the cap. 409 if at the licensed seat count.
      await this.seatLimit.assertCanAddEmployeeTx(tx, ctx.orgId);
      const systemRoles = await ensureSystemRoles(tx, ctx.orgId);
      // Prefer an explicit roleId (any org role); fall back to the legacy role name.
      let roleId = input.roleId ?? null;
      if (roleId) {
        const role = await tx.role.findFirst({ where: { id: roleId, orgId: ctx.orgId } });
        if (!role) throw new BadRequestException("Unknown role.");
      } else {
        roleId = systemRoles.get(input.role ?? "Employee") ?? null;
      }
      if (!roleId) throw new BadRequestException("Unknown role.");

      const emp = await tx.employee.create({
        data: {
          orgId: ctx.orgId,
          email,
          firstName: input.firstName,
          lastName: input.lastName,
          departmentId: input.departmentId ?? null,
          title: input.title,
          createdBy: ctx.userId,
        },
      });
      const user = await tx.user.create({ data: { email, passwordHash, mustChangePassword: true } });
      const membership = await tx.organizationMembership.create({
        data: { orgId: ctx.orgId, userId: user.id, employeeId: emp.id, roleId, status: "ACTIVE" },
      });
      // Base-role grant at the chosen scope (multi-grant RBAC).
      await tx.roleAssignment.create({
        data: { orgId: ctx.orgId, userId: user.id, employeeId: emp.id, roleId, scopeType, scopeId, status: "ACTIVE", createdBy: ctx.userId },
      });
      const role = await tx.role.findUnique({ where: { id: roleId }, select: { name: true } });

      // --- Salary decided AT HIRE ---
      // Staff (any non-Owner role) MUST have a base salary; it seeds the payroll
      // profile v1 here, atomically with the hire, so the person's approved
      // timesheets, attendance and leave flow straight into payroll from day one.
      // The Owner runs the org but is not payroll staff — exempt, no profile.
      const roleName = role?.name ?? "Employee";
      if (roleName !== "Owner") {
        if (input.baseAmount == null || !(input.baseAmount > 0)) {
          throw new BadRequestException("A base salary is required when hiring a staff member.");
        }
        const effectiveFrom = new Date(`${input.effectiveFrom ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
        const profile = await tx.payrollProfile.create({ data: { orgId: ctx.orgId, employeeId: emp.id } });
        await tx.payrollProfileVersion.create({
          data: {
            orgId: ctx.orgId,
            profileId: profile.id,
            version: 1,
            currencyCode: (input.currencyCode ?? "USD").trim().toUpperCase(),
            payFrequency: input.payFrequency ?? "MONTHLY",
            paymentBasis: input.paymentBasis ?? "FIXED",
            baseAmount: new Prisma.Decimal(input.baseAmount),
            prorationPolicy: "CALENDAR_DAYS",
            effectiveFrom,
            joinDate: effectiveFrom,
            createdBy: ctx.userId,
          },
        });
      }

      // Project the new membership to downstream read models. Without this the
      // notifications service never learns about invited members, so role-based
      // audiences (approvers / org-admins) silently resolve to nobody.
      await this.outbox.enqueue(tx, {
        eventType: "org.member.upserted",
        aggregateType: "organizationMembership",
        aggregateId: membership.id,
        orgId: ctx.orgId,
        actorUserId: ctx.userId,
        payload: {
          orgId: ctx.orgId,
          userId: user.id,
          roleName: role?.name ?? "Employee",
          status: membership.status,
          email,
          name: `${input.firstName} ${input.lastName}`.trim(),
        },
      });

      return { emp, roleName: role?.name ?? "Member" };
    });

    return {
      employee: {
        id: created.emp.id,
        firstName: created.emp.firstName,
        lastName: created.emp.lastName,
        email,
        role: created.roleName,
        departmentId: created.emp.departmentId,
        title: created.emp.title ?? null,
      },
      // Returned ONCE for the admin to share with the new member.
      tempPassword,
    };
  }
}
