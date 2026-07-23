/**
 * Samples the active window and system idle time on an interval, turning them
 * into RetainIQ activity events, and flushes the queue to the ingestion service.
 * A single work session spans start→stop; app/website/idle events carry its id.
 */
import { randomUUID } from "node:crypto";
import { powerMonitor } from "electron";
import { getConfig, getSession, loadQueue, saveQueue } from "./store.js";
import { uploadBatch, fetchPolicy, type ActivityEvent, type MonitoringPolicy } from "./api.js";
import { getLatestTab } from "./tabserver.js";
import { captureAndUpload } from "./screenshot.js";

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
  screenshotsEnabled: boolean;
  lastScreenshotAt: string | null;
}

export class Collector {
  // Restored from disk on launch so events survive a crash / force-quit.
  private queue: ActivityEvent[] = loadQueue<ActivityEvent>();
  private sessionId: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private shotTimer: NodeJS.Timeout | null = null;
  private policyTimer: NodeJS.Timeout | null = null;
  private policy: MonitoringPolicy | null = null;
  private wasIdle = false;
  private idleStartedAt = 0;
  private lastApp: string | null = null;
  // Focus tracking: what the person is currently focused on (an app name or a
  // domain) and when that stretch began. A change is a context switch; a long
  // enough stretch, once it ends, is a completed focus block.
  private focusTarget: string | null = null;
  private focusStartedAt = 0;
  private lastFlushAt: string | null = null;
  private uploadedTotal = 0;
  private lastScreenshotAt: string | null = null;

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
      screenshotsEnabled: this.effShots().enabled,
      lastScreenshotAt: this.lastScreenshotAt,
    };
  }

  /** Effective screenshot settings: server policy wins, else local config fallback. */
  private effShots() {
    const c = getConfig();
    return {
      enabled: this.policy?.screenshotsEnabled ?? c.screenshotEnabled,
      interval: this.policy?.screenshotIntervalSeconds ?? c.screenshotIntervalSeconds,
      quality: this.policy?.screenshotQuality ?? c.screenshotQuality,
      width: this.policy?.screenshotMaxWidth ?? c.screenshotMaxWidth,
    };
  }

  private restartShotTimer(): void {
    if (this.shotTimer) clearInterval(this.shotTimer);
    this.shotTimer = null;
    const eff = this.effShots();
    if (this.isRunning() && eff.enabled) this.shotTimer = setInterval(() => void this.captureScreenshot(), eff.interval * 1000);
  }

  /** Re-fetch the org policy; re-pace the screenshot timer if enabled/interval changed. */
  private async refreshPolicy(): Promise<void> {
    const before = this.effShots();
    const p = await fetchPolicy();
    if (p) this.policy = p;
    const after = this.effShots();
    if (before.enabled !== after.enabled || before.interval !== after.interval) this.restartShotTimer();
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

  /**
   * Capture + upload a screenshot of every display (even while idle), then log
   * each on the timeline. A multi-monitor setup produces one event per screen,
   * tagged with its display index so they can be told apart.
   */
  private async captureScreenshot(): Promise<void> {
    if (!this.isRunning()) return;
    const eff = this.effShots();
    if (!eff.enabled) return;
    const shots = await captureAndUpload(eff.width, eff.quality);
    if (shots.length > 0) {
      this.lastScreenshotAt = new Date().toISOString();
      for (const shot of shots) {
        this.enqueue("activity.screenshot.captured", {
          objectKey: shot.key,
          display: shot.display,
          displayCount: shot.displayCount,
        });
      }
    }
  }

  start(): void {
    if (this.isRunning()) return;
    const cfg = getConfig();
    this.sessionId = `sess-${Date.now()}-${randomUUID().slice(0, 8)}`;
    this.enqueue("activity.session.started", {}, `${this.sessionId}-start`);
    this.pollTimer = setInterval(() => void this.poll(), cfg.pollSeconds * 1000);
    this.flushTimer = setInterval(() => void this.flush(), cfg.flushSeconds * 1000);
    this.restartShotTimer(); // starts with the current (fallback) cadence
    void this.refreshPolicy(); // then pull the org's policy, which may re-pace it
    this.policyTimer = setInterval(() => void this.refreshPolicy(), cfg.policyRefreshSeconds * 1000);
  }

  async stop(): Promise<void> {
    if (!this.isRunning()) return;
    this.endFocusBlock(); // don't lose a block in progress when tracking stops
    this.enqueue("activity.session.ended", {}, `${this.sessionId}-end`);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.shotTimer) clearInterval(this.shotTimer);
    if (this.policyTimer) clearInterval(this.policyTimer);
    this.pollTimer = null;
    this.flushTimer = null;
    this.shotTimer = null;
    this.policyTimer = null;
    await this.flush();
    this.sessionId = null;
    this.wasIdle = false;
    this.lastApp = null;
    this.focusTarget = null;
    this.focusStartedAt = 0;
  }

  private async poll(): Promise<void> {
    const cfg = getConfig();
    const idleSeconds = powerMonitor.getSystemIdleTime();

    if (idleSeconds >= cfg.idleThresholdSeconds) {
      if (!this.wasIdle) {
        this.wasIdle = true;
        this.idleStartedAt = Date.now() - idleSeconds * 1000;
        // Going idle interrupts whatever they were focused on.
        this.endFocusBlock();
        this.focusTarget = null;
        // Mark the onset so the timeline shows exactly when idle began. Carries
        // seconds:0 — the matching idle.ended holds the full duration, and the
        // scorer adds idleSeconds from BOTH, so a non-zero here would double it.
        this.enqueue("activity.idle.started", { seconds: 0, at: new Date(this.idleStartedAt).toISOString() });
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

    // Focus tracking runs off the same sample: the "target" is the domain when
    // on a site, else the app. Switching targets closes any qualifying focus
    // block and records a context switch.
    this.trackFocus(domain ?? app);
  }

  /**
   * Update focus state for the current target (a domain or an app name).
   * Unchanged → the block keeps growing. Changed → close the previous block if
   * it was long enough, record the switch, and start a new block.
   */
  private trackFocus(target: string): void {
    if (this.focusTarget === null) {
      this.focusTarget = target;
      this.focusStartedAt = Date.now();
      return;
    }
    if (target === this.focusTarget) return; // same thing — block continues

    this.endFocusBlock();
    this.enqueue("activity.context_switch.recorded", { from: this.focusTarget, to: target });
    this.focusTarget = target;
    this.focusStartedAt = Date.now();
  }

  /**
   * Close the current focus stretch. If it lasted at least the configured
   * threshold, emit a completed focus block with its duration. Called on a
   * context switch, when going idle, and on stop, so a block is never left open.
   */
  private endFocusBlock(): void {
    // focusTarget === null is the sole "nothing in progress" signal; don't gate
    // on focusStartedAt, which is a real timestamp and could legitimately be 0.
    if (this.focusTarget === null) return;
    const seconds = Math.round((Date.now() - this.focusStartedAt) / 1000);
    if (seconds >= getConfig().focusBlockMinSeconds) {
      this.enqueue("activity.focus.block.completed", { target: this.focusTarget, seconds });
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
