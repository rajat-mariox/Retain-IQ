# Channels & Delivery

Once `handle()` has chosen a recipient and a channel, delivery runs through a single
multi-channel dispatcher. Three channels exist — **IN_APP**, **EMAIL**, **PUSH** — and
each returns a `DeliveryOutcome` the caller persists on the notification row.

Files: `src/channels.ts`, `src/email.ts`, `src/push.ts`, `src/digest.ts`, and the
`deliver()` unit in `src/main.ts`.

## The delivery unit and idempotency (`main.ts` `deliver`)

Every channel delivery is keyed by a deterministic **`dedupeKey`**:

```ts
const dedupeKey = `${eventId}:${spec.type}:${recipientUserId}:${channel}`;
```

`deliver()` find-or-creates the `Notification` row for that key:

```ts
let notification = await prisma.notification.findUnique({ where: { dedupeKey } });
if (!notification) {
  try { notification = await prisma.notification.create({ data: { …, dedupeKey, sourceEventId: eventId } }); }
  catch (error) {
    if (!isUniqueViolation(error)) throw error;   // P2002 only
    notification = await prisma.notification.findUnique({ where: { dedupeKey } });
  }
}
if (!notification || notification.status !== "PENDING") return;   // already handled
```

This is the service's **only idempotency mechanism** — there is no consumer inbox
table. Because the domain-event stream is at-least-once, the same event can be
redelivered; the second pass either loses the create race (caught `P2002`, `code`
check in `isUniqueViolation`) or finds the existing row in a non-`PENDING` status and
returns without re-sending. The `dedupeKey`'s uniqueness is enforced by
`Notification.dedupeKey @unique` in the schema. `sourceEventId` links the row back to
the originating event for tracing.

After `dispatch()` returns, `deliver()` writes the outcome:

```ts
await prisma.notification.update({ where: { id: notification.id }, data: { status: outcome.status, sentAt: outcome.sentAt } });
```

and — for a **SENT IN_APP** row only — publishes to the realtime bus for live SSE
fan-out (best-effort; skipped if `REDIS_URL` is unset):

```ts
if (channel === "IN_APP" && outcome.status === "SENT" && realtime) {
  await realtime.publish(userNotificationChannel(recipientUserId), { id, type, title, body, category, priority, link, createdAt });
}
```

## `dispatch()` (`channels.ts`)

A pure switch over the channel, returning
`{ status: "SENT" | "DEFERRED" | "FAILED" | "SUPPRESSED"; sentAt: Date | null }`:

| Channel | Behavior | Outcomes |
|---|---|---|
| **IN_APP** | The persisted row *is* the delivery. Always `SENT` immediately (never deferred — the inbox is the durable record). | `SENT` |
| **EMAIL** | Deferred during quiet hours; suppressed if no address on the projection; otherwise sent via `EmailSender`. | `DEFERRED` / `SUPPRESSED` / `SENT` / `FAILED` |
| **PUSH** | Deferred during quiet hours; otherwise fanned out to the user's devices via `PushSender`. | `DEFERRED` / `SENT` / `FAILED` / `SUPPRESSED` |

Quiet-hours gating uses `isQuietHour(ctx.quietHours.now, .start, .end)` from
`quiet-hours.ts` (wrap-around window supported — see `Preferences-QuietHours.md`).
IN_APP deliberately bypasses this check. The `quietHours` object is precomputed per
recipient in `handle()`: the user's own window in their timezone when they have quiet
hours enabled, else the service-wide `QUIET_HOURS_START`/`END` evaluated in UTC.

Outcome nuances:

- **EMAIL, no address** → `SUPPRESSED` (not `FAILED`): the recipient projection has no
  `email`, so there is nothing to send to. `recipientEmail` is looked up from
  `OrgRecipient` in `deliver()` only when the channel is EMAIL.
- **PUSH, no device** → `SUPPRESSED`: no `PushSubscription` rows means nothing to
  deliver to. Only a real transport error is `FAILED`.

## Email (`email.ts`)

`EmailSender` wraps a nodemailer SMTP transport, configured entirely from env:

```ts
if (cfg.host) this.transport = nodemailer.createTransport({ host, port, secure, auth: user&&pass ? {user,pass} : undefined });
```

- **Inert when `SMTP_HOST` is unset** — `send()` logs `"email skipped (SMTP not configured)"`
  and returns `false`, so dev/CI never actually sends. `get enabled()` reflects whether
  a transport exists; the digest sweep checks it before running.
- **Local development** points `SMTP_HOST` at a catcher like **Mailpit / MailHog**
  (default `SMTP_PORT` is `1025`, `SMTP_SECURE` false) to view real mail.
- Renders both a **plain-text** (`renderText`) and **HTML** (`renderHtml`) body. The
  HTML is a self-contained branded template with an optional CTA button linking to
  `${APP_URL}${link}`, and HTML-escapes all interpolated values (`esc()` for `<`,`>`,`&`).
- **Attachments**: `EmailMessage.attachments` maps to nodemailer attachments with a
  default `contentType` of `text/csv`. This is how a `report.scheduled` event's CSV is
  delivered — `main.ts` `extractAttachments()` pulls `payload.reportCsv`
  (`{ filename, content }`) and passes it through, EMAIL channel only.
- **Digest rows**: `EmailMessage.items` renders an extra list of
  `{ title, body, when }` rows in both text and HTML — used only by the digest email.
- `send()` returns a boolean; a thrown SMTP error is caught, logged, and returns
  `false` → the dispatcher records `FAILED`.

## Push (`push.ts`)

`PushSender` is a Web Push (VAPID) sender:

- **Inert unless both VAPID keys are set** (`enabled = Boolean(publicKey && privateKey)`);
  otherwise `send()` logs and returns `"skipped"`.
- Loads all `PushSubscription` rows for `(orgId, userId)` and fans the JSON payload
  (`{ title, body, link, tag }`) to every registered device via
  `webpush.sendNotification`.
- **Return contract**: `"sent"` if at least one push landed, `"failed"` if any device
  errored with a non-expiry status and none succeeded, `"skipped"` if there were no
  devices / push disabled. `channels.ts` maps `sent`→SENT, `failed`→FAILED,
  otherwise→SUPPRESSED.
- **Subscription pruning**: a `404`/`410` from the push service means the browser
  dropped the subscription — the row is deleted and it is treated as housekeeping, not
  a failure. Successful sends bump `lastUsedAt`.

## Digest sweep (`digest.ts`)

`runDigestSweep()` rolls **unread in-app** notifications into one summary email per
user. It runs on `DIGEST_INTERVAL_MS` (default 5 min) from `main.ts` and is safe to
call often — it is a no-op unless a user's send window has arrived:

1. Skips entirely if `email.enabled` is false.
2. Loads every `NotificationSetting` with `digest` in `("DAILY","WEEKLY")`.
3. Per setting, computes `periodMs` (1 day / 7 days) and skips unless **both**:
   - the current hour **in the user's timezone** (`hourInTimezone(s.timezone)`) has
     reached `s.digestHour`, and
   - a full period has elapsed since `s.lastDigestAt`.
4. Queries unread, non-archived `IN_APP` notifications since `lastDigestAt` (max 25,
   newest first). If none, it still stamps `lastDigestAt = now` so the setting isn't
   re-checked every sweep, and moves on.
5. Reads the recipient's `email` from `OrgRecipient`; skips if none.
6. Sends the digest (`label` = "This week"/"Today", `items` = the unread rows) and,
   **only on success**, stamps `lastDigestAt = now`.

The digest never mutates the underlying notifications (it doesn't mark them read);
`lastDigestAt` alone advances the window, so a failed send is retried next sweep.
