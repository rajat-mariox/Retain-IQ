/**
 * Electron main process. Owns the window, the tray, and the Collector lifecycle,
 * and exposes a small IPC surface to the renderer (login / start / stop / status).
 */
import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from "electron";
import { join } from "node:path";
import { Collector } from "./collector.js";
import { login } from "./api.js";
import { clearSession, getConfig, getSession } from "./store.js";
import { startTabServer, stopTabServer } from "./tabserver.js";

const collector = new Collector();
let win: BrowserWindow | null = null;
let tray: Tray | null = null;

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
ipcMain.handle("agent:login", async (_e, email: string, password: string) => {
  const session = await login(email, password);
  void collector.replayPending(); // send anything buffered before this login
  collector.start(); // auto-start tracking after login
  return session;
});
ipcMain.handle("agent:start", () => {
  if (getSession()) collector.start();
  return collector.status();
});
ipcMain.handle("agent:stop", async () => {
  await collector.stop();
  return collector.status();
});
ipcMain.handle("agent:logout", async () => {
  await collector.stop();
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
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Stay resident in the tray (don't quit on window close), except on explicit quit.
});

app.on("before-quit", () => {
  (app as unknown as { isQuitting?: boolean }).isQuitting = true;
  stopTabServer();
});
