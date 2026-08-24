# activity-ingestion — Ingestion Pipeline

The full request path for a desktop-agent activity batch: **authenticate →
validate → envelope → publish → 202**. Nothing here writes to a database; the only
side effect is a broker publish.

Files: `src/ingestion.controller.ts`, `src/ingestion.service.ts`,
`src/auth.guard.ts`, `src/zod-validation.pipe.ts`, and the shared contract in
`@retainiq/contracts` (`backend/packages/contracts/src/lib/events.ts`).

## The endpoint (`src/ingestion.controller.ts`)

```ts
@Controller("ingest")
@UseGuards(IngestAuthGuard)
export class IngestionController {
  @Post("activity")
  @HttpCode(202)
  ingestActivity(
    @Body(new ZodValidationPipe(activityIngestBatchSchema)) body: ActivityIngestBatch,
    @OrgId() orgId: string,
  ) {
    return this.ingestionService.ingestActivity(orgId, body.events);
  }
}
```

- Route: **`POST /v1/ingest/activity`** (global prefix `v1` + controller `ingest`).
- **`202 Accepted`** is deliberate: the service acknowledges receipt and hands the
  batch to the broker; it does not wait for downstream processing.
- The whole controller is behind `@UseGuards(IngestAuthGuard)` — no unauthenticated
  ingestion.
- `orgId` is **never taken from the body**. It is injected by the `@OrgId()`
  param decorator from the verified JWT claims, so an agent cannot spoof another
  tenant's org.

## Agent authentication (`src/auth.guard.ts`)

`IngestAuthGuard` verifies the **same access JWT identity-service issues** (shared
`JWT_ACCESS_SECRET`). It performs **no DB lookups** — identity-service is the
identity authority.

1. **Extract** the bearer token (`extractBearerToken`): requires a
   `Authorization: Bearer <token>` header; scheme match is case-insensitive, value
   is trimmed. Missing/blank → `401 "Authentication is required."`.
2. **Verify** via `JwtService.verifyAsync<AccessTokenClaims & { iat? }>`. Any
   failure (bad signature, expiry) → `401 "Invalid or expired access token."`.
3. **Revocation check** against the shared Redis denylist:
   `denylist.isRevoked(claims.jti, claims.sub, claims.iat)` — honours a logout
   performed on identity-service. Revoked → `401 "Session has been logged out."`.
   (When no `REDIS_URL` is configured the denylist is `new TokenDenylist(null)` and
   this check fails open — see `Architecture.md`.)
4. **Attach** `request.orgId = claims.orgId` for the `@OrgId()` decorator, and
   return `true`.

```ts
export const OrgId = createParamDecorator((_data, ctx): string => {
  const request = ctx.switchToHttp().getRequest<IngestRequest>();
  return request.orgId ?? "";
});
```

## Validation (`src/zod-validation.pipe.ts` + contract)

The body is validated by `ZodValidationPipe` against `activityIngestBatchSchema`.
On failure it throws `BadRequestException` (`400`) with a structured issue list:

```ts
throw new BadRequestException({
  message: "Validation failed.",
  issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
});
```

### Batch shape — `activityIngestBatchSchema`

```ts
export const activityIngestBatchSchema = z.object({
  events: z.array(activityIngestEventSchema).min(1).max(500),
});
```

- A batch carries **1–500 events**. An empty batch or one over 500 is rejected —
  this is the ingest-side backpressure/abuse guard.

### Per-event shape — `activityIngestEventSchema`

```ts
export const activityIngestEventSchema = z.object({
  eventType: activityEventTypeSchema,               // enum, see below
  occurredAt: z.string().datetime(),                // ISO-8601, agent clock
  employeeId: z.string().uuid().optional(),
  sourceEventId: z.string().min(1).optional(),      // agent-side id (dedupe hint)
  payload: z.record(z.unknown()).default({}),       // free-form per event type
});
```

`activityEventTypeSchema` is a **closed enum** — an unknown `eventType` fails
validation:

| Event type |
|---|
| `activity.session.started` / `activity.session.ended` |
| `activity.app.used` |
| `activity.website.visited` |
| `activity.idle.started` / `activity.idle.ended` |
| `activity.break.started` / `activity.break.ended` |
| `activity.screenshot.captured` |
| `activity.focus.block.completed` |
| `activity.context_switch.recorded` |

Note that `employeeId` is **optional** at ingest. Downstream, `analytics-service`
skips (acks without scoring) any event lacking `orgId`/`employeeId` because it
"can't be scored" (`analytics-service/src/main.ts`).

## Envelope + publish (`src/ingestion.service.ts`)

```ts
async ingestActivity(orgId: string, events: ActivityIngestEvent[]) {
  const ingestedAt = new Date().toISOString();
  for (const event of events) {
    const envelope = {
      eventId: randomUUID(),
      eventType: event.eventType,
      schemaVersion: 1,
      orgId,                       // from the JWT, not the body
      employeeId: event.employeeId,
      source: "desktop-agent",
      sourceEventId: event.sourceEventId,
      occurredAt: event.occurredAt,
      ingestedAt,
      payload: event.payload,
    };
    await this.broker.publish(
      STREAMS.activity,
      JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>,
    );
  }
  return { accepted: events.length };
}
```

Key facts grounded in the code:

- **One broker message per event.** The service fans a batch out into individual
  publishes to `STREAMS.activity`.
- Every event gets a **server-minted `eventId`** (`randomUUID()`) — this is the key
  consumers de-dupe on. The agent's own `sourceEventId` is preserved separately as
  a hint but is not the idempotency key.
- `orgId` comes from the guard-verified claims; the agent's supplied `employeeId`,
  `occurredAt`, `sourceEventId`, and `payload` pass through.
- `schemaVersion: 1` and `source: "desktop-agent"` stamp the envelope for
  downstream schema handling and provenance.
- `ingestedAt` is one timestamp per batch (server receive time); `occurredAt` is
  the agent's per-event time.
- The `JSON.parse(JSON.stringify(...))` round-trip strips `undefined` fields and
  guarantees a plain, serialisable `Record<string, unknown>` for the publisher.
- The response body is `{ accepted: events.length }`.

## Failure modes summary

| Condition | Result |
|---|---|
| No/invalid `Authorization` header | `401` (guard) |
| Bad/expired JWT | `401` (guard) |
| Token revoked via denylist | `401` (guard) |
| Body fails schema (empty, >500, unknown type, bad date/uuid) | `400` with `issues[]` (pipe) |
| Valid batch | `202 { accepted: N }` after N publishes |

Broker publish semantics, stream names, and the downstream consumers are covered
in `Events.md`.
