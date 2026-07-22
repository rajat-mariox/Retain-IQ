import type { Logger } from "@retainiq/observability";
import type { EmailSender } from "./email.js";
import type { PushSender } from "./push.js";
import { isQuietHour } from "./quiet-hours.js";
import type { Channel } from "./rules.js";

export type DeliveryOutcome = { status: "SENT" | "DEFERRED" | "FAILED" | "SUPPRESSED"; sentAt: Date | null };

export type DispatchContext = {
  channel: Channel;
  orgId: string;
  recipientUserId: string;
  recipientEmail: string | null;
  title: string;
  body: string;
  link: string | null;
  logger: Logger;
  quietHours: { start: number; end: number; now: number };
  email: EmailSender;
  push: PushSender;
};

/**
 * Multi-channel dispatcher. IN_APP is the durable row itself (always SENT).
 * EMAIL/PUSH are real external sends, deferred during the recipient's quiet
 * hours. Each returns the delivery outcome the caller persists on the row.
 */
export async function dispatch(ctx: DispatchContext): Promise<DeliveryOutcome> {
  switch (ctx.channel) {
    case "IN_APP":
      // The persisted notification IS the in-app delivery.
      return { status: "SENT", sentAt: new Date() };

    case "EMAIL": {
      if (isQuietHour(ctx.quietHours.now, ctx.quietHours.start, ctx.quietHours.end)) {
        ctx.logger.info({ channel: "EMAIL", recipientUserId: ctx.recipientUserId }, "channel delivery deferred (quiet hours)");
        return { status: "DEFERRED", sentAt: null };
      }
      if (!ctx.recipientEmail) {
        ctx.logger.warn({ recipientUserId: ctx.recipientUserId }, "email skipped (no address on recipient projection)");
        return { status: "SUPPRESSED", sentAt: null };
      }
      const ok = await ctx.email.send({
        to: ctx.recipientEmail,
        subject: ctx.title,
        title: ctx.title,
        body: ctx.body,
        link: ctx.link,
      });
      return ok ? { status: "SENT", sentAt: new Date() } : { status: "FAILED", sentAt: null };
    }

    case "PUSH": {
      if (isQuietHour(ctx.quietHours.now, ctx.quietHours.start, ctx.quietHours.end)) {
        ctx.logger.info({ channel: "PUSH", recipientUserId: ctx.recipientUserId }, "channel delivery deferred (quiet hours)");
        return { status: "DEFERRED", sentAt: null };
      }
      const result = await ctx.push.send(ctx.orgId, ctx.recipientUserId, {
        title: ctx.title,
        body: ctx.body,
        link: ctx.link,
      });
      // No registered device is SUPPRESSED (nothing to deliver to), not FAILED —
      // only a real transport error counts as a failure.
      if (result === "sent") return { status: "SENT", sentAt: new Date() };
      return { status: result === "failed" ? "FAILED" : "SUPPRESSED", sentAt: null };
    }

    default:
      return { status: "SENT", sentAt: new Date() };
  }
}
