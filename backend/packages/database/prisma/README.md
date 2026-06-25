# Prisma Database Package

This package owns the RetainIQ PostgreSQL schema and generated Prisma client.

## Commands

```bash
npm run db:generate -w @retainiq/database
npm run db:migrate -w @retainiq/database
npm run db:studio -w @retainiq/database
```

## Tenancy Rules

- Every tenant-owned model must include `orgId`.
- Every tenant-owned model needs indexes that start with `orgId`.
- Application modules should access Prisma through tenant-scoped repositories.
- Do not use Prisma for high-volume ClickHouse analytics.

