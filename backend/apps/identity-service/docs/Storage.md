# Storage (screenshots)

Employee-monitoring screenshots are stored in object storage (MinIO locally, AWS
S3 in production) with only **metadata + size** kept in `identity-db`. Uploads are
issued as presigned PUT URLs so the client uploads directly to object storage;
quota comes from the org's plan (`billing-db`, read-only); reads are ABAC-scoped;
retention is enforced by a daily purge cron.

Files: `src/modules/storage/storage.service.ts`.

## Dual S3 client

`StorageService` constructs **two** `S3Client`s because the server and the browser
reach object storage at different hosts:

```ts
this.s3       = new S3Client({ region, endpoint, forcePathStyle, credentials });        // internal ops
this.presignS3 = new S3Client({ region, endpoint: publicEndpoint, forcePathStyle, credentials }); // presigned URLs
```

- `s3` uses `S3_ENDPOINT` (e.g. `http://minio:9000`) for server-side operations
  (put/get/delete, bucket bootstrap).
- `presignS3` uses `S3_PUBLIC_ENDPOINT` (e.g. `http://localhost:9000`) so a
  presigned URL points at a host the **browser/agent** can reach.

In production (real S3) `S3_ENDPOINT`/`S3_PUBLIC_ENDPOINT` are unset → both point
at AWS. `forcePathStyle` defaults on when a custom endpoint is set (MinIO).
`onModuleInit` best-effort ensures the bucket exists (`HeadBucket`, else
`CreateBucket`) — never blocking startup.

Config: `S3_BUCKET` (default `retainiq-screenshots`), `S3_ENDPOINT`,
`S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`,
`S3_FORCE_PATH_STYLE`. Presigned URL TTL = 900s.

## Upload — presigned PUT with quota reservation

`createUpload({ orgId, membershipId, contentType, sizeBytes, capturedAt })`:

1. **Attribution is server-derived** — the `employeeId` comes from the caller's
   membership, never the request body, so a client can't attribute a capture to
   someone else.
2. **Quota check** — `usedBytes(orgId)` (SUM of `ScreenshotObject.sizeBytes`) +
   the new size must not exceed the plan limit, else
   `PayloadTooLargeException("Storage quota exceeded … Upgrade …")`.
3. Writes the `ScreenshotObject` metadata row (key, size as `BigInt`, contentType,
   capturedAt) and returns a **presigned PUT URL** the client uploads to directly.

Object key layout: `screenshots/{orgId}/{employeeId|org}/{YYYY-MM-DD}/{uuid}.{ext}`.

## Plan-based quotas (billing-db, read-only)

`planLimit(orgId)` reads the org's `Subscription`→`Plan` from
`BillingReadPrismaService` (read-only cross-service client) and converts
`plan.storageLimitMb` to bytes (`null` = unlimited), falling back to the `free`
plan. `usage(orgId)` returns `{ usedBytes, limitBytes, planId, planName }` — the
super-admin storage card and the org's own usage meter.

## Reads — ABAC-scoped

Screenshot reads resolve `AccessScopeService.resolveScope(…, screenshots.read)`
then `visibleEmployeeIds` (`null` = org-wide):

- `screenshotsByEmployee` — gallery folders grouped by employee, filtered to the
  visible set.
- `listScreenshots` — paginated list with presigned **view** (GET) URLs +
  employee names; org tier can optionally narrow to one employee, scoped/self is
  restricted to the visible ids.
- `listOwnScreenshots` — the **employee self-view**, hard-scoped to the caller's
  own employee record (from their membership), never a query param. This needs
  **no** `screenshots.read` permission — that permission is the manager/admin
  gallery. An employee can see their own captured activity for transparency
  without being able to browse the org-wide surveillance gallery.

So visibility is fully dynamic from role grants + scope — no hardcoded role
names. Delete (`deleteScreenshot`) is Owner-only (enforced upstream) and removes
the S3 object **first** (idempotent) then the metadata, so a failure never
orphans the object.

## Retention purge

- `purgeOrgExpired(orgId, retentionDays)` deletes every `ScreenshotObject` older
  than the cutoff from both S3 and the DB.
- `purgeRequestOrg` — manual "purge now" using the org's
  `MonitoringPolicy.screenshotRetentionDays`.
- `purgeExpiredScreenshots` — `@Cron(EVERY_DAY_AT_2AM)` sweeps every org that has a
  retention window configured.

## Route surface (`/v1/storage`)

Upload create, list, own-list, by-employee, usage, and delete — permissions
(`screenshots.read` / `screenshots.download` / `screenshots.delete`) enforced at
the controller, with the self-view exempt as noted above.
