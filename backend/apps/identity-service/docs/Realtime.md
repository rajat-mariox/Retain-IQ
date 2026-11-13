# Realtime (SSE + Redis pub/sub)

Live updates — inbox notifications, feature-flag flips, platform broadcasts —
reach connected clients over **Server-Sent Events**, fanned out across pods by a
**Redis pub/sub bus**. A publisher writes to a Redis channel; every pod's
subscriber routes the message to the matching local SSE connections. This keeps
one broker subscription per pod regardless of client count and reaches a user's
connections wherever they happen to be served.

Files: `src/common/realtime/{sse-hub,notification-realtime.service,
realtime-publisher.service}.ts`, channel helpers in `@retainiq/messaging`.

## Why Redis, not in-process

A user's desktop agent and their browser tab are usually served by **different
pods**. If the publisher pushed straight to the in-process `SseHub`, only clients
on that one pod would see it. So `RealtimePublisher` always goes through the Redis
bus; `NotificationRealtimeService` is the subscriber that fans messages back out
to local SSE clients on every pod.

```
event source ─▶ RealtimePublisher.publishToUser/Org/All
             ─▶ RedisRealtimeBus.publish(channel)         (Redis pub/sub)
Redis ─▶ NotificationRealtimeService (one pattern-subscriber per pod)
      ─▶ SseHub.publishToUser/Org/All ─▶ Subject.next({ data }) ─▶ SSE clients
```

## Channels

Three fan-out scopes, keyed by channel prefix (`@retainiq/messaging`):

| Scope | Channel | Reaches |
|---|---|---|
| per-user | `notifications:user:<id>` (`userNotificationChannel`) | that user's connections (a notification for one person) |
| per-org | `realtime:org:<id>` (`orgBroadcastChannel`) | every live connection in a tenant (a feature flag flipped for the org) |
| platform | `realtime:broadcast` (`PLATFORM_BROADCAST_CHANNEL`) | every connection on the platform (a global kill switch) |

## RealtimePublisher (write side)

`RealtimePublisher` (`realtime-publisher.service.ts`) holds a `RedisRealtimeBus`
and exposes `publishToUser`, `publishToOrg`, `publishToAll`. Every publish is
wrapped in try/catch and only warns on failure — **live delivery is a nudge on top
of persisted state, never fatal**. It closes the bus on shutdown.

## NotificationRealtimeService (read side)

`NotificationRealtimeService` (`notification-realtime.service.ts`) subscribes
**once per process** (`onApplicationBootstrap`) to all three patterns:

```ts
await this.bus.subscribePattern(
  [USER_NOTIFICATION_PATTERN, ORG_BROADCAST_PATTERN, PLATFORM_BROADCAST_CHANNEL],
  (channel, message) => this.route(channel, message));
```

`route` dispatches by prefix: `realtime:broadcast` → `hub.publishToAll`;
`realtime:org:<id>` → `hub.publishToOrg(id)`; otherwise
`notifications:user:<id>` → `hub.publishToUser(id)`.

## SseHub (in-process registry)

`SseHub` (`sse-hub.ts`) is the per-pod registry of live SSE connections, indexed
two ways off the same rxjs `Subject<MessageEvent>`:

- `byUser` — for per-user fan-out;
- `byOrg` — for tenant-wide fan-out.

A connection `register(userId, orgId, channel)`s once and `unregister`s on
disconnect. `publishToUser`/`publishToOrg`/`publishToAll` push `channel.next({ data })`
to the matching subjects (no-op if none). The SSE endpoint (notifications
controller) creates a `Subject`, registers it, and streams it to the client.

## What flows over it

- **Notifications** — new inbox items are pushed to `notifications:user:<id>` so
  the bell updates without polling (backed by the persisted notification store).
- **Feature flags** — flipping a flag in platform-admin publishes to
  `realtime:org:<id>` so org clients re-gate navigation live (see
  `Platform-Admin.md` / `Multi-Tenancy.md`).
- **Platform broadcasts** — global notices / maintenance-state changes to
  `realtime:broadcast`.

The `RealtimePublisher` is also provided inside `PlatformAdminModule`, so
super-admin actions (settings/branding/feature edits) push live updates.
