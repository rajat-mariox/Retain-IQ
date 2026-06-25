# Terraform — Infrastructure as Code (skeleton)

> **Status: scaffolding.** This lays out the module structure and intended AWS
> resources from the architecture docs. It is intentionally not apply-ready —
> account IDs, networking, and module sources must be filled in per environment.

## Layout

```
infra/terraform/
  versions.tf        provider + backend (S3 state + DynamoDB lock)
  variables.tf       environment inputs (env name, region, sizing)
  main.tf            module wiring (commented module blocks)
  environments/
    staging/         tfvars + backend config for staging
    production/      tfvars + backend config for production
```

## Intended modules (per architecture docs §05)

| Module | Resource | Notes |
| --- | --- | --- |
| `network` | VPC, subnets, NAT | private subnets for data stores |
| `eks` | EKS cluster + node pools | pools: `general-api`, `worker`, `ai`, `observability` |
| `rds` | Aurora/RDS PostgreSQL | encryption at rest (KMS), PITR, read replicas (growth) |
| `elasticache` | Redis | cache + rate limiting + streams (until Kafka) |
| `msk` | Kafka (MSK) | added at Scale 2 (durable events/replay) |
| `s3` | buckets | screenshots/exports, SSE-KMS, lifecycle rules |
| `clickhouse` | ClickHouse Cloud / EC2 | analytics store (Scale 1+) |
| `secrets` | Secrets Manager / SSM | JWT, DB, OAuth tokens (envelope-encrypted) |
| `observability` | Managed Prometheus/Grafana or self-hosted | + Loki/Tempo |

## Workflow

```bash
cd infra/terraform/environments/staging
terraform init   # uses S3 backend
terraform plan -var-file=staging.tfvars
terraform apply  -var-file=staging.tfvars   # via CI with OIDC role, not local creds
```

Production applies run only from CI with a protected environment + manual approval.
State is backed up (S3 versioning); never edit resources by hand (break-glass only).
