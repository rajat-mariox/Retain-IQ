import { ConflictException, Injectable } from "@nestjs/common";
import { BillingReadPrismaService } from "../database/billing-prisma.service.js";
import { PrismaService } from "../database/prisma.service.js";

/**
 * Enforces the subscribed seat count when provisioning employees. Seats live in
 * billing-db (read via the read-binding); the active-employee headcount lives in
 * identity-db. Adding an employee at/over the licensed count is hard-blocked.
 */
@Injectable()
export class SeatLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingReadPrismaService,
  ) {}

  /** Throws 409 if the org has no free seat. Call BEFORE creating an employee. */
  async assertCanAddEmployee(orgId: string): Promise<void> {
    const sub = await this.billing.subscription.findUnique({ where: { orgId }, select: { seats: true } });
    if (!sub) return; // no subscription → nothing to enforce

    const activeEmployees = await this.prisma.employee.count({ where: { orgId, status: "ACTIVE" } });
    if (activeEmployees >= sub.seats) {
      throw new ConflictException(
        `Seat limit reached: ${activeEmployees}/${sub.seats} seats in use. Upgrade the plan or add seats before adding more employees.`,
      );
    }
  }
}
