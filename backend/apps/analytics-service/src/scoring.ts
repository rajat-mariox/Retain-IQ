/**
 * Pure scoring contracts shared between the main thread (delta derivation) and
 * the worker_threads pool (score computation). No I/O here.
 */
import { classifyApp, classifyDomain } from "./readmodel.js";

export type ActivityDelta = {
  activeSeconds: number;
  idleSeconds: number;
  productiveSeconds: number;
  eventCount: number;
};

export type ScoreInput = {
  activeSeconds: number;
  idleSeconds: number;
  productiveSeconds: number;
  eventCount: number;
};

export type ScoreOutput = {
  productivityScore: number;
  focusScore: number;
};

/**
 * Maps a single activity event to its contribution to the day's counters.
 *
 * Classification is delegated to readmodel's classifyApp/classifyDomain — the
 * same functions that label the ActivityEvent timeline. This file used to keep
 * its own shorter app list and ignore websites entirely, so productivityScore
 * was always 0 while the timeline showed the same work as PRODUCTIVE. One
 * classifier, one answer.
 */
export function deriveDelta(eventType: string, payload: Record<string, unknown>): ActivityDelta {
  const delta: ActivityDelta = { activeSeconds: 0, idleSeconds: 0, productiveSeconds: 0, eventCount: 1 };
  const seconds = toNumber(payload.seconds);

  switch (eventType) {
    case "activity.app.used": {
      delta.activeSeconds = seconds;
      const app = typeof payload.app === "string" ? payload.app : "";
      if (classifyApp(app, payload.productive) === "PRODUCTIVE") {
        delta.productiveSeconds = seconds;
      }
      break;
    }
    case "activity.website.visited": {
      delta.activeSeconds = seconds;
      // Time on github/stackoverflow/docs is work — it was being counted as
      // active but never productive, which dragged every score toward zero.
      const domain = typeof payload.domain === "string" ? payload.domain : hostFromUrl(payload.url);
      if (domain && classifyDomain(domain) === "PRODUCTIVE") {
        delta.productiveSeconds = seconds;
      }
      break;
    }
    case "activity.idle.started":
    case "activity.idle.ended": {
      delta.idleSeconds = seconds;
      break;
    }
    default:
      break; // session/break/screenshot/etc. only contribute to eventCount
  }

  return delta;
}

function hostFromUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
