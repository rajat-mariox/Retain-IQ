# Microservices Migration Guide

This guide provides step-by-step instructions to transition from the current monorepo setup to independent microservices.

## Current State → Target State

### Current State
- Single Dockerfile building all services
- Single docker-compose with all services from one image
- Monorepo with shared workspace dependencies
- All services deployed together

### Target State
- Independent Dockerfile per service
- docker-compose with separate builds per service
- Monorepo (or separate repos) with explicit package dependencies
- Services deployed independently with K8s orchestration

---

## Phase 1: Immediate (Development Environment)

### 1.1 Use New Docker Compose

```bash
# Instead of:
docker-compose up

# Use:
docker-compose -f docker-compose.yml up --build
```

**What it does:**
- Builds each service independently
- Uses isolated docker images per service
- Cleaner logs (per-service container)
- Easier to restart individual services

### 1.2 Test Each Service Independently

```bash
# Build only identity-service
docker-compose -f docker-compose.yml build identity-service

# Run only identity-service (still needs postgres, redis)
docker-compose -f docker-compose.yml up identity-service postgres redis

# Or locally without Docker:
npm run dev:identity
```

### 1.3 Verify Health Checks

```bash
# Test identity-service health
curl http://localhost:3001/health

# Test activity-ingestion health
curl http://localhost:3002/health

# Expected response:
{
  "status": "ok",
  "uptime": 1234,
  "checks": {
    "database": "ok",
    "redis": "ok"
  }
}
```

---

## Phase 2: Service Isolation (1-2 weeks)

### 2.1 Verify Service Boundaries

Ensure each service only exposes public endpoints (no internal DB access):

```typescript
// ✅ GOOD: activity-ingestion exposes events to Redis
@Controller('/ingest')
export class IngestionController {
  @Post('activity')
  async logActivity(@Body() event: ActivityEvent) {
    await this.broker.publish('retainiq.activity', event);
  }
}

// ❌ BAD: activity-ingestion directly accessing DB
// Remove this pattern:
@Injectable()
export class IngestionService {
  constructor(private prisma: PrismaClient) {}
  async getOrgConfig(orgId: string) {
    return this.prisma.org.findUnique({ where: { id: orgId } });
  }
}
```

**Action:** Audit code, move shared logic to packages.

### 2.2 Set Up Service Contracts

Create `@retainiq/contracts` with all DTO schemas:

```typescript
// packages/contracts/src/ingest.dto.ts
export class ActivityEventDto {
  @IsUUID()
  eventId: string;

  @IsString()
  orgId: string;

  @IsEnum(['app.usage', 'website.visit', 'idle'])
  eventType: string;

  @IsObject()
  data: Record<string, any>;
}
```

**Action:** Define DTOs for all service endpoints.

### 2.3 Add Service Discovery

Update `.env` to reference services by name:

```bash
# .env
CORE_API_URL=http://identity-service:3001      # In docker-compose network
REDIS_URL=redis://redis:6379
DATABASE_URL=postgresql://...

# Or for local development:
CORE_API_URL=http://localhost:3001
```

**Action:** Use environment variables, not hardcoded URLs.

---

## Phase 3: Independent Deployments (2-3 weeks)

### 3.1 Set Up Container Registry

Options:
- GitHub Container Registry (ghcr.io)
- AWS ECR
- Docker Hub

**Example: GitHub Container Registry**

```bash
# Authenticate
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Tag image
docker tag retainiq/identity-service:latest ghcr.io/retainiq/identity-service:v1.0.0

# Push
docker push ghcr.io/retainiq/identity-service:v1.0.0
```

### 3.2 Create CI/CD Pipeline

**GitHub Actions: Build & Push Services**

```yaml
name: Build and Push Services
on:
  push:
    branches: [main, develop]
    paths:
      - 'apps/identity-service/**'
      - 'services/identity-service/Dockerfile'

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2
      
      - name: Login to GHCR
        uses: docker/login-action@v2
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Build and push identity-service
        uses: docker/build-push-action@v4
        with:
          context: .
          file: services/identity-service/Dockerfile
          push: true
          tags: |
            ghcr.io/retainiq/identity-service:latest
            ghcr.io/retainiq/identity-service:${{ github.sha }}
```

### 3.3 Deploy to Kubernetes

```bash
# Create namespace
kubectl create namespace retainiq

# Apply configs
kubectl kustomize infra/k8s/services | kubectl apply -f -

# Verify deployments
kubectl get deployments -n retainiq
kubectl get pods -n retainiq
kubectl get services -n retainiq
```

### 3.4 Test Independently

```bash
# Scale identity-service
kubectl scale deployment identity-service -n retainiq --replicas=3

# Check logs
kubectl logs -f deployment/identity-service -n retainiq

# Port forward for local testing
kubectl port-forward svc/identity-service 3001:3001 -n retainiq
curl http://localhost:3001/health

# Update image
kubectl set image deployment/identity-service identity-service=ghcr.io/retainiq/identity-service:v1.0.1 -n retainiq
```

---

## Phase 4: Package Management (Ongoing)

### 4.1 Set Up npm Registry (Optional)

For distributing shared packages independently:

```bash
# Using GitHub Packages
npm login --registry=https://npm.pkg.github.com

# Set up .npmrc
cat > ~/.npmrc << 'EOF'
@retainiq:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
EOF
```

### 4.2 Publish Packages

```bash
# Update version
npm version minor -w @retainiq/authz

# Build
npm run build -w @retainiq/authz

# Publish
npm publish -w @retainiq/authz --registry https://npm.pkg.github.com
```

---

## Phase 5: Full Microservices (Ongoing)

### 5.1 Repository Separation (Optional)

When ready, extract services to separate repos:

```bash
# Create separate repo
git clone https://github.com/retainiq/retain.git retain-identity-service
cd retain-identity-service

# Keep only identity-service
git filter-branch --prune-empty --subdirectory-filter apps/identity-service

# Push to new repo
git remote add origin https://github.com/retainiq/identity-service.git
git push origin main
```

### 5.2 Service-Specific CI/CD

Each service gets its own workflow:

```yaml
# .github/workflows/identity-service.yml
name: Build Core API

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: test
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test -w @retainiq/identity-service
      - run: npm run build -w @retainiq/identity-service

  push:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: docker/build-push-action@v4
        with:
          file: services/identity-service/Dockerfile
          push: true
          tags: ghcr.io/retainiq/identity-service:${{ github.sha }}
```

---

## Checklist: Ready for Production

- [ ] Each service has independent Dockerfile ✅
- [ ] docker-compose builds each service separately ✅
- [ ] All services have health endpoints ✅
- [ ] Services communicate via Redis Streams (async) ✅
- [ ] Transactional outbox implemented in identity-service ✅
- [ ] Events worker processes events idempotently ✅
- [ ] K8s manifests created for each service ✅
- [ ] CI/CD builds & pushes images independently ✅
- [ ] Services can scale independently ✅
- [ ] Observability (logs, metrics, tracing) enabled ✅
- [ ] Circuit breakers & retry logic in place ✅
- [ ] Rate limiting configured per service ✅
- [ ] Secrets managed via K8s secrets / sealed-secrets ✅
- [ ] Network policies restrict inter-pod communication ✅
- [ ] Database migrations run on deployment ✅
- [ ] Load testing passed for peak traffic ✅

---

## Rollback Plan

If issues occur:

```bash
# Revert to old docker-compose
docker-compose down
docker-compose up --build  # Uses old single Dockerfile

# Or rollback K8s deployment
kubectl rollout undo deployment/identity-service -n retainiq
kubectl rollout undo deployment/activity-ingestion -n retainiq
```

---

## Monitoring the Transition

### Key Metrics

```promql
# HTTP request latency (should not increase)
histogram_quantile(0.95, http_request_duration_seconds)

# Event processing lag (should be < 5s)
redis_stream_lag{consumer_group="event-processor-group"}

# Error rate (should not increase)
rate(http_requests_total{status=~"5.."}[5m])

# Service availability (should be >= 99.9%)
up{service=~"identity-service|activity-ingestion|event-processor"}
```

### Alerts

Set up alerts for:
- Service down
- High request latency (p95 > 500ms)
- High error rate (> 1%)
- Event processing lag (> 30s)
- Database connection pool exhausted
- Redis memory > 80%

---

## Common Issues & Solutions

### Issue: Service can't connect to Postgres from Docker

**Solution:**
```yaml
# docker-compose.yml
services:
  identity-service:
    environment:
      # Use service name (DNS resolution within network)
      DATABASE_URL: postgresql://user:pass@postgres:5432/db
```

### Issue: Circular dependencies between services

**Solution:**
- Use events (async) instead of HTTP calls
- Move shared logic to packages
- Define clear service boundaries

### Issue: Lost events during deployment

**Solution:**
- Use transactional outbox (ensure at-least-once delivery)
- Implement idempotent inbox (ensure exactly-once processing)
- Use consumer groups for durable event processing

### Issue: Database migration conflicts

**Solution:**
```bash
# Run migrations before deployment
kubectl run migrate-job --image=retainiq/identity-service:v1.0.0 \
  -i --rm -- npm run db:migrate
```

---

## Next Steps

1. **Week 1-2:** Implement Phase 1 & 2 (local development)
2. **Week 3-4:** Implement Phase 3 (Kubernetes)
3. **Week 5+:** Optimize performance, set up monitoring, prepare for scale
