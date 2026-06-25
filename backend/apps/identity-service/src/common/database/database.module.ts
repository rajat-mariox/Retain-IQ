import { Global, Module } from "@nestjs/common";
import { AnalyticsReadPrismaService } from "./analytics-prisma.service.js";
import { BillingReadPrismaService } from "./billing-prisma.service.js";
import { NotificationsReadPrismaService } from "./notifications-prisma.service.js";
import { PrismaService } from "./prisma.service.js";

/**
 * Global database access. The read-only cross-service bindings are singletons
 * here so we open exactly ONE connection pool per database per process — not one
 * pool per module that injects them.
 */
@Global()
@Module({
  providers: [PrismaService, AnalyticsReadPrismaService, NotificationsReadPrismaService, BillingReadPrismaService],
  exports: [PrismaService, AnalyticsReadPrismaService, NotificationsReadPrismaService, BillingReadPrismaService],
})
export class DatabaseModule {}
