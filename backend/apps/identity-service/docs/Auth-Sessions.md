# Auth & Sessions

Tenant authentication is a short-lived access JWT plus a rotating, opaque refresh
session. The access token identifies the principal; it is **never** trusted for
authorization (that is a DB lookup in `PermissionGuard`). Logout revocation is
immediate via a Redis denylist, so a still-valid JWT is rejected within its TTL.

Files: `src/modules/identity/{identity.controller,identity.service,token.service}.ts`,
`src/common/guards/auth.guard.ts`, `src/common/crypto/refresh-token.util.ts`,
`src/common/security/security.module.ts`, `TokenDenylist` from `@retainiq/platform`.

## The auth surface (`/v1/auth`)

`IdentityController` (`identity.controller.ts`) — none of these are
permission-gated (you can't hold an org permission before you authenticate):

| Route | Guard | Notes |
|---|---|---|
| `POST /auth/register` | `ThrottlerGuard`, `@Throttle 5/min` | new org sign-up; stricter per-IP budget than the shared auth default to blunt email enumeration |
| `POST /auth/login` | `ThrottlerGuard` | issues tokens |
| `POST /auth/refresh` | `ThrottlerGuard` | exchange a refresh token (the token *is* the credential) |
| `POST /auth/logout` | — | end a session by its refresh token (204) |
| `POST /auth/logout-all` | `AuthGuard` | caller ends all their sessions |
| `GET /auth/me` | `AuthGuard` | the caller's identity |
| `POST /auth/change-password` | `AuthGuard` | caller changes own password |
| `POST /auth/forgot-password` / `reset-password` | `ThrottlerGuard` | opaque one-time-token reset |

Rate limiting is configured in `SecurityModule` via
`ThrottlerModule.forRoot([{ ttl: AUTH_RATE_TTL_SECONDS, limit: AUTH_RATE_LIMIT }])`.

## Access token — AuthGuard

`AuthGuard` (`auth.guard.ts`) extracts the `Bearer` token, verifies it with
`JwtService` (secret `JWT_ACCESS_SECRET`, TTL `ACCESS_TOKEN_TTL_SECONDS`, both in
`SecurityModule`), and on success populates the request-context store:

```ts
store.userId = claims.sub;  store.orgId = claims.orgId;
store.membershipId = claims.membershipId;  store.role = claims.role;
store.permissionsVersion = claims.permissionsVersion;
```

Before accepting the token it checks the **denylist** so a logged-out token is
refused before its natural expiry:

```ts
if (await this.denylist.isRevoked(claims.jti, claims.sub, claims.iat))
  throw new UnauthorizedException("Session has been logged out.");
```

## Refresh sessions — TokenService

`TokenService` (`token.service.ts`) mints access JWTs and manages refresh
sessions (a `Session` row per login). Refresh tokens are **opaque** and stored
only as **keyed hashes** (`hashRefreshToken(raw, JWT_REFRESH_SECRET)`) — the raw
value never touches the database.

### issue

```ts
const jti = randomUUID();
const session = await this.createSession(claims, jti); // sid embedded, accessTokenId=jti
const accessToken = await this.jwtService.signAsync({ ...claims, jti, sid: session.id });
return { accessToken, refreshToken: session.refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
```

The session is created first so its id is the token's `sid`, and the access
token's `jti` is recorded on the session (`accessTokenId`) so logout can
denylist that exact JWT. The session captures `ipAddress`/`userAgent` from the
request context. TTL = `REFRESH_TOKEN_TTL_DAYS`.

### Rotation + reuse detection (verifyAndConsume)

On refresh, the presented token is hashed and looked up. A valid, ACTIVE,
unexpired session is marked `ROTATED`, and the principal identifiers are
returned so the caller can **reload fresh role/permissions** before issuing new
tokens. Presenting an already-consumed (non-ACTIVE) or expired token is treated
as **theft** — the whole user family is revoked:

```ts
if (session.status !== "ACTIVE" || session.expiresAt <= new Date()) {
  await this.prisma.session.updateMany({ where: { userId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date() } });
  throw new UnauthorizedException("Refresh token is no longer valid.");
}
```

Because refresh reloads permissions, a role change takes effect on the next
refresh even if the current access token still carries stale claims (and
authorization always re-reads the bundle anyway).

## Logout & revocation

- **Single-session logout** — `revoke(rawRefreshToken)`: marks the session
  `REVOKED` and `denyJti(session.accessTokenId)` so the still-valid access token
  is rejected immediately. Idempotent (returns `null` if no active session).
- **Logout everywhere** — `revokeAllForUser(userId)`: revokes every ACTIVE
  session and sets a per-user cutoff via `denyUserBefore(userId, now)` so *all*
  outstanding access tokens issued before that instant fail the denylist check.
  Returns the count revoked.

The `TokenDenylist` is a Redis-backed helper (`@retainiq/platform`) wired in
`SecurityModule` with a lazy client keyed to `ACCESS_TOKEN_TTL_SECONDS`; it fails
open if Redis is not yet connected.

## Session model & statuses

`Session` (identity-db) records `userId`, `membershipId`, `orgId`,
`refreshTokenHash` (unique), `accessTokenId`, `expiresAt`, `ipAddress`,
`userAgent`, and a `SessionStatus` of `ACTIVE | ROTATED | REVOKED`. A single user
can hold multiple concurrent sessions — different orgs, devices, or tabs — each
its own row; `orgId`/`membershipId` on the session bind it to the org context it
was minted for (multi-org login).

## Platform-admin sessions (separate)

Super-admin auth is a **parallel** stack (`src/modules/platform-admin`):
`PlatformTokenService` + `PlatformAdmin`/`PlatformAdminSession` tables + a
dedicated `PLATFORM_DENYLIST` keyed to `PLATFORM_ACCESS_TTL_SECONDS` (8h), kept
apart from the org denylist (15m). See `Platform-Admin.md`.
