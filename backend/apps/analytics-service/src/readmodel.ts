/**
 * Employee-monitoring read-model persistence. Runs inside the analytics-worker's
 * idempotent transaction (gated by ConsumedEvent), turning the activity stream
 * into detail tables the day-fact rollup discards: work sessions, per-app/site
 * usage, and the activity timeline.
 */
import type { Prisma } from "@retainiq/database/analytics";

type Category = "PRODUCTIVE" | "NEUTRAL" | "DISTRACTING";

const PRODUCTIVE_APPS = ["vscode", "code", "intellij", "webstorm", "pycharm", "goland", "terminal", "iterm", "figma", "excel", "word", "powerpoint", "outlook", "slack", "teams", "notion", "jira", "confluence", "postman", "docker", "xcode"];
const DISTRACTING_APPS = ["youtube", "netflix", "instagram", "facebook", "twitter", "tiktok", "reddit", "spotify", "steam", "discord", "twitch", "whatsapp", "telegram"];
const PRODUCTIVE_DOMAINS = ["github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com", "docs.google.com", "atlassian.net", "notion.so", "figma.com", "vercel.com", "console.aws.amazon.com", "developer.mozilla.org", "npmjs.com", "linear.app"];
const DISTRACTING_DOMAINS = ["youtube.com", "netflix.com", "instagram.com", "facebook.com", "twitter.com", "x.com", "tiktok.com", "reddit.com", "twitch.tv", "primevideo.com"];

export function classifyApp(name: string, explicitProductive?: unknown): Category {
  if (explicitProductive === true) return "PRODUCTIVE";
  if (explicitProductive === false) return "DISTRACTING";
  const n = name.toLowerCase();
  if (PRODUCTIVE_APPS.some((p) => n.includes(p))) return "PRODUCTIVE";
  if (DISTRACTING_APPS.some((d) => n.includes(d))) return "DISTRACTING";
  return "NEUTRAL";
}

export function classifyDomain(domain: string): Category {
  const d = domain.toLowerCase().replace(/^www\./, "");
  if (PRODUCTIVE_DOMAINS.some((x) => d === x || d.endsWith(`.${x}`))) return "PRODUCTIVE";
  if (DISTRACTING_DOMAINS.some((x) => d === x || d.endsWith(`.${x}`))) return "DISTRACTING";
  return "NEUTRAL";
}

interface DetailContext {
  orgId: string;
  employeeId: string;
  day: Date;
  occurredAt: Date;
  eventType: string;
  sourceEventId: string | null;
  payload: Record<string, unknown>;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
function hostFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function bumpSession(tx: Prisma.TransactionClient, ctx: DetailContext, d: { active?: number; idle?: number; brk?: number }): Promise<void> {
  const sessionKey = str(ctx.payload.sessionId);
  const active = d.active ?? 0;
  const idle = d.idle ?? 0;
  const brk = d.brk ?? 0;
  if (!sessionKey || (active === 0 && idle === 0 && brk === 0)) return;
  await tx.workSession.updateMany({
    where: { orgId: ctx.orgId, employeeId: ctx.employeeId, sessionKey },
    data: { activeSeconds: { increment: active }, idleSeconds: { increment: idle }, breakSeconds: { increment: brk } },
  });
}

/** Persist the detail read-models for one activity event. Assumed idempotent via the caller's ConsumedEvent gate. */
export async function persistDetail(tx: Prisma.TransactionClient, ctx: DetailContext): Promise<void> {
  const { orgId, employeeId, day, occurredAt, eventType, payload } = ctx;
  const seconds = num(payload.seconds);
  const base = { orgId, employeeId, day, occurredAt };

  switch (eventType) {
    case "activity.app.used": {
      const appName = str(payload.app) ?? str(payload.appName) ?? "Unknown";
      const category = classifyApp(appName, payload.productive);
      await tx.appUsageDaily.upsert({
        where: { orgId_employeeId_day_appName: { orgId, employeeId, day, appName } },
        create: { orgId, employeeId, day, appName, category, seconds },
        update: { seconds: { increment: seconds }, category },
      });
      await tx.activityEvent.create({ data: { ...base, type: "app", title: appName, category, seconds } });
      await bumpSession(tx, ctx, { active: seconds });
      break;
    }
    case "activity.website.visited": {
      const domain = str(payload.domain) ?? hostFromUrl(str(payload.url)) ?? "unknown";
      const category = classifyDomain(domain);
      await tx.websiteUsageDaily.upsert({
        where: { orgId_employeeId_day_domain: { orgId, employeeId, day, domain } },
        create: { orgId, employeeId, day, domain, category, seconds, visits: 1 },
        update: { seconds: { increment: seconds }, visits: { increment: 1 }, category },
      });
      await tx.activityEvent.create({ data: { ...base, type: "website", title: domain, detail: str(payload.url), category, seconds } });
      await bumpSession(tx, ctx, { active: seconds });
      break;
    }
    case "activity.idle.started":
    case "activity.idle.ended": {
      await tx.activityEvent.create({ data: { ...base, type: "idle", seconds } });
      await bumpSession(tx, ctx, { idle: seconds });
      break;
    }
    case "activity.break.started":
    case "activity.break.ended": {
      await tx.activityEvent.create({ data: { ...base, type: "break", title: str(payload.breakType), seconds } });
      await bumpSession(tx, ctx, { brk: seconds });
      break;
    }
    case "activity.session.started": {
      const sessionKey = str(payload.sessionId) ?? ctx.sourceEventId ?? occurredAt.toISOString();
      await tx.workSession.upsert({
        where: { orgId_employeeId_sessionKey: { orgId, employeeId, sessionKey } },
        create: { orgId, employeeId, sessionKey, day, startedAt: occurredAt },
        update: {},
      });
      await tx.activityEvent.create({ data: { ...base, type: "session", title: "Session started" } });
      break;
    }
    case "activity.session.ended": {
      const sessionKey = str(payload.sessionId) ?? ctx.sourceEventId;
      if (sessionKey) {
        await tx.workSession.upsert({
          where: { orgId_employeeId_sessionKey: { orgId, employeeId, sessionKey } },
          create: { orgId, employeeId, sessionKey, day, startedAt: occurredAt, endedAt: occurredAt },
          update: { endedAt: occurredAt },
        });
      }
      await tx.activityEvent.create({ data: { ...base, type: "session", title: "Session ended" } });
      break;
    }
    case "activity.screenshot.captured": {
      await tx.activityEvent.create({ data: { ...base, type: "screenshot", detail: str(payload.objectKey) } });
      break;
    }
    case "activity.focus.block.completed": {
      await tx.activityEvent.create({ data: { ...base, type: "focus", seconds } });
      break;
    }
    case "activity.context_switch.recorded": {
      await tx.activityEvent.create({ data: { ...base, type: "context_switch" } });
      break;
    }
    default:
      break;
  }
}
