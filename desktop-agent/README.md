# RetainIQ Desktop Agent

An **independent** Electron app that captures work activity (active application,
website, idle time, work sessions) and streams it to the RetainIQ backend. It is
intentionally self-contained — its own `package.json`, build, and dependencies —
so it can be developed, versioned, and shipped separately from the backend/web
monorepo.

## How it fits the platform

```
desktop-agent (Electron)
    │  POST /v1/ingest/activity   (Bearer = employee access token)
    ▼
activity-ingestion service ──publish──▶ broker "activity" stream
                                             │
                                             ▼
                              analytics-service (worker)
                                 ├─ EmployeeDayFact (rollup + scores)
                                 └─ WorkSession / AppUsageDaily /
                                    WebsiteUsageDaily / ActivityEvent (detail)
                                             │
                                             ▼
                              identity-service  GET /v1/monitoring/*
                                             │
                                             ▼
                                   org-web  → Monitoring UI
```

The agent only needs two backend URLs and an employee's credentials. It performs
no direct database access.

## Run (development)

```bash
cd desktop-agent
npm install
npm start          # builds TS then launches Electron
```

Point it at your stack (defaults shown):

```bash
RETAINIQ_IDENTITY_URL=http://localhost:3001 \
RETAINIQ_INGESTION_URL=http://localhost:3002 \
npm start
```

Sign in with an org employee (e.g. a member of your org). The agent resolves the
`employeeId` via `/v1/auth/me`, starts a work session, and begins sampling.

## What it captures

| Event | Source | Interval |
|-------|--------|----------|
| `activity.session.started/ended` | app launch / quit | once per run |
| `activity.app.used` | foreground app (`active-win`) | every `pollSeconds` (15s) |
| `activity.website.visited` | active browser URL | every `pollSeconds` |
| `activity.idle.started` | idle threshold crossed | on going idle |
| `activity.idle.ended` | `powerMonitor.getSystemIdleTime()` | on return from idle |
| `activity.context_switch.recorded` | active app/site changed | on each switch |
| `activity.focus.block.completed` | ≥`focusBlockMinSeconds` on one app/site | when the stretch ends |

For each poll the agent emits **one** event: a `website.visited` when the active
window is a browser and the current URL is known, otherwise an `app.used`. This
avoids double-counting app-time and site-time for the same interval.

### Website tracking (all platforms)

`active-win` only exposes a browser's URL on macOS. To capture websites on
**Windows/Linux** too, install the companion **[browser extension](./browser-extension/)**:
it reports the active tab's URL to a loopback receiver the agent runs on
`127.0.0.1:<tabServerPort>` (default 7317). The agent prefers the OS-reported URL
(macOS) and falls back to the extension's report (any OS). Websites are then
classified **productive / neutral / distracting** by the analytics worker.

Events are queued and uploaded in batches every `flushSeconds` (30s); a failed
upload is retried on the next tick, and a 401 triggers a token refresh.

## Configuration

Environment variables (or a saved `agent-state.json` under Electron's userData):

| Var | Default | Meaning |
|-----|---------|---------|
| `RETAINIQ_IDENTITY_URL` | `http://localhost:3001` | identity-service base |
| `RETAINIQ_INGESTION_URL` | `http://localhost:3002` | activity-ingestion base |
| `RETAINIQ_POLL_SECONDS` | `15` | active-window / idle sample rate |
| `RETAINIQ_FLUSH_SECONDS` | `30` | upload batch interval |
| `RETAINIQ_IDLE_SECONDS` | `300` | no-input duration that counts as idle |
| `RETAINIQ_FOCUS_BLOCK_SECONDS` | `300` | uninterrupted time on one app/site to count as a focus block |
| `RETAINIQ_MAX_QUEUE` | `10000` | cap on locally-buffered events (oldest dropped beyond this) |
| `RETAINIQ_TAB_PORT` | `7317` | loopback port the browser extension reports tabs to |
| `RETAINIQ_POLICY_SECONDS` | `300` | how often to re-fetch the org monitoring policy |

## Packaging

```bash
npm run package    # electron-builder → release/
```

## Screenshots

When `screenshotEnabled` is on (default), the agent captures **every connected
display** every `screenshotIntervalSeconds` (10 min) while tracking (including
idle time, so away-from-desk activity is still captured):
`desktopCapturer` → downscaled JPEG per screen → `POST /v1/storage/screenshots`
reserves quota + returns a presigned URL → the bytes are PUT directly to object
storage → one `activity.screenshot.captured` event per display is logged on the
timeline, tagged with a `display` index. If the org has screenshots disabled or
is over quota, the request is refused and the agent simply skips (no retries
spam). macOS needs Screen-Recording permission.

> Multi-monitor note: N displays produce N images per interval, each reserving
> its own quota. Whatever uploads is kept even if a later screen is refused.

Config: `RETAINIQ_SCREENSHOTS` (true/false), `RETAINIQ_SCREENSHOT_SECONDS`,
`RETAINIQ_SCREENSHOT_WIDTH`, `RETAINIQ_SCREENSHOT_QUALITY`.

## Not yet included (roadmap)

- Real-time push sync (the agent polls status every 3s; the backend has a
  realtime publisher but no agent-facing stream endpoint yet).
- Auto-update, code-signing/notarization, and per-OS release builds.

See [ROADMAP.md](./ROADMAP.md) for the full plan. Break start/stop, break-kind
selection, multi-monitor capture, overtime display, attendance corrections
(request / view / withdraw), and idle-onset / focus-block / context-switch
signals are now implemented.
