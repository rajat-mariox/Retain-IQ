import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { ActivityIngestEvent } from "@retainiq/contracts";
import { STREAMS } from "@retainiq/messaging";
import { BrokerService } from "./broker.service.js";

@Injectable()
export class IngestionService {
  constructor(private readonly broker: BrokerService) {}

  /**
   * Stamps each agent-submitted activity event with an envelope and publishes
   * it to the activity stream. This path never touches the OLTP database — it
   * is decoupled so high event volume cannot impact transactional workloads.
   */
  async ingestActivity(orgId: string, events: ActivityIngestEvent[]): Promise<{ accepted: number }> {
    const ingestedAt = new Date().toISOString();

    for (const event of events) {
      const envelope = {
        eventId: randomUUID(),
        eventType: event.eventType,
        schemaVersion: 1,
        orgId,
        employeeId: event.employeeId,
        source: "desktop-agent",
        sourceEventId: event.sourceEventId,
        occurredAt: event.occurredAt,
        ingestedAt,
        payload: event.payload,
      };
      await this.broker.publish(
        STREAMS.activity,
        JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>,
      );
    }

    return { accepted: events.length };
  }
}
