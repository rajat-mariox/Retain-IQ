/**
 * Electron main process. Owns the window, the tray, and the Collector lifecycle,
 * and exposes a small IPC surface to the renderer (login / start / stop / status).
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, powerMonitor, Tray, nativeImage } from "electron";
import { join, resolve } from "node:path";
import { Collector } from "./collector.js";
import {
  agentCheckIn,
  agentCheckOut,
  agentEndBreak,
  agentStartBreak,
  cancelCorrection,
  fetchAttendanceStatus,
  isTracked,
  login,
  loginWithLinkCode,
  myCorrections,
  requestCorrection,
  revokeCurrentSession,
  sendHeartbeat,
  type CorrectionRequest,
} from "./api.js";
import { clearSession, getConfig, getSession } from "./store.js";
import { startTabServer, stopTabServer } from "./tabserver.js";
import { startAttendanceStream, stopAttendanceStream } from "./attendance-stream.js";

const collector = new Collector();
let win: BrowserWindow | null = null;
let tray: Tray | null = null;

// ---- Single instance + retainiq:// links ----------------------------------
// The web panel opens `retainiq://login?code=…` (sign in with a one-time code) or
// `retainiq://open` (just bring the agent forward). Windows/Linux deliver the
// link as a command-line argument to a NEW process, so a single-instance lock
// forwards it to the running agent; macOS delivers it via `open-url`.
const PROTOCOL = "retainiq";
/** Launched by the OS at login: stay in the tray instead of popping the window. */
const startHidden = process.argv.includes("--hidden");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const link = findLink(argv);
    if (link) void handleLink(link);
    else showWindow();
  });
}

// macOS: the link arrives as an event (possibly before ready).
let pendingLink: string | null = findLink(process.argv);
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (app.isReady()) void handleLink(url);
  else pendingLink = url;
});

function findLink(argv: string[]): string | null {
  return argv.find((a) => a.toLowerCase().startsWith(`${PROTOCOL}://`)) ?? null;
}

/** Register retainiq:// with the OS. In dev, point it at this electron binary + app dir. */
function registerProtocol(): void {
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(PROTOCOL);
  } else if (process.argv[1]) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])]);
  }
}

/** Start with the OS so tracking doesn't depend on someone opening the app. */
function registerAutoStart(): void {
  // Installed app only: in dev this would register the bare electron binary.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
}

function showWindow(): void {
  if (!win) createWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

let linking = false;
async function handleLink(raw: string): Promise<void> {
  showWindow();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  // retainiq://login?code=… → host "login"; tolerate retainiq:///login too.
  const action = (url.host || url.pathname.replace(/^\/+/, "")).toLowerCase();
  if (action !== "login") return; // "open" (or anything else) just shows the window
  const code = url.searchParams.get("code");
  if (!code || linking) return;
  linking = true;
  try {
    const before = getSession();
    const session = await loginWithLinkCode(code, confirmSwitch);
    if (session && session !== before) await afterSignIn({ checkIn: false });
    pushAttendanceChanged(); // re-render (login view → status view)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign-in from the web panel failed.";
    void dialog.showMessageBox({ type: "warning", title: "RetainIQ Agent", message: "Couldn't sign in", detail: message });
  } finally {
    linking = false;
  }
}

/** Someone else is signed in here: ask, and close their day before switching. */
async function confirmSwitch(fromEmail: string, toEmail: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "RetainIQ Agent",
    message: `Switch account to ${toEmail}?`,
    detail: `The agent is signed in as ${fromEmail}. Switching checks ${fromEmail} out and signs them out of this computer.`,
    buttons: ["Switch account", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return false;
  await signOutCurrent();
  return true;
}

/** Stop everything for the current person and end their session. */
async function signOutCurrent(): Promise<void> {
  stopAttendanceStream();
  await collector.stop();
  await agentCheckOut();
  await revokeCurrentSession();
  clearSession();
}

/**
 * Common setup after any sign-in. A password sign-in at the agent IS arriving
 * at work, so it checks in. A sign-in from the web panel does NOT: opening the
 * panel isn't starting work. Tracking then follows the attendance state.
 */
async function afterSignIn({ checkIn }: { checkIn: boolean }): Promise<void> {
  void collector.replayPending(); // send anything buffered before this sign-in
  resetIdleClock();
  startAttendanceStream(onAttendanceEvent, (at) => void signOutIfBefore(at));
  void heartbeat();
  if (checkIn) await agentCheckIn();
  await syncTrackingWithAttendance();
}

/**
 * Monitoring runs only while the person is checked in and working, whether they
 * checked in here or in the web app. Checked out / not in yet / on a break →
 * stopped. Other states (leave, holiday, …) are left as they are.
 */
async function syncTrackingWithAttendance(): Promise<void> {
  if (!getSession()) return;
  const a = await fetchAttendanceStatus();
  if (!a || !a.tracksAttendance) return;
  if (a.state === "WORKING") {
    if (!collector.isRunning()) { collector.start(); resetIdleClock(); }
  } else if (["NOT_CHECKED_IN", "CHECKED_OUT", "COMPLETED", "ON_BREAK"].includes(a.state)) {
    if (collector.isRunning()) await collector.stop();
  }
}

/** An attendance change arrived on the live stream (from here or the web app). */
function onAttendanceEvent(): void {
  pushAttendanceChanged();
  void syncTrackingWithAttendance();
}

// Heartbeat: lets the web panel show "Agent connected".
setInterval(() => { if (getSession()) void heartbeat(); }, 60_000);

async function heartbeat(): Promise<void> {
  const { signOutBefore } = await sendHeartbeat();
  if (signOutBefore) await signOutIfBefore(signOutBefore);
}

/**
 * The person logged out of the web panel at `at`. If this agent signed in before
 * that, sign out (which checks them out) and close the app. An agent signed in
 * after that logout (they logged back in) is left alone.
 */
let remoteSigningOut = false;
async function signOutIfBefore(at: string): Promise<void> {
  const session = getSession();
  if (!session || remoteSigningOut) return;
  const signedIn = session.signedInAt ? Date.parse(session.signedInAt) : 0;
  if (!(signedIn < Date.parse(at))) return;
  remoteSigningOut = true;
  try {
    await signOutCurrent();
    if (Notification.isSupported()) {
      new Notification({ title: "RetainIQ Agent", body: "You logged out of the web panel, so the agent signed out and closed." }).show();
    }
  } finally {
    (app as unknown as { isQuitting?: boolean }).isQuitting = true;
    app.quit();
  }
}

/**
 * Live-sync: when an attendance change arrives on the SSE stream, tell the
 * renderer to re-read. This replaces the 3s poll as the primary signal; the
 * poll stays on at a slower cadence as a fallback if the stream is down.
 */
function pushAttendanceChanged(): void {
  win?.webContents.send("attendance:changed");
}

// ---- Idle auto-checkout ----------------------------------------------------
// One self-contained watcher owns the whole feature. A single 1-second timer reads
// the OS idle time and drives everything: below the warn threshold the overlay is
// hidden; between warn and checkout it shows the overlay + a live countdown; at the
// checkout threshold it auto-checks-out. No collector callbacks, no second timer,
// no renderer-side timer — so nothing can race, freeze, or dismiss early.
//
// Policy (org-configured, via collector.idleCheckoutPolicy()):
//   checkoutMinutes = 0  → feature off.
//   warnAfter  = (checkout - warn) minutes idle  → overlay appears, countdown = warn window.
//   checkoutAfter = checkout minutes idle        → auto check-out.

let idleTimer: NodeJS.Timeout | null = null;
let idleOverlayShown = false; // is the warning overlay currently up?
let checkingOut = false; // guard so a slow check-out isn't fired twice

// When the current idle stretch is counted FROM. Reset on login and whenever real
// activity is seen, so idle is measured within THIS session — not the OS's absolute
// idle time (which is already high right after login while the person reads/clicks
// elsewhere, and would otherwise pop the warning immediately).
let idleBaseAt = Date.now();
let lastOsIdle = 0; // last OS idle reading, to detect fresh activity

/** True once the user dismissed via "I'm still here"; cleared when they go active. */
let dismissedUntilActive = false;

/** Reset the idle clock — call on login and on any confirmed activity. */
function resetIdleClock(): void {
  idleBaseAt = Date.now();
  // Re-baseline the OS idle reference too, so the "fresh activity" detector in
  // idleTick doesn't compare against a stale pre-reset reading.
  lastOsIdle = powerMonitor.getSystemIdleTime();
  dismissedUntilActive = false;
  hideIdleWarning();
}

function hideIdleWarning(): void {
  if (!idleOverlayShown) return;
  idleOverlayShown = false;
  win?.webContents.send("idle:warn-clear");
}

/** Auto check-out AND sign out after the countdown lapses with no activity. */
async function doAutoCheckout(): Promise<void> {
  if (checkingOut) return;
  checkingOut = true;
  hideIdleWarning();
  try {
    const ok = await agentCheckOut();
    if (ok) pushAttendanceChanged();
    if (Notification.isSupported()) {
      new Notification({ title: "Signed out", body: "You were checked out and signed out automatically after being idle." }).show();
    }
    // Idle checkout also ends the session: stop tracking, drop the SSE stream and
    // the saved session so the agent returns to the login screen.
    stopAttendanceStream();
    await collector.stop();
    clearSession();
    win?.webContents.send("attendance:changed"); // renderer re-renders → login view
  } finally {
    checkingOut = false;
  }
}

/** Called by the renderer's "I'm still here" button. */
function idleStillHere(): void {
  resetIdleClock();
}

/**
 * The single 1-second idle tick. Effective idle = min(OS idle, time since the idle
 * clock was last reset). Fresh OS activity (idle dropped from last reading) resets
 * the clock, so any real mouse/keyboard use dismisses the warning immediately.
 */
function idleTick(): void {
  // Only while signed in + tracking; signed-out or paused → no warning.
  if (!getSession() || !collector.isRunning()) { hideIdleWarning(); return; }

  const { checkoutMinutes, warnMinutes } = collector.idleCheckoutPolicy();
  const checkoutAfter = checkoutMinutes * 60;
  if (checkoutAfter <= 0) { hideIdleWarning(); return; } // feature disabled

  const osIdle = powerMonitor.getSystemIdleTime(); // seconds since last real OS input
  // Fresh activity: OS idle dropped since last tick → the person just did something.
  if (osIdle < lastOsIdle) resetIdleClock();
  lastOsIdle = osIdle;

  // Idle measured within this session, and never more than the OS says.
  const sessionIdle = Math.floor((Date.now() - idleBaseAt) / 1000);
  const idle = Math.min(osIdle, sessionIdle);
  // The warning window is the last `warnMinutes` before checkout, but it must
  // never begin at (or before) 0 — otherwise a warn >= checkout misconfig would
  // pop the overlay the instant someone goes idle. Cap the window to < checkout
  // and guarantee a non-zero lead time.
  const warnWindow = Math.min(warnMinutes * 60, checkoutAfter - 1);
  const warnAfter = Math.max(1, checkoutAfter - warnWindow);

  // Active (below the warn point): hide any warning, allow re-warn later.
  if (idle < warnAfter) {
    dismissedUntilActive = false;
    hideIdleWarning();
    return;
  }

  // Past the checkout threshold → auto check-out + sign out.
  if (idle >= checkoutAfter) {
    void doAutoCheckout();
    return;
  }

  // In the warning window. Respect a manual dismissal until they're active again.
  if (dismissedUntilActive) return;

  const remaining = checkoutAfter - idle;
  if (!idleOverlayShown) {
    // First tick of this warning: raise the overlay + notification, bring to front.
    idleOverlayShown = true;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.setAlwaysOnTop(true);
      win.moveTop();
      win.focus();
      win.setAlwaysOnTop(false);
    }
    if (Notification.isSupported()) {
      new Notification({
        title: "You've been idle",
        body: `You'll be checked out in ${Math.max(1, Math.round(remaining / 60))} min unless you're active again.`,
      }).show();
    }
  }
  // Push the current countdown every tick (main is never timer-throttled).
  win?.webContents.send("idle:warn", { remainingSeconds: remaining });
}

function startIdleWatch(): void {
  if (idleTimer) return;
  lastOsIdle = powerMonitor.getSystemIdleTime();
  idleTimer = setInterval(idleTick, 1000);
  // When the org changes the idle timings in the portal, re-baseline the clock and
  // clear any warning so the new timings apply right away (no agent restart needed).
  collector.onIdlePolicyChange = () => { resetIdleClock(); hideIdleWarning(); };
}

function createWindow(): void {
  win = new BrowserWindow({
    show: !startHidden,
    width: 420,
    height: 560,
    resizable: false,
    title: "RetainIQ Agent",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The agent lives in the tray, so its window is usually hidden/backgrounded.
      // Chromium throttles renderer timers in background windows, which froze the
      // idle-warning countdown (setInterval barely ticked). Keep timers running so
      // the countdown ticks smoothly even when the window isn't focused.
      backgroundThrottling: false,
    },
  });
  void win.loadFile(join(__dirname, "../src/renderer/index.html"));
  win.on("close", (e) => {
    // Keep running in the tray instead of quitting.
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

function buildTray(): void {
  tray = new Tray(nativeImage.createEmpty());
  const refresh = () => {
    const s = collector.status();
    tray?.setToolTip(`RetainIQ Agent — ${s.running ? "tracking" : "idle"}`);
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: s.running ? "Tracking active" : "Not tracking", enabled: false },
        { type: "separator" },
        { label: "Open", click: () => showWindow() },
        {
          label: s.running ? "Pause tracking" : "Resume tracking",
          click: async () => {
            if (s.running) await collector.stop();
            else if (getSession()) collector.start();
            refresh();
          },
        },
        { type: "separator" },
        {
          label: "Quit",
          click: async () => {
            (app as unknown as { isQuitting?: boolean }).isQuitting = true;
            await collector.stop();
            app.quit();
          },
        },
      ]),
    );
  };
  refresh();
  setInterval(refresh, 5000);
}

// ---- IPC ----
ipcMain.handle("agent:session", () => getSession());
ipcMain.handle("agent:status", () => collector.status());
// "I'm still here": cancel the pending auto-checkout and reset idle state so the
// warning doesn't re-appear until they're actually active again.
ipcMain.handle("agent:idle-still-here", () => {
  idleStillHere();
});
ipcMain.handle("agent:login", async (_e, email: string, password: string, remember: boolean) => {
  const session = await login(email, password, remember !== false);
  // Signing in at the agent IS arriving at work: check in, then track. Awaited
  // so the first render already shows the right state.
  await afterSignIn({ checkIn: true });
  return session;
});

// ---- attendance (kept in step with the web app; the server is the source of truth) ----
ipcMain.handle("agent:attendance", () => fetchAttendanceStatus());
ipcMain.handle("agent:check-in", async () => {
  await agentCheckIn();
  await syncTrackingWithAttendance(); // checked in → start tracking
  return fetchAttendanceStatus();
});
ipcMain.handle("agent:check-out", async () => {
  await agentCheckOut();
  await syncTrackingWithAttendance(); // checked out → stop tracking
  return fetchAttendanceStatus();
});
ipcMain.handle("agent:break-start", async (_e, kind?: string) => {
  await agentStartBreak(kind || "BREAK");
  await collector.stop(); // don't record activity while on a break
  return fetchAttendanceStatus();
});
ipcMain.handle("agent:break-end", async () => {
  await agentEndBreak();
  if (getSession()) collector.start();
  return fetchAttendanceStatus();
});

// ---- attendance corrections (employee side; the approver decides in the web app) ----
ipcMain.handle("agent:corrections", () => myCorrections());
ipcMain.handle("agent:correction-request", (_e, body: CorrectionRequest) => requestCorrection(body));
ipcMain.handle("agent:correction-cancel", (_e, id: string) => cancelCorrection(id));
ipcMain.handle("agent:start", () => {
  if (getSession()) { collector.start(); resetIdleClock(); }
  return collector.status();
});
ipcMain.handle("agent:stop", async () => {
  await collector.stop();
  return collector.status();
});
ipcMain.handle("agent:logout", async () => {
  stopAttendanceStream();
  await collector.stop();
  await agentCheckOut(); // close the day before the session is dropped
  await revokeCurrentSession();
  clearSession();
  return true;
});

void app.whenReady().then(async () => {
  if (!gotLock) return; // a second copy only forwards its link, then quits
  registerProtocol();
  registerAutoStart();
  startTabServer(getConfig().tabServerPort); // receive active-tab URLs from the browser extension
  createWindow();
  buildTray();
  startIdleWatch(); // the single 1-second idle-warning/auto-checkout watcher
  if (getSession() && !(await isTracked())) {
    // A remembered session for someone who isn't tracked (e.g. an Owner signed
    // in before the agent refused them): drop it rather than run an empty agent.
    await revokeCurrentSession();
    clearSession();
    pushAttendanceChanged();
  }
  if (getSession()) {
    // Relaunching with a remembered session is the same as arriving at work —
    // without this, someone whose agent auto-starts each morning would never be
    // marked present. Check-in is idempotent, so a same-day restart is a no-op.
    void afterSignIn({ checkIn: true });
  }
  if (pendingLink) {
    const link = pendingLink;
    pendingLink = null;
    void handleLink(link);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Stay resident in the tray (don't quit on window close), except on explicit quit.
});

// Quitting the agent ends the working day too — not just an explicit sign-out —
// so closing the laptop lid on the app doesn't leave the day hanging open.
// `before-quit` is async-hostile, so hold the quit until check-out is away.
let checkoutOnQuitDone = false;
app.on("before-quit", (event) => {
  (app as unknown as { isQuitting?: boolean }).isQuitting = true;
  stopAttendanceStream();
  if (checkoutOnQuitDone || !getSession()) {
    stopTabServer();
    return;
  }
  event.preventDefault();
  void (async () => {
    try {
      await collector.stop();
      await agentCheckOut();
    } catch {
      // The 1AM missed-checkout sweep is the safety net if this can't land.
    } finally {
      checkoutOnQuitDone = true;
      stopTabServer();
      app.quit();
    }
  })();
});
