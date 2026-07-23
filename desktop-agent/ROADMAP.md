# Desktop-Agent — Remaining Work Plan

Audit-derived plan for the desktop-agent's outstanding scope. Ordered into
phases by **value ÷ effort** and **dependency**: the quick, self-contained,
backend-ready wins first; the release/infra work last because it is the largest
and gates actual distribution.

Legend — **Agent-only**: backend already supports it, only agent work needed.
**Both sides**: needs backend/infra work too.

---

## Phase 1 — Quick wins (agent-only, backend already ready)

Small, self-contained, no backend changes. Each is independently shippable.

### 1.1 Break-kind selection
- **Problem:** agent hardcodes `breakStart("BREAK")` (`renderer.js:131`, IPC default `main.ts:99`); backend persists any `kind` and the web app already offers LUNCH / TEA / PERSONAL / MEETING / OTHER (`CheckInOut.tsx:57`).
- **Do:** add a small kind picker (dropdown or button row) in the agent's break UI, reuse the web app's five kinds for parity, pass the chosen kind through the existing `breakStart(kind)` IPC — the bridge already accepts it (`preload.ts:15`).
- **Touches:** `renderer/index.html`, `renderer/renderer.js`. No main/api/backend change.
- **Effort:** ~S. **Risk:** low.

### 1.2 Multi-monitor screenshot capture
- **Problem:** `screenshot.ts:12-18` captures `getPrimaryDisplay()` only; `desktopCapturer.getSources` already enumerates every screen.
- **Do:** capture all `types:["screen"]` sources, upload each as its own image (the quota reserve + presigned PUT flow is already per-image, `api.ts:141-160`), tag each with a display index in the event/key so the UI can tell them apart.
- **Decision needed:** per-display quota cost — N monitors = N images per interval. Confirm that's acceptable, or cap to a configurable max displays.
- **Touches:** `screenshot.ts`, `collector.ts` (screenshot tick), possibly the timeline event shape.
- **Effort:** ~S–M. **Risk:** low (quota already guards spend).

### 1.3 Overtime visibility in the agent
- **Problem:** the agent already carries `overtimeMinutes` in its `AttendanceStatus` type (`api.ts:81`) but never renders it (`renderer.js` shows only state/in/out/break).
- **Do:** surface today's overtime (and approved-overtime, if present in status) as a read-only line in the attendance card. No new endpoint — it's already in the status payload.
- **Touches:** `renderer/renderer.js`, `renderer/index.html`.
- **Effort:** ~S. **Risk:** low. (Foundation for 2.1.)

---

## Phase 2 — Attendance corrections (agent-only, backend ready, higher value)

The single highest-value gap: a missed/incorrect punch can't be fixed from the
agent today, even though the backend has the whole surface.

### 2.1 Correction request + status in the agent
- **Backend already exists:** `POST /attendance/corrections`, `GET /corrections/me`,
  `POST /corrections/:id/cancel` (`attendance.controller.ts:82-137`).
- **Do:**
  - Add `requestCorrection(payload)`, `myCorrections()`, `cancelCorrection(id)` to `api.ts`, then to the IPC bridge (`main.ts` handlers + `preload.ts`).
  - Add a small "Request a fix" form in the renderer: type (missed check-in / missed check-out / wrong time / overtime / other), the requested time(s), a reason — mirroring the web app's `MyCorrections.tsx` fields so behaviour matches.
  - List the employee's pending/decided corrections with a cancel action on pending ones.
- **Explicitly out of scope for the agent:** the *approval* side (manager decisions, overtime sign-off) stays in the web app — the agent is the employee's client, not the approver's.
- **Touches:** `api.ts`, `main.ts`, `preload.ts`, `renderer/*`.
- **Effort:** ~M. **Risk:** low–med (form validation must match backend's session-aware rules; reuse the web app's messages).

---

## Phase 3 — Richer local signals (agent-only, ingestion contract ready)

The ingestion schema already accepts these event types
(`activity-ingestion .../events.ts:59,64-65`); the analytics worker will roll
them up. Pure agent-side compute.

### 3.1 Emit `activity.idle.started`
- Today only `idle.ended` is emitted; idle onset is inferred from the gap. Emitting the start makes idle spans exact.
- **Touches:** `collector.ts` (idle transition detection).
- **Effort:** ~S.

### 3.2 Focus-block & context-switch detection
- Compute focus blocks (sustained same-app/site stretches) and context-switch counts locally, emit `activity.focus.block.completed` / `activity.context_switch.recorded`.
- **Touches:** `collector.ts` (running window over polls). Needs a small design for the block/switch heuristic.
- **Effort:** ~M. **Risk:** med (heuristic tuning; make thresholds configurable).

---

## Phase 4 — Real-time sync (both sides)

### 4.1 Replace 3s polling with a push channel
- **Problem:** the renderer polls `/attendance/status` every 3s (`renderer.js:173`) + a 5s tray refresh (`main.ts:72`). The backend has a `RealtimePublisher` (`attendance.service.ts:7`) the agent can't consume — there is no agent-facing subscribe endpoint.
- **Do:** expose an SSE/WebSocket status stream on the backend for the authenticated employee, consume it in the agent, and fall back to polling if the stream drops. Keeps the server as source of truth while cutting steady-state request volume.
- **Touches:** backend (new stream endpoint), `api.ts`, `main.ts`.
- **Effort:** ~M–L. **Risk:** med. **Do only after Phase 1–2** — polling works fine; this is an efficiency upgrade, not a gap.

---

## Phase 5 — Distribution & release-grade packaging (both sides / infra)

Largest and most important for real deployment, but it gates on decisions
(signing certs, update host) that are ops/business calls, not code.

### 5.1 Per-OS build targets
- `package.json` build block has appId/files only — no `mac`/`win`/`linux` targets.
- **Do:** add electron-builder targets (nsis for Windows, dmg/zip for macOS, AppImage/deb for Linux), plus icons and per-OS metadata.
- **Effort:** ~M.

### 5.2 Code signing & notarization
- Without signing, macOS Gatekeeper and Windows SmartScreen block installs.
- **Decision needed (business/ops):** Apple Developer ID cert + notarization, Windows code-signing cert. Cannot be done without these credentials.
- **Effort:** ~M once certs exist. **Blocked on:** procurement of certificates.

### 5.3 Auto-update
- **Problem:** nothing exists (`autoUpdater`/`electron-updater` absent). Critical for a fleet you can't reinstall by hand.
- **Do:** integrate `electron-updater`, publish releases to an update feed (GitHub Releases or a private S3/generic feed), wire the check-on-launch + apply-on-quit flow.
- **Depends on:** 5.1 + 5.2 (updates must be signed).
- **Effort:** ~M. **Both sides:** needs the hosted feed/release infra.

### 5.4 Agent CI pipeline
- No CI for the agent (no workflow builds/tests it). Add a workflow that builds + runs tests on push, and (later) produces signed release artifacts.
- **Effort:** ~S–M.

---

## Phase 6 — Test coverage (agent-only)

Only `test/renderer-flow.test.mjs` exists. Add unit tests for the untested core:
- `collector` — poll → event shaping, idle transitions, screenshot cadence.
- `api` — 401 → refresh-and-retry, batch upload.
- `store` — queue persistence/restore across restart, cap/drop-oldest.
- `screenshot` — capture-null on denied permission, multi-display (after 1.2).
- attendance IPC — check-in/out/break flows.
- **Effort:** ~M, incremental. Pairs naturally with each feature above (add tests as you touch each module).

---

## Housekeeping (do alongside)

- **README is stale:** the "Not yet included" roadmap still lists break start/stop
  as missing though it's fully built; only break-kind selection and focus-block
  remain. Undocumented env vars: `RETAINIQ_MAX_QUEUE`, `RETAINIQ_TAB_PORT`,
  `RETAINIQ_POLICY_SECONDS`. The Firefox extension folder isn't mentioned in the
  main README. Update as features land.

---

## Suggested execution order

1. **Phase 1** (break kinds, multi-monitor, overtime line) — a day of small wins, immediate visible value.
2. **Phase 2** (corrections) — the highest-value real gap; backend is ready.
3. **Phase 3** (idle-start, focus blocks) — richer analytics with no backend change.
4. **Phase 6 tests** folded into 1–3 as each module is touched.
5. **Phase 4** (push sync) — efficiency, once the feature set is stable.
6. **Phase 5** (packaging/signing/auto-update) — the release milestone; start
   the cert procurement early since it's externally blocked.

Decisions to confirm before starting: multi-monitor quota cost (1.2), and the
signing-cert / update-host choices (5.2/5.3).
