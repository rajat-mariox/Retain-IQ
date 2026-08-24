import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { logger } from "../../common/observability/observability.js";
import { TimeTrackingService } from "./timetracking.service.js";

/**
 * Daily sweep that turns the previous day's tracked desktop-agent activity into
 * AUTOMATIC time entries (one per employee, seeded from their active time,
 * non-billable). Runs early morning so yesterday's activity is fully ingested.
 * The heavy lifting + idempotency live in TimeTrackingService.syncAutoEntries.
 */
@Injectable()
export class TimeAutoSyncService {
  constructor(private readonly time: TimeTrackingService) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async sweep(): Promise<void> {
    try {
      const { created } = await this.time.syncAutoEntries(); // defaults to yesterday
      if (created > 0) logger.info({ created }, "auto time-entry sweep complete");
    } catch (error) {
      logger.warn({ err: String(error) }, "auto time-entry sweep failed");
    }
  }
}
