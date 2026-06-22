# Shared Packages Publishing Strategy

This document defines how shared packages (`@retainiq/*`) are managed, versioned, and published across microservices.

## Current Structure

```
packages/
├── authz/              # RBAC, permissions, policies
├── config/             # Typed environment configuration
├── contracts/          # DTO schemas, event contracts, Zod validators
├── database/           # Prisma ORM, migrations, seed scripts
├── messaging/          # Event broker abstraction (Redis, Kafka)
├── observability/      # Logging, tracing, metrics
└── platform/           # Common utilities
```

## Publishing Options

### Option 1: NPM Registry (Recommended for Enterprise)

**Pros:**
- Standard Node.js package management
- Versioning & semver
- Immutable package versions
- Great CI/CD integration

**Cons:**
- Requires npm private registry (Verdaccio, npm Pro, GitHub Packages)
- Small overhead per publish

**Setup:**

```json
// Each package/*/package.json
{
  "name": "@retainiq/authz",
  "version": "1.0.0",
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "repository": "https://github.com/retainiq/retain"
}
```

**CI/CD Publish (GitHub Actions):**
```yaml
name: Publish Packages
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build -w @retainiq/authz
      - run: npm publish -w @retainiq/authz
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

### Option 2: Monorepo Workspaces (Current Setup - Fast)

**Pros:**
- No registry overhead
- Instant updates
- Great for rapid development
- Exact same source in all services

**Cons:**
- Couples deployment versions
- Harder to have different versions per service

**Current State:**
All services already use workspace dependencies:

```json
// apps/identity-service/package.json
{
  "dependencies": {
    "@retainiq/authz": "*",
    "@retainiq/contracts": "*",
    "@retainiq/database": "*"
  }
}
```

**Pros & Cons Summary:**
```
Workspace (current)      → Fast, simple, highly coupled
NPM Registry            → Distributed, versioned, decoupled
```

---

## Recommended Migration Path

### Phase 1: Current (Monorepo)
- Keep all services in single repo
- Monorepo workspaces for development
- Shared packages auto-updated

### Phase 2: Separate Repos (Future)
- Extract each service to its own repo
- Publish shared packages to npm/GitHub Packages
- Services fetch via package.json dependencies

---

## Version Management

### Semantic Versioning

```
@retainiq/authz@1.2.3
                ^major.minor.patch

- major: Breaking API changes
- minor: Backward-compatible features
- patch: Bug fixes
```

### Examples

```typescript
// v1.0.0
export function canManageTeam(role: string): boolean

// v1.1.0 (backward compatible)
export function canManageTeam(role: string, orgType?: 'startup' | 'enterprise'): boolean

// v2.0.0 (breaking)
export function canManageTeam(user: User, resource: Team): boolean  // Different signature
```

### Changelog

Each package should have `CHANGELOG.md`:

```markdown
# @retainiq/authz Changelog

## [1.1.0] - 2025-01-15
### Added
- New `canAccessReport` policy check

### Changed
- Deprecated `isAdmin()`, use `hasRole('admin')` instead

### Fixed
- Role inheritance bug in composite policies

## [1.0.0] - 2025-01-01
### Initial Release
- RBAC core functionality
- Policy engine
- Role inheritance
```

---

## Package Consumption

### In Development (Monorepo)

Services automatically use latest from workspace:

```typescript
// In apps/identity-service/src/auth.service.ts
import { AuthzService } from '@retainiq/authz';  // From packages/authz/src

const authz = new AuthzService();
```

### After Separation (Independent Repos)

**apps/identity-service package.json:**
```json
{
  "dependencies": {
    "@retainiq/authz": "^1.1.0",
    "@retainiq/contracts": "^2.0.0",
    "@retainiq/database": "^1.3.0"
  }
}
```

**Installation:**
```bash
npm install  # Fetches from npm registry
```

---

## Build & Publication Pipeline

### Manual Publishing (For MVP)

```bash
# 1. Update version
npm version patch -w @retainiq/authz

# 2. Build
npm run build -w @retainiq/authz

# 3. Publish
npm publish -w @retainiq/authz
```

### Automated Publishing (Recommended)

**GitHub Actions workflow:**

```yaml
name: Publish Changed Packages

on:
  push:
    branches: [main]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      
      - uses: actions/setup-node@v3
        with:
          node-version: '22'
          registry-url: 'https://npm.pkg.github.com'
      
      - run: npm ci
      
      # Detect which packages changed
      - name: Check Package Changes
        id: changes
        run: |
          CHANGED=$(git diff --name-only HEAD~1 | grep 'packages/' | cut -d'/' -f2 | sort -u)
          echo "packages=$CHANGED" >> $GITHUB_OUTPUT
      
      # Build & publish each changed package
      - name: Build & Publish
        run: |
          for pkg in ${{ steps.changes.outputs.packages }}; do
            npm run build -w "@retainiq/$pkg"
            npm publish -w "@retainiq/$pkg"
          done
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Contract Management

### Event Contracts (@retainiq/contracts)

```typescript
// packages/contracts/src/events.ts

export interface UserCreatedEvent {
  eventId: string;
  eventType: 'user.created';
  userId: string;
  email: string;
  orgId: string;
  createdAt: string;
}

export interface ActivityEvent {
  eventId: string;
  eventType: 'activity.logged';
  employeeId: string;
  duration: number;
  appName: string;
}

// Zod validation schema
export const userCreatedEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal('user.created'),
  userId: z.string(),
  email: z.string().email(),
  orgId: z.string(),
  createdAt: z.string().datetime(),
});

export type UserCreatedEvent = z.infer<typeof userCreatedEventSchema>;
```

**Usage in services:**

```typescript
// In identity-service
import { userCreatedEventSchema } from '@retainiq/contracts';

const event = userCreatedEventSchema.parse({
  eventId: '123',
  eventType: 'user.created',
  userId: 'user-456',
  email: 'test@example.com',
  orgId: 'org-789',
  createdAt: new Date().toISOString()
});

// In event-processor
import { userCreatedEventSchema } from '@retainiq/contracts';

const parsed = userCreatedEventSchema.safeParse(receivedEvent);
if (!parsed.success) throw new Error('Invalid event schema');
```

---

## Dependency Graph

**Recommended dependency hierarchy** (lower depends on upper):

```
All services
    ↓
@retainiq/observability
    ↓
@retainiq/config
@retainiq/contracts
    ↓
@retainiq/authz
@retainiq/database
@retainiq/messaging
    ↓
@retainiq/platform
```

**Rules:**
- Avoid circular dependencies
- Contracts should NOT depend on anything (fundamental types)
- Platform utilities should have minimal dependencies

---

## Documentation & API Reference

Each package should document its public API:

### @retainiq/authz

**Purpose:** RBAC & permission checks

**Usage:**
```typescript
import { AuthzService, Role, Permission } from '@retainiq/authz';

const authz = new AuthzService();

// Check permission
const canManage = authz.can(user, 'manage:employees');

// Get user roles
const roles = authz.getRoles(user);

// Check role
const isManager = authz.hasRole(user, 'manager');
```

### @retainiq/contracts

**Purpose:** Shared types & validation schemas

**Usage:**
```typescript
import { userCreatedEventSchema, ActivityEvent } from '@retainiq/contracts';

const validated = userCreatedEventSchema.parse(data);
const event: ActivityEvent = { ... };
```

### @retainiq/database

**Purpose:** Prisma ORM setup & migrations

**Usage:**
```typescript
import { prisma } from '@retainiq/database';

const user = await prisma.user.findUnique({ where: { id: userId } });
```

### @retainiq/messaging

**Purpose:** Event broker abstraction

**Usage:**
```typescript
import { StreamPublisher, StreamConsumer } from '@retainiq/messaging';

const publisher = new StreamPublisher('retainiq.events');
await publisher.publish(event);

const consumer = new StreamConsumer('retainiq.events', 'my-consumer-group');
const events = await consumer.read();
```

---

## Testing

### Unit Tests in Packages

```bash
npm run test -w @retainiq/authz
```

### Integration Tests

```bash
npm run test:integration  # Tests all packages together
```

### Example: @retainiq/authz Tests

```typescript
// packages/authz/src/authz.service.spec.ts

describe('AuthzService', () => {
  it('should allow manager to manage employees', () => {
    const user = { roles: ['manager'] };
    const authz = new AuthzService();
    expect(authz.can(user, 'manage:employees')).toBe(true);
  });

  it('should deny employee from deleting org', () => {
    const user = { roles: ['employee'] };
    const authz = new AuthzService();
    expect(authz.can(user, 'delete:org')).toBe(false);
  });
});
```

---

## Troubleshooting

### Package Not Found

```
Error: Cannot find module '@retainiq/authz'
```

**Solution:**
1. Ensure package exists in `packages/authz`
2. Run `npm ci` to install workspaces
3. Run `npm run build -w @retainiq/authz`

### Version Mismatch

**Problem:** Two services depend on different versions of a package.

**Solution (with monorepo):** Not possible—all use same version.

**Solution (with npm registry):** Use `^` to allow compatible versions:
```json
{
  "dependencies": {
    "@retainiq/authz": "^1.2.0"  // Allows 1.2.0, 1.3.0, but not 2.0.0
  }
}
```

---

## Future: Separate Repositories

When ready to split services into independent repos:

```
github.com/retainiq/identity-service              (depends on @retainiq/*)
github.com/retainiq/activity-ingestion     (depends on @retainiq/*)
github.com/retainiq/event-processor         (depends on @retainiq/*)
github.com/retainiq/packages              (publishes @retainiq/* to npm)
```

**Migration Steps:**
1. Create `github.com/retainiq/packages` repo
2. Move `packages/*` there
3. Publish to npm registry with CI/CD
4. Update each service to fetch from npm
5. Create separate repos for each service
