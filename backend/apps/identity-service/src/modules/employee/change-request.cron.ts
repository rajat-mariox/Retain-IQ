import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../common/database/prisma.service.js";
import { ChangeRequestService } from "./change-request.service.js";

/**
 * Applies future-dated promotions/transfers once their effective date arrives.
 * Runs daily; picks up every SCHEDULED request whose effectiveDate is today or
 * past and applies it (idempotent — apply() flips status to APPLIED). This is the
 * seam that makes effective-dating real rather than immediate-only.
 */
@Injectable()
export class ChangeRequestCron {
  private readonly log = new Logger(ChangeRequestCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ChangeRequestService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async applyDue(): Promise<void> {
    const now = new Date();
    const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
    const due = await this.prisma.employeeChangeRequest.findMany({
      where: { status: "SCHEDULED", effectiveDate: { lte: endOfToday } },
      select: { id: true },
      take: 200,
    });
    let applied = 0;
    for (const d of due) {
      try {
        await this.changes.apply(d.id);
        applied += 1;
      } catch (err) {
        this.log.warn(`Scheduled change ${d.id} failed to apply: ${String(err)}`);
      }
    }
    if (applied > 0) this.log.log(`Applied ${applied} scheduled change request(s)`);
  }
}
