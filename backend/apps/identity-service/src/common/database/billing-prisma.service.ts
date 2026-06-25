import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@retainiq/database/billing";

/**
 * READ-ONLY binding to the billing service database.
 *
 * Database-per-service: billing-service owns and writes this database. identity
 * acts as the BFF/API layer and only *reads* plans/subscriptions/invoices from
 * it (for the tenant billing screen + the super-admin revenue dashboards).
 * Connects via BILLING_DATABASE_URL. Never write to the billing database here —
 * subscriptions are provisioned by billing-service via the `organization.created`
 * event.
 */
@Injectable()
export class BillingReadPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = process.env.BILLING_DATABASE_URL;
    super(url ? { datasourceUrl: url } : undefined);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
