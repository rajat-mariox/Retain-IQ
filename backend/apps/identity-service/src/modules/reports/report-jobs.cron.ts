import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { logger } from "../../common/observability/observability.js";
import { ReportJobsService } from "./report-jobs.service.js";

/**
 * Sweeps PENDING report jobs every minute and builds them off the request path.
 * Kept tiny — all the work lives in ReportJobsService.processPending, which is
 * the seam a dedicated queue/worker can take over later.
 */
@Injectable()
export class ReportJobsCron {
  constructor(private readonly jobs: ReportJobsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    try {
      const done = await this.jobs.processPending();
      if (done > 0) logger.info({ done }, "report jobs processed");
    } catch (error) {
      logger.warn({ err: String(error) }, "report job sweep failed");
    }
  }
}
