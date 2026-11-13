import { Controller, Get } from "@nestjs/common";
import { runHealthChecks } from "@retainiq/platform";
import { PrismaService } from "../../common/database/prisma.service.js";
import { BrokerService } from "../../common/messaging/broker.service.js";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly broker: BrokerService,
  ) {}

  /** Liveness: process is up. */
  @Get()
  getHealth() {
    return { status: "ok", service: "identity-service", timestamp: new Date().toISOString() };
  }

  /** Readiness: dependencies reachable (Postgres + broker). Returns 503 if not. */
  @Get("ready")
  getReadiness() {
    return runHealthChecks({
      database: () => this.prisma.$queryRaw`SELECT 1`,
      broker: () => this.broker.ping(),
    });
  }
}
