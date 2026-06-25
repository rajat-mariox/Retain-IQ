import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { STREAMS } from "@retainiq/messaging";
import { getRequestContext } from "../context/request-context.store.js";

export type EnqueueParams = {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  orgId: string;
  payload: Record<string, unknown>;
  actorUserId?: string;
};

/**
 * Writes domain events to the transactional outbox. Must be called with the
 * same Prisma transaction client as the state change it describes, so the event
 * is committed atomically with the write (no lost or phantom events). The relay
 * publishes these rows to the broker asynchronously.
 */
@Injectable()
export class OutboxService {
  enqueue(tx: Prisma.TransactionClient, params: EnqueueParams): Promise<unknown> {
    const ctx = getRequestContext();
    const now = new Date().toISOString();

    const envelope = {
      eventId: randomUUID(),
      eventType: params.eventType,
      schemaVersion: 1,
      orgId: params.orgId,
      actorUserId: params.actorUserId ?? ctx.userId,
      source: "system",
      occurredAt: now,
      ingestedAt: now,
      requestId: ctx.requestId,
      traceId: ctx.traceId,
      payload: params.payload,
    };

    return tx.outboxEvent.create({
      data: {
        orgId: params.orgId,
        topic: STREAMS.domainEvents,
        eventType: params.eventType,
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
        // Round-trip through JSON to drop undefined values for the Json column.
        payload: JSON.parse(JSON.stringify(envelope)) as Prisma.InputJsonValue,
      },
    });
  }
}
