import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";

/**
 * Facts about who holds which system role in an org.
 *
 * The Owner runs the organization; they are not one of its staff. Anything that
 * treats a person as *staff* — payroll, attendance, timesheets, leave balances,
 * headcount — must leave them out, or the Owner shows up as someone to pay,
 * roster, and chase for a timesheet. Modules ask here instead of each writing
 * their own membership query.
 */
@Injectable()
export class OrgRolesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Employee ids linked to Owner accounts in this org. Usually one, but not guaranteed. */
  async ownerEmployeeIds(orgId: string): Promise<string[]> {
    const owners = await this.prisma.organizationMembership.findMany({
      where: { orgId, status: "ACTIVE", role: { name: "Owner" }, employeeId: { not: null } },
      select: { employeeId: true },
    });
    return owners.map((o) => o.employeeId).filter((x): x is string => Boolean(x));
  }

  /**
   * A Prisma filter fragment excluding the Owner from an employee-keyed table
   * (TimeEntry, Timesheet, LeaveRequest, …). Spread it into a `where`.
   */
  async notOwnerFilter(orgId: string): Promise<{ employeeId?: { notIn: string[] } }> {
    const ids = await this.ownerEmployeeIds(orgId);
    return ids.length > 0 ? { employeeId: { notIn: ids } } : {};
  }

  /** Same exclusion for queries keyed on the Employee table's own `id`. */
  async notOwnerIdFilter(orgId: string): Promise<{ id?: { notIn: string[] } }> {
    const ids = await this.ownerEmployeeIds(orgId);
    return ids.length > 0 ? { id: { notIn: ids } } : {};
  }

  /** Is this specific employee record an Owner's? */
  async isOwnerEmployee(orgId: string, employeeId: string): Promise<boolean> {
    const ids = await this.ownerEmployeeIds(orgId);
    return ids.includes(employeeId);
  }
}
