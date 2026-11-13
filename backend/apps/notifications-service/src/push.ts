import type { PrismaClient } from "@retainiq/database/notifications";
import type { Logger } from "@retainiq/observability";
import webpush from "web-push";

export type PushMessage = { title: string; body: string; link?: string | null; tag?: string };

/**
 * Web Push (VAPID) sender. Inert unless both VAPID keys are configured, so a
 * missing key never breaks delivery of the other channels. Subscriptions that
 * the browser has expired (404/410) are pruned on send.
 */
export class PushSender {
  readonly enabled: boolean;

  constructor(
    cfg: { publicKey?: string; privateKey?: string; subject: string },
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
  ) {
    this.enabled = Boolean(cfg.publicKey && cfg.privateKey);
    if (this.enabled) {
      webpush.setVapidDetails(cfg.subject, cfg.publicKey!, cfg.privateKey!);
    }
  }

  /**
   * Fan out to every device the user has registered.
   * `sent` = at least one push landed; `skipped` = nothing to deliver to (no
   * devices, or push not configured) — which is not a failure.
   */
  async send(orgId: string, userId: string, msg: PushMessage): Promise<"sent" | "skipped" | "failed"> {
    if (!this.enabled) {
      this.logger.info({ userId, title: msg.title }, "push skipped (VAPID not configured)");
      return "skipped";
    }
    const subs = await this.prisma.pushSubscription.findMany({ where: { orgId, userId } });
    if (subs.length === 0) return "skipped"; // user never enabled push on any device

    const payload = JSON.stringify({ title: msg.title, body: msg.body, link: msg.link ?? null, tag: msg.tag });
    let anySent = false;
    let anyFailed = false;

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        anySent = true;
        await this.prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastUsedAt: new Date() } });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Browser dropped the subscription — stop trying to reach it. Pruning a
          // dead endpoint is housekeeping, not a delivery failure.
          await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          this.logger.info({ userId, endpoint: sub.endpoint.slice(0, 40) }, "push subscription expired, removed");
        } else {
          anyFailed = true;
          this.logger.warn({ userId, err: String(error) }, "push send failed");
        }
      }
    }
    if (anySent) return "sent";
    return anyFailed ? "failed" : "skipped";
  }
}
