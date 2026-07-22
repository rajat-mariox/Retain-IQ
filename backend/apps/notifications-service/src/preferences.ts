import type { PrismaClient } from "@retainiq/database/notifications";
import type { Category, Channel } from "./rules.js";

/** Channel defaults per category when a user has never touched their settings. */
const DEFAULTS: Record<Category, { inApp: boolean; email: boolean; push: boolean }> = {
  ATTENDANCE: { inApp: true, email: true, push: false },
  PROJECT: { inApp: true, email: false, push: false },
  PRODUCTIVITY: { inApp: true, email: false, push: false },
  AI: { inApp: true, email: false, push: false },
  SYSTEM: { inApp: true, email: true, push: false },
};

export type RecipientPrefs = {
  allowed: Set<Channel>;
  quiet: { enabled: boolean; start: number; end: number; timezone: string };
};

/**
 * Resolve a recipient's effective delivery preferences for a category.
 * Missing rows fall back to DEFAULTS, so users who never opened settings still
 * get sensible delivery. IN_APP is never fully suppressed here — the inbox is
 * the durable record; only EMAIL/PUSH are opt-in.
 */
export async function resolvePreferences(
  prisma: PrismaClient,
  orgId: string,
  userId: string,
  category: Category,
): Promise<RecipientPrefs> {
  const [pref, setting] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { orgId_userId_category: { orgId, userId, category } } }),
    prisma.notificationSetting.findUnique({ where: { orgId_userId: { orgId, userId } } }),
  ]);

  const base = DEFAULTS[category] ?? DEFAULTS.SYSTEM;
  const allowed = new Set<Channel>();
  if (pref ? pref.inApp : base.inApp) allowed.add("IN_APP");
  if (pref ? pref.email : base.email) allowed.add("EMAIL");
  if (pref ? pref.push : base.push) allowed.add("PUSH");

  return {
    allowed,
    quiet: {
      enabled: setting?.quietHoursEnabled ?? false,
      start: setting?.quietStart ?? 22,
      end: setting?.quietEnd ?? 8,
      timezone: setting?.timezone ?? "UTC",
    },
  };
}

/** Current hour in an IANA timezone, for quiet-hours evaluation. */
export function hourInTimezone(timezone: string, at: Date = new Date()): number {
  try {
    const hour = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone }).format(at);
    const n = Number(hour);
    return Number.isFinite(n) ? n % 24 : at.getUTCHours();
  } catch {
    return at.getUTCHours(); // unknown tz -> UTC
  }
}
