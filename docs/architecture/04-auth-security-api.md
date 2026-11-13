# Auth, Security, API, and Compliance Design

RetainIQ handles sensitive workforce data. Security and privacy must be core architecture, not a later hardening phase.

## 1. Identity Model

Separate these concepts:

```text
User       = login identity
Employee   = workforce profile in an organization
Membership = user access to an organization
Role       = named permission bundle
Policy     = contextual authorization rule
Session    = authenticated device/browser session
```

A user can belong to multiple organizations. A platform super-admin can access the SaaS control plane but must not automatically access tenant workforce data.

## 2. Login Flow

Recommended auth flow:

```text
Login
  -> verify password/SSO/OAuth
  -> verify MFA if required
  -> create session
  -> issue short-lived access JWT
  -> issue rotated refresh token
  -> write login audit event
```

Access token TTL:

```text
10-15 minutes
```

Refresh token TTL:

```text
7-30 days depending org policy
```

Refresh tokens must rotate. Reuse of an old refresh token should revoke the session family.

## 3. JWT Claims

```json
{
  "iss": "retainiq",
  "sub": "user_id",
  "org_id": "active_org_id",
  "membership_id": "membership_id",
  "role_id": "role_id",
  "permissions_version": 42,
  "session_id": "uuid",
  "token_use": "access",
  "iat": 1781840000,
  "exp": 1781840900
}
```

Do not put large permission arrays inside JWT. Store permission bundles in Redis and invalidate by `permissions_version`.

## 4. Authorization Model

Use RBAC plus ABAC.

RBAC examples:

- owner
- admin
- hr_admin
- manager
- employee
- finance_admin
- auditor

ABAC scopes:

- own profile only
- direct reports
- manager chain
- team
- department
- location
- whole organization
- platform super-admin

Permission examples:

```text
employee.read
employee.write
attendance.read
attendance.approve
screenshots.read
screenshots.download
payroll.read
payroll.approve
ai_risk.read
billing.manage
settings.security.manage
audit.read
```

Sensitive permissions such as screenshots, payroll, AI risk, and exports should be separate from generic admin access.

## 5. SSO and OAuth

Support order:

1. Email/password for MVP.
2. Google/Microsoft OAuth login.
3. SAML/OIDC SSO for enterprise.
4. SCIM provisioning for enterprise.

SSO requirements:

- domain verification
- forced SSO by domain/org
- just-in-time provisioning policy
- default role mapping
- IdP group mapping later
- SSO configuration audit logs

OAuth integration tokens must be encrypted with KMS envelope encryption.

## 6. API Gateway

Gateway responsibilities:

- TLS termination
- WAF integration
- request size limits
- IP rate limits
- route to services
- auth pre-check where useful
- bot/abuse controls
- API key validation for agents/integrations

Early stage:

```text
NGINX or Kong
```

AWS enterprise stage:

```text
CloudFront + WAF + AWS API Gateway or ALB + Kong
```

## 7. Rate Limiting

Use layered rate limits:

| Subject | Example |
| --- | --- |
| IP | login attempts, anonymous routes |
| user | web API calls |
| org | report generation, AI copilot |
| employee/device | activity ingestion |
| integration connection | provider sync/webhook traffic |
| API key | desktop agent ingestion |

Redis key examples:

```text
rl:ip:{ip}:login
rl:user:{user_id}:api
rl:org:{org_id}:reports
rl:device:{device_id}:ingest
rl:org:{org_id}:ai-copilot
```

Return:

```json
{
  "error": "rate_limited",
  "retry_after_seconds": 60
}
```

## 8. Idempotent API Writes

Require `Idempotency-Key` for:

- payroll calculations
- timesheet approval
- leave approval
- subscription update
- payment webhooks
- integration webhook processing
- report generation
- bulk imports

For non-critical activity ingestion, dedupe by source event IDs rather than requiring one HTTP idempotency key per event.

## 9. Webhook Security

All webhooks must:

- verify provider signature
- enforce timestamp freshness
- deduplicate provider event ID
- store raw webhook metadata
- process asynchronously
- avoid direct writes into business tables

Webhook flow:

```text
Provider webhook
  -> verify signature
  -> persist webhook receipt
  -> publish integration event
  -> async processor normalizes data
```

## 10. Audit Requirements

Audit events are required for:

- auth success/failure
- password/MFA changes
- SSO config changes
- user invites
- role changes
- employee data changes
- attendance corrections
- leave approvals
- timesheet approvals
- payroll exports
- billing changes
- integration connections
- screenshot views/downloads
- AI risk score views
- report exports
- admin impersonation

Critical audit writes should be in the same transaction as the business change, plus published to Kafka for downstream indexing.

## 11. Privacy Controls

Employee monitoring is sensitive. Build privacy controls early:

- org-level screenshot enable/disable
- department/team policy overrides
- sensitive app/site exclusions
- screenshot blur mode
- no screenshot mode for personal break
- role-specific access to screenshots
- audit every screenshot access
- retention policies
- employee-visible tracking policy

Do not store full URLs if the organization config says to store only domains.

Do not store window titles in clear text if they may contain sensitive customer data. Prefer hashes or redacted titles.

## 12. Data Export and Deletion

Support:

- employee data export
- org data export
- audit export
- report export
- retention-based deletion
- employee deletion/anonymization workflow

Deletion must account for:

- PostgreSQL rows
- ClickHouse events/facts
- S3 objects
- OpenSearch documents
- Redis cache
- backups and retention exceptions

For analytics, anonymization is often safer than physical deletion:

```text
employee_id retained for aggregate integrity
PII fields removed or replaced
```

## 13. Secrets and Encryption

Use:

- AWS KMS
- Secrets Manager or SSM Parameter Store
- envelope encryption for OAuth tokens
- TLS everywhere
- S3 SSE-KMS
- RDS encryption at rest
- Redis in-transit encryption where supported

Never log:

- passwords
- refresh tokens
- access tokens
- OAuth tokens
- payment details
- screenshot URLs with long TTL
- raw sensitive payroll data

## 14. API Error Format

Standardize errors:

```json
{
  "error": {
    "code": "attendance.already_checked_in",
    "message": "Employee is already checked in.",
    "request_id": "uuid",
    "details": {}
  }
}
```

Do not leak internal exception details to clients.

## 15. Security Baseline Checklist

Before production:

- MFA for admins.
- Refresh token rotation.
- Password hashing with Argon2id or bcrypt with strong cost.
- Email verification.
- Rate-limited login.
- Account lock/risk controls.
- Audit log pipeline.
- S3 private buckets only.
- Short-lived pre-signed URLs.
- Encrypted integration tokens.
- RBAC/ABAC backend guards.
- Tenant isolation tests.
- Dependency scanning in CI.
- Container image scanning.
- Security headers in frontend.

