# RetainIQ Activity Reporter (browser extension)

Reports the **active tab's URL** to the local RetainIQ desktop agent so website
activity is tracked on **every OS** (not just macOS). The agent runs a loopback
receiver on `127.0.0.1:7317`; this extension POSTs the current URL there on tab
switches, navigation, window focus, and a 30-second heartbeat.

Only the URL and page title are sent, and only to `localhost` — nothing leaves
the machine from this extension.

## Load it (Chrome / Edge / Brave)

1. Make sure the desktop agent is running (it opens the loopback receiver).
2. Go to `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this `browser-extension/` folder.

## Load it (Firefox)

Use the sibling **`../browser-extension-firefox/`** folder (Firefox needs an
event-page background + a gecko id; the logic is identical).

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select **`browser-extension-firefox/manifest.json`**.

That's it — browse normally and the agent will start emitting
`activity.website.visited` events with the real domain/URL. You can confirm it's
working from the agent window: the **Current site** row updates as you browse.

## How it fits together

```
Browser tab changes
   │  POST http://127.0.0.1:7317/tab  { url, title }
   ▼
Desktop agent (tabserver) ── collector reads current URL when the
                              active OS window is a browser
   │  activity.website.visited { domain, url, seconds }
   ▼
activity-ingestion → analytics-worker → WebsiteUsageDaily (+ category) → Monitoring UI
```

## Notes

- Port must match the agent's `tabServerPort` (default **7317**; override with
  `RETAINIQ_TAB_PORT`). If you change it, update `AGENT_URL` in `background.js`.
- Firefox: works with minor manifest tweaks (uses the same APIs under the
  `browser.*` namespace); packaged here for Chromium browsers.
- Incognito/private windows are excluded unless you explicitly allow the
  extension there.
