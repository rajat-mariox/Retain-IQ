/**
 * Electron main process. Owns the window, the tray, and the Collector lifecycle,
 * and exposes a small IPC surface to the renderer (login / start / stop / status).
 */
import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from "electron";
import { join } from "node:path";
import { Collector } from "./collector.js";
import {
  agentCheckIn,
  agentCheckOut,
  agentEndBreak,
  agentStartBreak,
  cancelCorrection,
  fetchAttendanceStatus,
  login,
  myCorrections,
  requestCorrection,
  type CorrectionRequest,
} from "./api.js";
import { clearSession, getConfig, getSession } from "./store.js";
import { startTabServer, stopTabServer } from "./tabserver.js";
import { startAttendanceStream, stopAttendanceStream } from "./attendance-stream.js";

const collector = new Collector();
let win: BrowserWindow | null = null;
let tray: Tray | null = null;

/**
 * Live-sync: when an attendance change arrives on the SSE stream, tell the
 * renderer to re-read. This replaces the 3s poll as the primary signal; the
 * poll stays on at a slower cadence as a fallback if the stream is down.
 */
function pushAttendanceChanged(): void {
  win?.webContents.send("attendance:changed");
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    title: "RetainIQ Agent",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
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
        { label: "Open", click: () => (win ? win.show() : createWindow()) },
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
ipcMain.handle("agent:login", async (_e, email: string, password: string, remember: boolean) => {
  const session = await login(email, password, remember !== false);
  void collector.replayPending(); // send anything buffered before this login
  collector.start(); // auto-start tracking after login
  startAttendanceStream(pushAttendanceChanged); // live-sync attendance changes
  // Signing in to the agent IS arriving at work: mark the employee present.
  // Awaited so the first render already shows the right state rather than
  // flashing "not checked in". Owners aren't tracked — a 403 here is expected.
  await agentCheckIn();
  return session;
});

// ---- attendance (kept in step with the web app; the server is the source of truth) ----
ipcMain.handle("agent:attendance", () => fetchAttendanceStatus());
ipcMain.handle("agent:check-in", async () => {
  await agentCheckIn();
  return fetchAttendanceStatus();
});
ipcMain.handle("agent:check-out", async () => {
  await agentCheckOut();
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
  if (getSession()) collector.start();
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
  clearSession();
  return true;
});

void app.whenReady().then(() => {
  startTabServer(getConfig().tabServerPort); // receive active-tab URLs from the browser extension
  createWindow();
  buildTray();
  if (getSession()) {
    void collector.replayPending(); // upload anything left over from a previous run
    collector.start(); // resume tracking on relaunch
    startAttendanceStream(pushAttendanceChanged); // resume live-sync too
    // Relaunching with a remembered session is the same as arriving at work —
    // without this, someone whose agent auto-starts each morning would never be
    // marked present. Check-in is idempotent, so a same-day restart is a no-op.
    void agentCheckIn();
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
