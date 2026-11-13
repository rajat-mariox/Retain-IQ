# Preferences, Quiet Hours & Recipient Resolution

Between "a rule matched" and "dispatch this channel" sit three decisions: **who** are
the recipients, **which channels** did each recipient opt into for this category, and
**is it their quiet time**. These live in `recipients.ts`, `preferences.ts`, and
`quiet-hours.ts`.

## Recipient resolution (`recipients.ts`)

`resolveRecipients(prisma, orgId, audience, payload)` turns a spec's `audience` into a
concrete set of userIds. The four **singular** audiences read a userId straight off the
event payload — no DB hit:

```ts
if (audience === "owner")     return str(payload.ownerUserId)     ? [payload.ownerUserId]     : [];
if (audience === "requester") return str(payload.requesterUserId) ? [payload.requesterUserId] : [];
if (audience === "approver")  return str(payload.approverUserId)  ? [payload.approverUserId]  : [];
if (audience === "assignee")  return str(payload.assigneeUserId)  ? [payload.assigneeUserId]  : [];
```

- `requester` is reused broadly — the leave applicant, the manager an observation
  routed to, the assigned incident investigator, the recognised employee, etc. The
  producing service decides who the "requester" is and stamps `requesterUserId`.
- `approver` is deliberately the **one** manager who signed something off (carried on
  the event), not every approver — used for `leave.cancelled` and
  `attendance.correction_requested` so only the relevant person is notified.

The two **plural** audiences query the **local** `OrgRecipient` projection by role:

```ts
const ADMIN_ROLES    = ["Owner", "Admin", "HR Admin"];
const APPROVER_ROLES = ["Owner", "Admin", "HR Admin", "Manager"];

const roles = audience === "approvers" ? APPROVER_ROLES : ADMIN_ROLES;
const recipients = await prisma.orgRecipient.findMany({
  where: { orgId, status: "ACTIVE", roleName: { in: roles } },
  select: { userId: true },
});
return [...new Set(recipients.map((r) => r.userId))];
```

Everything is **tenant-scoped by `orgId`**, filtered to `status: "ACTIVE"`, and
de-duplicated. Crucially this reads the notifications-service's own DB — **never**
identity-db (the header comment: "queries the LOCAL OrgRecipient read model … never
the identity database").

### The `OrgRecipient` projection

`OrgRecipient` is a local read model of org membership, kept in sync from identity's
`org.member.upserted` domain events. `main.ts` intercepts that event before the rules
engine and upserts the row (`projectMember`):

```ts
await prisma.orgRecipient.upsert({
  where: { orgId_userId: { orgId, userId } },
  create: { orgId, userId, roleName, status, email, name },
  update: { roleName, status, updatedAt: new Date(), ...(email ? { email } : {}), ...(name ? { name } : {}) },
});
```

- Idempotent on `(orgId, userId)` — a redelivered membership event just rewrites the
  same row.
- **Never blanks an existing `email`/`name`**: a later event that omits them leaves the
  stored values intact (the spread only sets them when present). This is why the EMAIL
  channel can address a recipient (`recipientEmail` is read from here in `deliver()`)
  and the digest can look up the address without touching identity-db.
- `roleName`/`status` feed the plural-audience role queries above.

See `Database-Events.md` for the projection model and event wiring.

## Per-user preferences (`preferences.ts`)

`resolvePreferences(prisma, orgId, userId, category)` returns the **allowed channel
set** and the recipient's **quiet-hours window** for one category:

```ts
const [pref, setting] = await Promise.all([
  prisma.notificationPreference.findUnique({ where: { orgId_userId_category: { orgId, userId, category } } }),
  prisma.notificationSetting.findUnique({ where: { orgId_userId: { orgId, userId } } }),
]);
```

Channel opt-in falls back to **category defaults** when the user has never touched
their settings (`DEFAULTS` in `preferences.ts`):

| Category | IN_APP | EMAIL | PUSH |
|---|---|---|---|
| ATTENDANCE | ✓ | ✓ | — |
| PROJECT | ✓ | — | — |
| PRODUCTIVITY | ✓ | — | — |
| AI | ✓ | — | — |
| SYSTEM | ✓ | ✓ | — |

```ts
const base = DEFAULTS[category] ?? DEFAULTS.SYSTEM;
if (pref ? pref.inApp : base.inApp) allowed.add("IN_APP");
if (pref ? pref.email : base.email) allowed.add("EMAIL");
if (pref ? pref.push  : base.push)  allowed.add("PUSH");
```

`handle()` then intersects `spec.channels` with this `allowed` set
(`if (!prefs.allowed.has(channel)) continue;`), so **IN_APP is effectively never fully
suppressed** — it's on by default for every category and is the durable inbox record;
only EMAIL/PUSH are genuinely opt-in.

The `quiet` block comes from `NotificationSetting` (with defaults when absent):

```ts
quiet: {
  enabled:  setting?.quietHoursEnabled ?? false,
  start:    setting?.quietStart ?? 22,
  end:      setting?.quietEnd   ?? 8,
  timezone: setting?.timezone   ?? "UTC",
}
```

## Quiet hours (`quiet-hours.ts` + `hourInTimezone`)

`handle()` builds the quiet-hours window per recipient:

```ts
const quietHours = prefs.quiet.enabled
  ? { start: prefs.quiet.start, end: prefs.quiet.end, now: hourInTimezone(prefs.quiet.timezone) }
  : { start: config.QUIET_HOURS_START, end: config.QUIET_HOURS_END, now: new Date().getUTCHours() };
```

- If the user enabled quiet hours, their **own window** is evaluated against the
  current hour **in their timezone**.
- Otherwise the **service-wide** default window (`QUIET_HOURS_START`/`END`, default
  22→8) is evaluated in **UTC**.

`hourInTimezone(timezone, at)` (`preferences.ts`) resolves the current hour in an IANA
timezone via `Intl.DateTimeFormat`, falling back to `getUTCHours()` on an unknown zone.

`isQuietHour(hour, start, end)` (`quiet-hours.ts`) tests the half-open window
`[start, end)` and **supports wrap-around** across midnight:

```ts
if (start === end) return false;                       // empty window = never quiet
return start < end ? hour >= start && hour < end       // same-day window (e.g. 9→17)
                   : hour >= start || hour < end;       // wrap-around (e.g. 22→8)
```

`channels.ts` calls this for EMAIL and PUSH only; a match returns `DEFERRED` (and
increments `notifications_deferred_total{channel}`). IN_APP ignores quiet hours
entirely.

The wrap-around and same-day cases, plus `start == end`, are covered by the unit tests
in `test/notifications.test.ts`.
