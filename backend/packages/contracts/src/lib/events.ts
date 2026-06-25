import { z } from "zod";

export const eventSourceSchema = z.enum([
  "web-app",
  "desktop-agent",
  "mobile-app",
  "integration",
  "system",
  "worker",
]);

export const baseEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(3),
  schemaVersion: z.number().int().positive(),
  orgId: z.string().uuid(),
  employeeId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  source: eventSourceSchema,
  sourceEventId: z.string().min(1).optional(),
  occurredAt: z.string().datetime(),
  ingestedAt: z.string().datetime(),
  requestId: z.string().uuid().optional(),
  traceId: z.string().optional(),
  payload: z.record(z.unknown()),
});

export type BaseEvent = z.infer<typeof baseEventSchema>;

/** Domain events emitted by core-api via the transactional outbox. */
export const domainEventTypeSchema = z.enum([
  "org.registered",
  "employee.created",
  "org.member.upserted",
]);

export type DomainEventType = z.infer<typeof domainEventTypeSchema>;

/**
 * Membership projection event. Published by the identity service whenever a
 * membership is created or its role/status changes, so downstream services
 * (e.g. notifications) can maintain a local read model of org members and
 * resolve recipients without reading the identity database.
 */
export const orgMemberUpsertedPayloadSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  roleName: z.string().min(1),
  status: z.string().min(1),
});

export type OrgMemberUpsertedPayload = z.infer<typeof orgMemberUpsertedPayloadSchema>;

export const activityEventTypeSchema = z.enum([
  "activity.session.started",
  "activity.session.ended",
  "activity.app.used",
  "activity.website.visited",
  "activity.idle.started",
  "activity.idle.ended",
  "activity.break.started",
  "activity.break.ended",
  "activity.screenshot.captured",
  "activity.focus.block.completed",
  "activity.context_switch.recorded",
]);

/** A single activity event as submitted by an agent to the ingestion service. */
export const activityIngestEventSchema = z.object({
  eventType: activityEventTypeSchema,
  occurredAt: z.string().datetime(),
  employeeId: z.string().uuid().optional(),
  sourceEventId: z.string().min(1).optional(),
  payload: z.record(z.unknown()).default({}),
});

export type ActivityIngestEvent = z.infer<typeof activityIngestEventSchema>;

export const activityIngestBatchSchema = z.object({
  events: z.array(activityIngestEventSchema).min(1).max(500),
});

export type ActivityIngestBatch = z.infer<typeof activityIngestBatchSchema>;

export const auditEventSchema = baseEventSchema.extend({
  eventType: z.literal("audit.event.created"),
  payload: z.object({
    action: z.string().min(1),
    resourceType: z.string().min(1),
    resourceId: z.string().optional(),
    before: z.record(z.unknown()).optional(),
    after: z.record(z.unknown()).optional(),
  }),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

