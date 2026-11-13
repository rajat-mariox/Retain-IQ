import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@retainiq/database/notifications";

/**
 * READ-ONLY binding to the notifications service database.
 *
 * Database-per-service: the  owns and writes this database.
 * identity-service acts as the BFF/API layer and only *reads* the in-app inbox from it
 * (the worker has no HTTP surface). It connects via NOTIFICATIONS_DATABASE_URL
 * — a separate connection from the identity database used by PrismaService.
 * Do not write to the notifications database from here.
 */
@Injectable()
export class NotificationsReadPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url = process.env.NOTIFICATIONS_DATABASE_URL;
    super(url ? { datasourceUrl: url } : undefined);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
