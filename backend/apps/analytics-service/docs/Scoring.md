# Analytics Service — Scoring & Projections

This doc covers how one raw activity event becomes (a) counter increments on the
day-fact, (b) rows in the detail read-model, and (c) two derived scores
(`productivityScore`, `focusScore`). Three files carry it:

| File | Role |
|---|---|
| `src/scoring.ts` | Pure, I/O-free contracts: `deriveDelta` (event → counter delta) + the classification vocabulary re-exported from `readmodel`. |
| `src/readmodel.ts` | `classifyApp` / `classifyDomain` + `persistDetail` — the detail-table projections. |
| `src/score.task.ts` | The CPU-bound scoring formula, run on a `worker_threads` (Piscina) pool. |

The split is deliberate: `scoring.ts` runs on the **main thread** (delta derivation
during the DB transaction); `score.task.ts` runs on a **pool thread** (score
computation off the consumer loop). They share the `ScoreInput`/`ScoreOutput`/
`ActivityDelta` types (`scoring.ts:7-24`).

## Classification (`readmodel.ts`)

Two functions assign every app/site a `Category` of `PRODUCTIVE | NEUTRAL |
DISTRACTING`. They are the **single source of truth** for classification — both the
timeline projection and the productivity delta call them.

### `classifyApp(name, explicitProductive?)`

```ts
if (explicitProductive === true)  return "PRODUCTIVE";
if (explicitProductive === false) return "DISTRACTING";
// else substring-match name.toLowerCase() against the lists:
```

- An explicit `payload.productive` boolean **overrides** name matching (agent can
  label a window authoritatively).
- Otherwise a case-insensitive **substring** match: `PRODUCTIVE_APPS`
  (`vscode`, `code`, `intellij`, `figma`, `slack`, `jira`, `postman`, `docker`, …)
  vs `DISTRACTING_APPS` (`youtube`, `netflix`, `instagram`, `steam`, `discord`, …).
- No match → `NEUTRAL`.

### `classifyDomain(domain)`

Strips a leading `www.`, then matches **exact host or subdomain suffix** against
`PRODUCTIVE_DOMAINS` (`github.com`, `stackoverflow.com`, `docs.google.com`,
`atlassian.net`, `figma.com`, `npmjs.com`, `linear.app`, …) and `DISTRACTING_DOMAINS`
(`youtube.com`, `netflix.com`, `reddit.com`, `x.com`, `twitch.tv`, …). No match →
`NEUTRAL`.

The exact app/domain lists live at `readmodel.ts:11-14`.

## Delta derivation (`scoring.ts` `deriveDelta`)

`deriveDelta(eventType, payload)` maps a single event to its contribution to the
day's counters. Every event contributes `eventCount: 1`; specific types add seconds:

| `eventType` | Contribution |
|---|---|
| `activity.app.used` | `activeSeconds += seconds`; `productiveSeconds += seconds` **iff** `classifyApp(app, payload.productive) === "PRODUCTIVE"`. |
| `activity.website.visited` | `activeSeconds += seconds`; `productiveSeconds += seconds` **iff** `classifyDomain(domain) === "PRODUCTIVE"` (domain taken from `payload.domain` or parsed from `payload.url`). |
| `activity.idle.started` / `activity.idle.ended` | `idleSeconds += seconds`. |
| everything else (session/break/screenshot/…) | `eventCount` only. |

`seconds` is coerced defensively: non-finite or **negative values become 0**
(`toNumber`, `scoring.ts:79-82`) — verified by the test
*"deriveDelta ignores negative/garbage seconds"*.

> **Design note (from the source):** `deriveDelta` deliberately delegates to
> `readmodel`'s `classifyApp` / `classifyDomain` — the same functions that label the
> `ActivityEvent` timeline. The header comment records the bug this fixed: the file
> previously kept its own shorter app list and **ignored websites entirely**, so
> `productivityScore` was always 0 while the timeline showed the same work as
> `PRODUCTIVE`. One classifier, one answer (`scoring.ts:26-34`, `48-56`).

The returned `ActivityDelta` is applied as `increment` operations on
`EmployeeDayFact` inside the idempotent transaction in `main.ts` (`create` on first
event of the day, `update: { increment }` thereafter).

## Detail projections (`readmodel.ts` `persistDetail`)

`persistDetail(tx, ctx)` runs inside the caller's transaction (gated by
`ConsumedEvent`, so it inherits exactly-once semantics). It switches on `eventType`
and writes the detail tables the day-fact rollup discards. `ctx` carries `orgId`,
`employeeId`, `day`, `occurredAt`, `eventType`, `sourceEventId`, and the raw
`payload`.

| `eventType` | Writes |
|---|---|
| `activity.app.used` | `AppUsageDaily` upsert (`+seconds`, `category`) + `ActivityEvent{type:"app"}` + `bumpSession({active})`. |
| `activity.website.visited` | `WebsiteUsageDaily` upsert (`+seconds`, `+1 visit`, `category`) + `ActivityEvent{type:"website"}` + `bumpSession({active})`. |
| `activity.idle.started` / `.ended` | `ActivityEvent{type:"idle"}` + `bumpSession({idle})`. |
| `activity.break.started` / `.ended` | `ActivityEvent{type:"break", title: breakType}` + `bumpSession({brk})`. |
| `activity.session.started` | `WorkSession` upsert (create with `startedAt`) + `ActivityEvent{type:"session"}`. |
| `activity.session.ended` | `WorkSession` upsert (`endedAt`) + `ActivityEvent{type:"session"}`. |
| `activity.screenshot.captured` | `ActivityEvent{type:"screenshot", detail: objectKey}`. |
| `activity.focus.block.completed` | `ActivityEvent{type:"focus", seconds}`. |
| `activity.context_switch.recorded` | `ActivityEvent{type:"context_switch"}`. |

Details:

- **`bumpSession`** (`readmodel.ts:56-66`) increments the matching `WorkSession`'s
  active/idle/break seconds via `updateMany` keyed on
  `(orgId, employeeId, sessionKey)` where `sessionKey = payload.sessionId`. It
  **no-ops** if there is no `sessionId` or all deltas are zero — so app/idle time is
  attributed to a session only when the agent supplied one. The session row itself is
  created by `activity.session.started`.
- **Session key fallbacks**: `session.started` uses `payload.sessionId ??
  sourceEventId ?? occurredAt.toISOString()`; `session.ended` uses `payload.sessionId
  ?? sourceEventId` and upserts (so an end arriving before/without a start still
  materializes a session with `endedAt`).
- **Sanitizers**: `num` rounds and floors-at-zero non-negative numbers; `str` returns
  non-empty strings or `null`; `hostFromUrl` parses a URL hostname (stripping `www.`)
  and returns `null` on parse failure.
- Only `activity.app.used` and `activity.website.visited` compute a `category`; the
  same `classifyApp`/`classifyDomain` used by `deriveDelta`, so the timeline category
  and the productivity counter always agree.

## The scoring task (`score.task.ts`)

The Piscina pool entry (`export default function score(input: ScoreInput)`) is the
CPU-bound step. It reads the **current day totals** (post-increment) and returns two
scores in `0..100`, each rounded to 2 decimals.

### productivityScore

```ts
productivityScore = active > 0 ? clamp((productive / active) * 100) : 0;
```

Share of active time spent in productive apps/sites. With zero active time the score
is 0 (test: *"zero activity yields zero scores"*). `productive` and `active` are the
accumulated `productiveSeconds` / `activeSeconds` for the day.

### focusScore

```ts
activeRatio   = total > 0 ? active / total : 0;     // total = active + idle
churn         = active > 0 ? eventCount / (active / 60) : 0;   // events per active minute
churnPenalty  = clamp01(churn / 20);                // ~20 events/active-min => full penalty
focusScore    = clamp(activeRatio * (1 - 0.5 * churnPenalty) * 100);
```

Focus **rewards sustained active time** (high `activeRatio` = little idle) and
**penalizes fragmentation**: many short events per active minute (`churn`) reduce the
score by up to 50% at the `20 events/min` saturation point. So the worst case
(all-idle, or extreme churn) still bottoms at 0 and the best case (all active, low
churn) tops at 100. Test *"high event churn lowers focus"* asserts that at fixed
active seconds, `eventCount = 5000` scores strictly below `eventCount = 5`.

`clamp` bounds `[0,100]`, `clamp01` bounds `[0,1]`, `round2` fixes 2 decimals
(`score.task.ts:32-42`).

> The header comment marks this file as the **extension seam**: *"The formula here is
> intentionally simple; this is the seam where heavier productivity/focus models or ML
> inference run."* Swapping the model means editing only `score.task.ts` — the
> consumer loop, idempotency, and projections are untouched.

## End-to-end apply order (`main.ts`)

For one `activity.app.used` event with `{ app: "vscode", seconds: 1800 }`:

1. `deriveDelta` → `{ activeSeconds: 1800, idleSeconds: 0, productiveSeconds: 1800,
   eventCount: 1 }` (vscode is PRODUCTIVE).
2. In one tx: insert `ConsumedEvent` (idempotency gate) → upsert `EmployeeDayFact`
   (increment counters) → `persistDetail` writes `AppUsageDaily`, an `ActivityEvent`
   row, and bumps the `WorkSession`.
3. Off the loop: `pool.run(totals)` → `score.task.ts` returns
   `{ productivityScore, focusScore }`.
4. `employeeDayFact.update` writes the two scores back; metrics
   `analytics_facts_updated_total` + `analytics_last_scoring_seconds` recorded.

A redelivery of the same `eventId` fails the `ConsumedEvent` unique constraint,
rolls the tx back, and increments `analytics_events_duplicate_total` instead —
counters and detail rows are never double-applied.

## Tests

`test/scoring.test.ts` (Node's built-in `node:test`) pins the observable contracts of
both pure modules:

- `deriveDelta` productive counting, non-productive active-but-not-productive,
  explicit `productive` flag override, idle mapping, and negative-seconds rejection.
- `score` productivity = 75% for `1800/2400` active-productive, zero-in→zero-out, and
  churn monotonicity (more events ⇒ lower focus).

Because both files are pure (no DB, no broker), the suite runs with no fixtures via
`npm test` (`node --test "test/**/*.test.ts"`).
