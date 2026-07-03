import { contextBridge, ipcRenderer } from "electron";

/** Minimal, safe API surface for the renderer (contextIsolation on). */
contextBridge.exposeInMainWorld("agent", {
  session: () => ipcRenderer.invoke("agent:session"),
  status: () => ipcRenderer.invoke("agent:status"),
  login: (email: string, password: string, remember: boolean) => ipcRenderer.invoke("agent:login", email, password, remember),
  start: () => ipcRenderer.invoke("agent:start"),
  stop: () => ipcRenderer.invoke("agent:stop"),
  logout: () => ipcRenderer.invoke("agent:logout"),
});
