/*
 * RetainIQ Activity Reporter — background script.
 *
 * Sends the active tab's URL to the local desktop agent whenever it changes
 * (tab switch, navigation, window focus) and on a periodic heartbeat so a
 * long-lived tab stays "current". If the agent isn't running, posts fail
 * silently. Only the URL/title are sent, and only to 127.0.0.1 (localhost).
 *
 * Works in Chromium (Chrome/Edge/Brave) and Firefox: `browser` is used when
 * present (Firefox, promise-based), else `chrome` (Chromium MV3, promise-based).
 */
const api = typeof browser !== "undefined" ? browser : chrome;
const AGENT_URL = "http://127.0.0.1:7317/tab";

async function reportActiveTab() {
  try {
    const tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || typeof tab.url !== "string" || !/^https?:\/\//.test(tab.url)) return;
    await fetch(AGENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tab.url, title: tab.title || null, focused: true }),
    });
  } catch (_e) {
    // Agent not running / not reachable — ignore.
  }
}

api.tabs.onActivated.addListener(() => reportActiveTab());
api.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === "complete" && tab.active) reportActiveTab();
});
api.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === api.windows.WINDOW_ID_NONE) return; // browser lost focus
  reportActiveTab();
});

// Heartbeat: keeps the current tab fresh while the user stays on one page.
const arm = () => api.alarms.create("heartbeat", { periodInMinutes: 0.5 });
api.runtime.onInstalled.addListener(arm);
api.runtime.onStartup.addListener(arm);
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "heartbeat") reportActiveTab();
});
