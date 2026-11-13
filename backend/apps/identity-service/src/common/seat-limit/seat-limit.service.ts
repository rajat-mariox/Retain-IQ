import { ConflictException, Injectable } from "@nestjs/common";
import type { Prisma } from "@retainiq/database/identity";
import { BillingReadPrismaService } from "../database/billing-prisma.service.js";
import { PrismaService } from "../database/prisma.service.js";

/** Seat cap enforced when an org has no active subscription (fail closed to Free). */
const DEFAULT_FREE_SEATS = 5;

/**
 * Enforces the subscribed seat count when provisioning employees. Seats live in
 * billing-db (read via the read-binding); the active-employee headcount lives in
 * identity-db. Adding an employee at/over the licensed count is hard-blocked.
 *
 * Orgs with NO subscription fall back to the Free plan's cap (never unlimited).
 */
@Injectable()
export class SeatLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingReadPrismaService,
  ) {}

  /**
   * Transaction-aware seat check. MUST be called inside the same `$transaction`
   * that inserts the employee, so the count and the insert are atomic:
   *  1. Takes a per-org Postgres advisory xact lock, serialising concurrent
   *     creates for the org (the lock releases automatically at commit/rollback).
   *  2. Resolves the seat limit — the subscription's seats, else the Free plan's
   *     cap, else DEFAULT_FREE_SEATS. Never unlimited.
   *  3. Counts ACTIVE employees inside the tx and throws 409 if at/over the cap.
   *
   * The billing seat read stays on `this.billing` (its own datasource), NOT the tx.
   */
  async assertCanAddEmployeeTx(tx: Prisma.TransactionClient, orgId: string): Promise<void> {
    // Serialise concurrent creates for this org so two racing inserts can't both
    // pass the count check and overshoot the seat cap. Released on tx end.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}))`;

    const sub = await this.billing.subscription.findUnique({ where: { orgId }, select: { seats: true } });
    let limit = sub?.seats;
    if (limit == null) {
      // No subscription → fall back to the Free plan's cap (fail closed).
      const freePlan = await this.billing.plan.findUnique({ where: { id: "free" }, select: { seatLimit: true } });
      limit = freePlan?.seatLimit ?? DEFAULT_FREE_SEATS;
    }

    const activeEmployees = await tx.employee.count({ where: { orgId, status: "ACTIVE" } });
    if (activeEmployees >= limit) {
      // Distinct machine code so the client can tell a full-seats rejection apart
      // from other 409s (e.g. duplicate email) and route to the upgrade flow.
      throw new ConflictException({
        code: "seat_limit_reached",
        message: `Seat limit reached: ${activeEmployees}/${limit} seats in use. Upgrade the plan or add seats before adding more employees.`,
        seats: { used: activeEmployees, limit },
      });
    }
  }
}
