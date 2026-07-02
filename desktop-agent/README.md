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
| `activity.idle.ended` | `powerMonitor.getSystemIdleTime()` | on return from idle |

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

## Packaging

```bash
npm run package    # electron-builder → release/
```

## Not yet included (roadmap)

- Screenshot capture (the platform already stores screenshots in S3/MinIO; the
  agent would use `desktopCapturer` + a signed-upload endpoint).
- Break start/stop and focus-block detection.
- Firefox build of the browser extension (Chromium is packaged today).
