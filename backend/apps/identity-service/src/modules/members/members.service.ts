import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { hashPassword } from "../../common/crypto/password.util.js";
import { generateTempPassword } from "../../common/crypto/temp-password.util.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { SeatLimitService } from "../../common/seat-limit/seat-limit.service.js";
import { ensureSystemRoles } from "../../common/security/roles.util.js";
import type { AddMemberInput } from "./dto.js";

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seatLimit: SeatLimitService,
  ) {}

  /** Adds an employee + a login account with a temporary password (first-login change). */
  async addMember(input: AddMemberInput) {
    const ctx = requireTenantContext();
    const email = input.email.toLowerCase();

    await this.seatLimit.assertCanAddEmployee(ctx.orgId); // 409 if at the licensed seat count

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
      await tx.organizationMembership.create({
        data: { orgId: ctx.orgId, userId: user.id, employeeId: emp.id, roleId, status: "ACTIVE" },
      });
      // Base-role grant at the chosen scope (multi-grant RBAC).
      await tx.roleAssignment.create({
        data: { orgId: ctx.orgId, userId: user.id, employeeId: emp.id, roleId, scopeType, scopeId, status: "ACTIVE", createdBy: ctx.userId },
      });
      const role = await tx.role.findUnique({ where: { id: roleId }, select: { name: true } });
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
