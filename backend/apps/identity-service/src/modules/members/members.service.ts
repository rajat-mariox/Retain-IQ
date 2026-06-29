import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
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

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const employee = await this.prisma.$transaction(async (tx) => {
      const roles = await ensureSystemRoles(tx, ctx.orgId);
      const roleId = roles.get(input.role);
      if (!roleId) {
        throw new BadRequestException("Unknown role.");
      }
      const emp = await tx.employee.create({
        data: {
          orgId: ctx.orgId,
          email,
          firstName: input.firstName,
          lastName: input.lastName,
          department: input.department,
          title: input.title,
          createdBy: ctx.userId,
        },
      });
      const user = await tx.user.create({ data: { email, passwordHash, mustChangePassword: true } });
      await tx.organizationMembership.create({
        data: { orgId: ctx.orgId, userId: user.id, employeeId: emp.id, roleId, status: "ACTIVE" },
      });
      return emp;
    });

    return {
      employee: {
        id: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email,
        role: input.role,
        department: input.department ?? null,
        title: input.title ?? null,
      },
      // Returned ONCE for the admin to share with the new member.
      tempPassword,
    };
  }
}
