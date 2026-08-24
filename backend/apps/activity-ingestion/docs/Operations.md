# activity-ingestion — Operations

How to configure, health-check, observe, and run the service. It is a stateless
Fastify/NestJS producer with no database, so operational surface area is small:
env config, two health endpoints, a Prometheus metrics endpoint, and structured
logging.

Files: `src/config.ts`, `src/health.controller.ts`, `src/metrics.controller.ts`,
`src/observability.ts`, `src/observability.module.ts`, `Dockerfile`,
`backend/infra/k8s/activity-ingestion.yaml`.

## Configuration (`src/config.ts`)

Env is parsed/validated with Zod at process start (`loadIngestionConfig()`); an
invalid env fails fast before the server listens. The schema is deliberately
minimal — the comment notes the service "needs neither the database nor the
refresh secret" — but reuses shared fragments from `@retainiq/config` to avoid
drift.

| Var | Schema | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | `nodeEnvSchema` | — | runtime mode |
| `PORT` | positive int | `3002` | HTTP listen port |
| `REDIS_URL` | url, **optional** | — | logout denylist (and Redis broker driver) |
| `JWT_ACCESS_SECRET` | string, min 16 | — | verifies identity-issued access tokens |
| `BROKER_DRIVER` | `brokerDriverSchema` (`redis`\|`kafka`) | — | broker selection |
| `KAFKA_BROKERS` | `kafkaBrokersSchema` | — | Kafka bootstrap list (kafka driver) |
| `LOG_LEVEL` | `logLevelSchema` | — | pino level |

Notes:

- **`REDIS_URL` is optional.** Without it, `TokenDenylist` is constructed with
  `null` and the revocation check fails open (`src/app.module.ts`); the Redis
  broker driver also needs it, so it is effectively required when
  `BROKER_DRIVER=redis`.
- The same `loadIngestionConfig()` is called from `main.ts`, `app.module.ts`,
  `broker.service.ts`, and `observability.ts` — each reads a fresh validated copy
  from `process.env`.
- `env` defaults to `process.env` but is a parameter, so config can be injected in
  tests.

## Health & readiness (`src/health.controller.ts`)

Two endpoints under the `v1` prefix:

| Endpoint | Meaning | Used by |
|---|---|---|
| `GET /v1/health` | **Liveness** — process is up. Returns `{ status: "ok", service: "ingestion-service", timestamp }`. Never checks dependencies. | k8s `startupProbe` + `livenessProbe` |
| `GET /v1/health/ready` | **Readiness** — broker reachable. `runHealthChecks({ broker: () => this.broker.ping() })`; **503** if the broker is down. | k8s `readinessProbe` |

The split is intentional: liveness must not flap when the broker blips (that would
kill pods), while readiness pulls a pod out of the Service until its broker
connection recovers.

Matching probe config (`backend/infra/k8s/activity-ingestion.yaml`):

```yaml
startupProbe:   { httpGet: { path: /v1/health,       port: http }, periodSeconds: 2,  failureThreshold: 30 }
livenessProbe:  { httpGet: { path: /v1/health,       port: http }, periodSeconds: 10 }
readinessProbe: { httpGet: { path: /v1/health/ready, port: http }, periodSeconds: 10, failureThreshold: 3 }
```

## Metrics (`src/metrics.controller.ts`, `src/observability.ts`)

- **`GET /v1/metrics`** renders Prometheus text
  (`Content-Type: text/plain; version=0.0.4`) from the shared registry:
  `return metrics.render()`.
- Singletons are created once in `src/observability.ts`:

  ```ts
  export const logger  = createLogger("ingestion-service", config.LOG_LEVEL);
  export const metrics = createMetrics("ingestion-service");
  ```

- **HTTP metrics are automatic.** `ObservabilityModule` registers an
  `APP_INTERCEPTOR` = `ObservabilityInterceptor(logger, metrics)` from
  `@retainiq/platform`, so request counts/latencies are recorded for every route
  without per-handler code. The module is `@Global()`, so the interceptor and
  metrics controller apply app-wide.

## Error handling & logging

- `ObservabilityModule` registers an `APP_FILTER` =
  `AllExceptionsFilter(httpAdapterHost, logger)` — a single place that turns thrown
  errors (including the guard's `UnauthorizedException` and the pipe's
  `BadRequestException`) into structured JSON responses and logs.
- `main.ts` uses `NestPinoLogger` with `bufferLogs: true` + `flushLogs()` so early
  bootstrap logs aren't lost, and `installProcessErrorHandlers(logger)`
  (`@retainiq/platform`) routes `unhandledRejection` / `uncaughtException` to the
  logger. A failed `bootstrap()` logs `logger.fatal` and exits `1`.

## Deployment

### Container (`Dockerfile`)

Multi-stage, built **from the monorepo root** (`node:24-alpine`):

- **build stage** — copies `backend/packages` + `backend/apps`, runs
  `npm install` (not `ci` — the root lockfile also lists the frontend workspace,
  intentionally absent from the backend build context, which would break `ci`),
  then `npm run build:packages && npm run build -w @retainiq/activity-ingestion`.
- **runtime stage** — `NODE_ENV=production`, copies `node_modules` + built
  packages + this app, `CMD ["node", "backend/apps/activity-ingestion/dist/main.js"]`.

Local scripts (`package.json`): `build` (`nest build`), `start`
(`node dist/main.js`), `start:dev` (`nest start --watch`), `lint`, `typecheck`.

### Kubernetes (`backend/infra/k8s/activity-ingestion.yaml`)

| Object | Key settings |
|---|---|
| `Deployment` | `replicas: 2`; container port **3002**; `PORT=3002`; env from `retainiq-config` ConfigMap + `retainiq-secrets` Secret; requests `250m`/`192Mi`, limits `1`/`384Mi`; `terminationGracePeriodSeconds: 30` |
| `Service` | ClusterIP, port `3002` → `http` |
| `HorizontalPodAutoscaler` | `2`–`20` replicas on **CPU 65%** (producer scales on CPU, not stream lag) |
| `PodDisruptionBudget` | `minAvailable: 1` |

The `command:` in the manifest is `["node", "apps/activity-ingestion/dist/main.js"]`
(runtime working dir differs from the Dockerfile default `CMD` path, which is
`backend/apps/...`); both resolve to the same compiled entrypoint.

> The producer's CPU-based HPA is intentionally distinct from the **consumers'**
> KEDA stream-lag autoscaling on `retainiq.activity` (see `Events.md`). Ingestion
> capacity tracks inbound request load; processing capacity tracks backlog depth.

## Operational checklist

- **Is it up?** `GET /v1/health` → `{ status: "ok" }`.
- **Can it publish?** `GET /v1/health/ready` → `200` (broker ping ok) vs `503`.
- **Throughput / latency / errors?** scrape `GET /v1/metrics`.
- **401 storms?** agent tokens expired/revoked, or `JWT_ACCESS_SECRET` drift vs
  identity-service — the guard rejects and `AllExceptionsFilter` logs them.
- **Readiness 503 loop?** broker unreachable — check `BROKER_DRIVER` + `REDIS_URL`
  / `KAFKA_BROKERS`.
