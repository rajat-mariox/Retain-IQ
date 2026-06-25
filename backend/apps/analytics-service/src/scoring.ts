/**
 * Pure scoring contracts shared between the main thread (delta derivation) and
 * the worker_threads pool (score computation). No I/O here.
 */

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

// Minimal productive-app classification; real classification is org-configurable.
const PRODUCTIVE_APPS = new Set(["vscode", "code", "intellij", "terminal", "iterm", "figma", "excel", "word"]);

/** Maps a single activity event to its contribution to the day's counters. */
export function deriveDelta(eventType: string, payload: Record<string, unknown>): ActivityDelta {
  const delta: ActivityDelta = { activeSeconds: 0, idleSeconds: 0, productiveSeconds: 0, eventCount: 1 };
  const seconds = toNumber(payload.seconds);

  switch (eventType) {
    case "activity.app.used": {
      delta.activeSeconds = seconds;
      if (isProductive(payload)) {
        delta.productiveSeconds = seconds;
      }
      break;
    }
    case "activity.website.visited": {
      delta.activeSeconds = seconds;
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

function isProductive(payload: Record<string, unknown>): boolean {
  if (typeof payload.productive === "boolean") {
    return payload.productive;
  }
  const app = typeof payload.app === "string" ? payload.app.toLowerCase() : "";
  return PRODUCTIVE_APPS.has(app);
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
