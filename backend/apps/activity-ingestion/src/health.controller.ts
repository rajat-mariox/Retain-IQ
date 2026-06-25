import { Controller, Get } from "@nestjs/common";
import { runHealthChecks } from "@retainiq/platform";
import { BrokerService } from "./broker.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly broker: BrokerService) {}

  @Get()
  getHealth() {
    return { status: "ok", service: "ingestion-service", timestamp: new Date().toISOString() };
  }

  /** Readiness: broker reachable. Returns 503 if the broker is down. */
  @Get("ready")
  getReadiness() {
    return runHealthChecks({ broker: () => this.broker.ping() });
  }
}
