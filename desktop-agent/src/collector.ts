/**
 * Samples the active window and system idle time on an interval, turning them
 * into RetainIQ activity events, and flushes the queue to the ingestion service.
 * A single work session spans start→stop; app/website/idle events carry its id.
 */
import { randomUUID } from "node:crypto";
import { powerMonitor } from "electron";
import { getConfig, getSession, loadQueue, saveQueue } from "./store.js";
import { uploadBatch, type ActivityEvent } from "./api.js";
import { getLatestTab } from "./tabserver.js";

const BROWSERS = ["chrome", "chromium", "edge", "msedge", "firefox", "brave", "opera", "safari", "vivaldi", "arc"];
const isBrowser = (app: string): boolean => BROWSERS.some((b) => app.toLowerCase().includes(b));

// active-win is ESM-only; import lazily so this CommonJS module stays loadable.
type ActiveWinResult = { owner?: { name?: string }; title?: string; url?: string } | undefined;
async function activeWindow(): Promise<ActiveWinResult> {
  try {
    const mod = (await import("active-win")) as unknown as { default: () => Promise<ActiveWinResult> };
    return await mod.default();
  } catch {
    return undefined;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export interface AgentStatus {
  running: boolean;
  sessionId: string | null;
  queued: number;
  lastFlushAt: string | null;
  lastApp: string | null;
  currentSite: string | null; // latest URL from the browser extension (confirms it's wired up)
  idle: boolean;
  uploadedTotal: number;
}

export class Collector {
  // Restored from disk on launch so events survive a crash / force-quit.
  private queue: ActivityEvent[] = loadQueue<ActivityEvent>();
  private sessionId: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private wasIdle = false;
  private idleStartedAt = 0;
  private lastApp: string | null = null;
  private lastFlushAt: string | null = null;
  private uploadedTotal = 0;

  isRunning(): boolean {
    return this.sessionId !== null;
  }

  status(): AgentStatus {
    const tab = getLatestTab();
    const currentSite = tab && Date.now() - tab.receivedAt < getConfig().tabFreshnessMs ? hostOf(tab.url) : null;
    return {
      running: this.isRunning(),
      sessionId: this.sessionId,
      queued: this.queue.length,
      lastFlushAt: this.lastFlushAt,
      lastApp: this.lastApp,
      currentSite,
      idle: this.wasIdle,
      uploadedTotal: this.uploadedTotal,
    };
  }

  private enqueue(eventType: string, payload: Record<string, unknown>, sourceEventId?: string): void {
    const session = getSession();
    if (!session) return;
    this.queue.push({ eventType, occurredAt: new Date().toISOString(), employeeId: session.employeeId, sourceEventId: sourceEventId ?? randomUUID(), payload: { ...payload, sessionId: this.sessionId } });
    // Bound the backlog if uploads have been failing for a long time (drop oldest).
    const cap = getConfig().maxQueue;
    if (this.queue.length > cap) this.queue.splice(0, this.queue.length - cap);
    saveQueue(this.queue);
  }

  /** Upload any events left over from a previous run (called on launch when logged in). */
  async replayPending(): Promise<void> {
    if (this.queue.length > 0) await this.flush();
  }

  start(): void {
    if (this.isRunning()) return;
    const cfg = getConfig();
    this.sessionId = `sess-${Date.now()}-${randomUUID().slice(0, 8)}`;
    this.enqueue("activity.session.started", {}, `${this.sessionId}-start`);
    this.pollTimer = setInterval(() => void this.poll(), cfg.pollSeconds * 1000);
    this.flushTimer = setInterval(() => void this.flush(), cfg.flushSeconds * 1000);
  }

  async stop(): Promise<void> {
    if (!this.isRunning()) return;
    this.enqueue("activity.session.ended", {}, `${this.sessionId}-end`);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.pollTimer = null;
    this.flushTimer = null;
    await this.flush();
    this.sessionId = null;
    this.wasIdle = false;
    this.lastApp = null;
  }

  private async poll(): Promise<void> {
    const cfg = getConfig();
    const idleSeconds = powerMonitor.getSystemIdleTime();

    if (idleSeconds >= cfg.idleThresholdSeconds) {
      if (!this.wasIdle) {
        this.wasIdle = true;
        this.idleStartedAt = Date.now() - idleSeconds * 1000;
      }
      return; // don't attribute app time while idle
    }

    if (this.wasIdle) {
      const idleDuration = Math.round((Date.now() - this.idleStartedAt) / 1000);
      this.enqueue("activity.idle.ended", { seconds: idleDuration });
      this.wasIdle = false;
    }

    const win = await activeWindow();
    const app = win?.owner?.name;
    if (!app) return;
    this.lastApp = app;

    // For browsers, resolve the active URL: prefer active-win's url (macOS), else
    // the browser extension's last report (any OS). Emit ONE event per poll so
    // app-time and site-time aren't both counted for the same interval.
    let url: string | null = null;
    if (isBrowser(app)) {
      url = win?.url ?? null;
      if (!url) {
        const tab = getLatestTab();
        if (tab && tab.focused && Date.now() - tab.receivedAt < cfg.tabFreshnessMs) url = tab.url;
      }
    }

    const domain = url ? hostOf(url) : null;
    if (url && domain) {
      this.enqueue("activity.website.visited", { domain, url, title: win?.title ?? null, seconds: cfg.pollSeconds });
    } else {
      this.enqueue("activity.app.used", { app, title: win?.title ?? null, seconds: cfg.pollSeconds });
    }
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const cfg = getConfig();
    const batch = this.queue.slice(0, cfg.maxBatch);
    const result = await uploadBatch(batch);
    if (result.ok) {
      this.queue.splice(0, batch.length);
      this.uploadedTotal += batch.length;
      this.lastFlushAt = new Date().toISOString();
      saveQueue(this.queue); // shrink the on-disk backlog after a successful upload
    }
    // On failure the batch stays queued (still persisted) and is retried on the next tick.
  }
}
