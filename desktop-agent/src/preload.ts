import { contextBridge, ipcRenderer } from "electron";

/** Minimal, safe API surface for the renderer (contextIsolation on). */
contextBridge.exposeInMainWorld("agent", {
  session: () => ipcRenderer.invoke("agent:session"),
  status: () => ipcRenderer.invoke("agent:status"),
  login: (email: string, password: string, remember: boolean) => ipcRenderer.invoke("agent:login", email, password, remember),
  start: () => ipcRenderer.invoke("agent:start"),
  stop: () => ipcRenderer.invoke("agent:stop"),
  logout: () => ipcRenderer.invoke("agent:logout"),
  // Attendance — the same record the web app writes to.
  attendance: () => ipcRenderer.invoke("agent:attendance"),
  checkIn: () => ipcRenderer.invoke("agent:check-in"),
  checkOut: () => ipcRenderer.invoke("agent:check-out"),
  breakStart: (kind?: string) => ipcRenderer.invoke("agent:break-start", kind),
  breakEnd: () => ipcRenderer.invoke("agent:break-end"),
  // Attendance corrections — raise a fix for a mis-recorded day; approval is web-only.
  corrections: () => ipcRenderer.invoke("agent:corrections"),
  requestCorrection: (body: unknown) => ipcRenderer.invoke("agent:correction-request", body),
  cancelCorrection: (id: string) => ipcRenderer.invoke("agent:correction-cancel", id),
  // Live-sync: the main process pushes this when an attendance change arrives on
  // the SSE stream, so the renderer refreshes at once instead of waiting to poll.
  onAttendanceChanged: (fn: () => void) => ipcRenderer.on("attendance:changed", () => fn()),
});
