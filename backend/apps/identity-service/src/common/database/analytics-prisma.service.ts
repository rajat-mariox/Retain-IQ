import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@retainiq/database/analytics";

/**
 * READ-ONLY binding to the analytics service database.
 *
 * Database-per-service: analytics-worker owns and writes this database. The
 * platform-admin reporting API (a BFF read surface) only *reads* the precomputed
 * EmployeeDayFact read model to produce cross-org usage/productivity rollups.
 * Connects via ANALYTICS_DATABASE_URL — a separate connection from the identity
 * database used by PrismaService. Never write to the analytics database here.
 */
@Injectable()
export class AnalyticsReadPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = process.env.ANALYTICS_DATABASE_URL;
    super(url ? { datasourceUrl: url } : undefined);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
