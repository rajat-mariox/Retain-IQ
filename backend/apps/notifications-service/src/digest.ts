import type { PrismaClient } from "@retainiq/database/notifications";
import type { Logger } from "@retainiq/observability";
import type { EmailSender } from "./email.js";
import { hourInTimezone } from "./preferences.js";

const DAY_MS = 24 * 3600 * 1000;

/**
 * Rolls unread in-app notifications into one digest email per user.
 *
 * Runs on an interval and is safe to call often: a user is only mailed once
 * their configured send-hour has arrived in their own timezone AND a full
 * period has elapsed since their last digest, tracked on `lastDigestAt`.
 */
export async function runDigestSweep(
  prisma: PrismaClient,
  email: EmailSender,
  logger: Logger,
  appUrl: string,
  now: Date = new Date(),
): Promise<number> {
  if (!email.enabled) return 0;

  const settings = await prisma.notificationSetting.findMany({ where: { digest: { in: ["DAILY", "WEEKLY"] } } });
  let sent = 0;

  for (const s of settings) {
    const periodMs = s.digest === "WEEKLY" ? 7 * DAY_MS : DAY_MS;
    // Only at (or after) the user's chosen hour, in their timezone.
    if (hourInTimezone(s.timezone, now) < s.digestHour) continue;
    if (s.lastDigestAt && now.getTime() - s.lastDigestAt.getTime() < periodMs) continue;

    const since = s.lastDigestAt ?? new Date(now.getTime() - periodMs);
    const items = await prisma.notification.findMany({
      where: {
        orgId: s.orgId,
        recipientUserId: s.userId,
        channel: "IN_APP",
        archivedAt: null,
        readAt: null,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { title: true, body: true, createdAt: true },
    });

    // Nothing to say — still stamp the run so we don't re-check every sweep.
    if (items.length === 0) {
      await prisma.notificationSetting.update({ where: { id: s.id }, data: { lastDigestAt: now } });
      continue;
    }

    const recipient = await prisma.orgRecipient.findUnique({
      where: { orgId_userId: { orgId: s.orgId, userId: s.userId } },
      select: { email: true, name: true },
    });
    if (!recipient?.email) continue; // can't address them yet

    const label = s.digest === "WEEKLY" ? "This week" : "Today";
    const ok = await email.send({
      to: recipient.email,
      subject: `${label} on RetainIQ — ${items.length} update${items.length === 1 ? "" : "s"}`,
      title: `${label}'s summary`,
      body: `You have ${items.length} unread notification${items.length === 1 ? "" : "s"}.`,
      link: "/notifications",
      items: items.map((i) => ({ title: i.title, body: i.body, when: i.createdAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" })),
    });
    if (ok) {
      await prisma.notificationSetting.update({ where: { id: s.id }, data: { lastDigestAt: now } });
      sent += 1;
    }
  }

  if (sent > 0) logger.info({ sent, appUrl }, "digest emails sent");
  return sent;
}
