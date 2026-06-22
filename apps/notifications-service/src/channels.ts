import type { Logger } from "@retainiq/observability";
import { isQuietHour } from "./quiet-hours.js";
import type { Channel } from "./rules.js";

export type DeliveryOutcome = { status: "SENT" | "DEFERRED"; sentAt: Date | null };

export type DispatchContext = {
  channel: Channel;
  recipientUserId: string;
  title: string;
  body: string;
  logger: Logger;
  quietHours: { start: number; end: number; now: number };
};

/**
 * Multi-channel dispatcher. IN_APP is the durable row itself (always SENT).
 * EMAIL/PUSH are external sends — stubbed here behind adapters (the seam for
 * SES/FCM/APNs) and deferred during quiet hours. Each adapter returns the
 * delivery outcome the caller persists on the Notification row.
 */
export function dispatch(ctx: DispatchContext): DeliveryOutcome {
  switch (ctx.channel) {
    case "IN_APP":
      // The persisted notification IS the in-app delivery.
      return { status: "SENT", sentAt: new Date() };

    case "EMAIL":
    case "PUSH": {
      if (isQuietHour(ctx.quietHours.now, ctx.quietHours.start, ctx.quietHours.end)) {
        ctx.logger.info(
          { channel: ctx.channel, recipientUserId: ctx.recipientUserId },
          "channel delivery deferred (quiet hours)",
        );
        return { status: "DEFERRED", sentAt: null };
      }
      // Stub external send. Replace with SES/FCM/APNs adapters.
      ctx.logger.info(
        { channel: ctx.channel, recipientUserId: ctx.recipientUserId, title: ctx.title },
        "channel delivery sent",
      );
      return { status: "SENT", sentAt: new Date() };
    }

    default:
      return { status: "SENT", sentAt: new Date() };
  }
}
