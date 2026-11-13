# Billing Lifecycle — Renewals, Dunning & Trials

Two time-driven workers move subscriptions forward: the **recurring-billing cycle**
(`src/lifecycle.ts`, `runBillingCycle`) and the **trial sweep** (`src/trial.ts`,
`runTrialExpiry`). Both are invoked from `main.ts`'s `billingCycle()` closure (line
348), which runs on boot and then every `LIFECYCLE_INTERVAL_MS` (default **6h**).

Ordering matters: `billingCycle()` runs the **trial expiry sweep first**, then the
billing cycle (`main.ts` line 350 → 364), with the comment *"Expire due trials
FIRST so the renewal loop never charges a lapsed trial."* Each is wrapped in
`.catch` so one failing sweep can't stop the other or crash the interval.

## Subscription status model

`SubscriptionStatus` (`prisma/billing/schema.prisma` line 17):

```
TRIALING → ACTIVE → PAST_DUE → SUSPENDED
              │         │
              │         └── (grace expires) → SUSPENDED
              └── CANCELED (terminal)
TRIALING → EXPIRED   (trial ended without converting)
TRIALING → ACTIVE    (convertTrial)
TRIALING → CANCELED  (cancelTrial)
```

MRR helpers treat anything **not** `ACTIVE`/`PAST_DUE` as $0 (noted in `trial.ts`
line 45), so an EXPIRED/SUSPENDED/CANCELED org drops out of revenue automatically.

## Recurring-billing cycle (`runBillingCycle`)

`runBillingCycle({ prisma, logger, paymentFailureRate })` loads **every**
subscription with its plan (`lifecycle.ts` line 52) and walks each one. It returns a
`CycleStats` tally `{ scanned, renewed, paymentsFailed, canceled, suspended }` and
logs it at the end. The per-subscription logic, in order:

### 1. Skip terminal

`CANCELED` subscriptions are skipped immediately (line 55).

### 2. Dunning escalation (PAST_DUE → SUSPENDED)

If `status === "PAST_DUE"`, it looks for an `OPEN` invoice whose `dueAt` is older
than the **14-day grace window** (`GRACE_DAYS = 14`, `lifecycle.ts` line 6):

```ts
const cutoff = new Date(now.getTime() - GRACE_DAYS * DAY_MS);
const stale = await prisma.invoice.findFirst({
  where: { subscriptionId: sub.id, status: "OPEN", dueAt: { lt: cutoff } },
});
if (stale) { /* → SUSPENDED, emit subscription.suspended, continue */ }
```

So a failed charge that goes unpaid for **> 21 days** total (7-day invoice due
window + 14-day grace) escalates to `SUSPENDED` (line 58-66). `SUSPENDED` subs are
then skipped (line 69) — the billing cycle never auto-resurrects them; identity's
`organization.reactivated` path or an admin action does.

### 3. Period-end → renew or expire

When `sub.currentPeriodEnd <= now` (line 72):

- **autoRenew off** → subscription goes `CANCELED` with `canceledAt = now`, emits
  `subscription.canceled` (*"…canceled (auto-renew off)"*), `continue` (lines 73-78).
- **autoRenew on** → renew:
  1. Advance the period: `periodStart = currentPeriodEnd`, `periodEnd =
     addPeriod(periodStart, plan.billingPeriod)` — `addPeriod` (line 9) adds a UTC
     year for `"yearly"` else a UTC month.
  2. Resolve the charge rate via `effectivePricing(locked, planPricingOf(plan))` —
     the subscription's **locked rate**, falling back to the live plan for
     pre-migration subs (line 85-88). Then `computePrice(pricing, sub.activeSeats)`.
  3. Attempt the charge: `paid = amount === 0 || chargeSucceeds()`.
  4. Create the period `Invoice` — `PAID` (paidAt=now, amountDue 0) or `OPEN`
     (amountDue=amount). A duplicate for the same period is swallowed via the
     `invoiceNumber` unique constraint (try/catch, lines 93-113) → idempotent re-run.
  5. Update the subscription: `status = paid ? "ACTIVE" : "PAST_DUE"`, new period
     bounds, `trialEndsAt: null` (line 115-119).
  6. Emit `subscription.renewed`; if unpaid, also emit `payment.failed` and bump
     `paymentsFailed` (lines 120-125).

Because a renewed subscription's `currentPeriodEnd` moves into the future, a
re-run within the same period is a no-op — the loop is **idempotent** by period.

### Simulated payments

There is **no real gateway yet**. `chargeSucceeds()` (line 50) is
`Math.random() >= paymentFailureRate` (`PAYMENT_FAILURE_RATE`, default `0.08`). The
code marks this as the single **Stripe integration point** (lifecycle.ts lines
33-34, 49): swapping `chargeSucceeds` for a real charge call is the entire payment
wiring. Zero-amount invoices (free plans) always "succeed" without a charge.

## Dunning state machine (summary)

| From | Trigger | To | Event |
|---|---|---|---|
| `ACTIVE` | period ended, charge **fails** | `PAST_DUE` | `subscription.renewed` + `payment.failed` |
| `PAST_DUE` | charge succeeds on next renewal | `ACTIVE` | `subscription.renewed` |
| `PAST_DUE` | `OPEN` invoice overdue > 14-day grace | `SUSPENDED` | `subscription.suspended` |
| `ACTIVE`/`PAST_DUE` | period ended, `autoRenew` off | `CANCELED` | `subscription.canceled` |
| `SUSPENDED` | — | (stays; not auto-resurrected) | — |

Note `PAST_DUE` still **renews** — a new invoice is issued each period even while
past-due; escalation to `SUSPENDED` is driven purely by the age of an unpaid
`OPEN` invoice, not by a counter of failed periods.

## Trial lifecycle (`src/trial.ts`)

A trial is a **STATE** of a subscription (`status = TRIALING`), never a separate
plan — the org gets the trial plan's full entitlements while trialing (`trial.ts`
lines 5-7). All trial writes funnel through this module so they emit consistent
`BillingEvent`s via the shared `emit()` helper (line 28).

### Trial start (at provisioning)

`handleOrganizationCreated` decides trial-vs-active up front (`main.ts` lines
106-110): a trial starts only when `plan.pricePerSeat > 0 && plan.trialEnabled`
(`startsTrial`). Free plans and trial-disabled plans start `ACTIVE` immediately. On
a trial, `trialStartedAt = now` and `trialEndsAt = now + trialDays` (per-plan
`trialDays`, defaulting to 14 when unset).

### Expiry sweep (`runTrialExpiry`)

`runTrialExpiry({ prisma, logger })` finds `TRIALING` subscriptions with
`trialEndsAt <= now` (line 52) and, per **Option B** (expire, don't silently
charge), moves each to `EXPIRED` and stamps `trialExpiredAt`:

```ts
const updated = await prisma.subscription.updateMany({
  where: { id: sub.id, status: "TRIALING" },   // re-checked inside the write
  data: { status: "EXPIRED", trialExpiredAt: now },
});
if (updated.count === 0) continue; // another run/actor already moved it
```

The `status: "TRIALING"` filter inside the `updateMany` (line 61-64) makes it safe
against concurrent runs. Each expiry records a `trial.expired` `BillingEvent`. The
org **keeps its plan reference** so the UI can prompt "choose a plan to continue",
but is no longer billable. Returns `{ scanned, expired }`.

**Downstream signal:** back in `main.ts` (lines 355-363), when `trial.expired > 0`
the caller queries the freshly-`EXPIRED` subs and publishes
`subscription.plan_changed` for each so identity busts its entitlement cache — a
lapsed trial's entitlements change immediately.

### Convert (`convertTrial`)

Only a `TRIALING` sub converts (else `409` from the API). It preserves plan + seats,
opens a fresh period (`now → now + 1mo/12mo` by `billingPeriod`), **re-locks the
rate** from the plan's current pricing at `sub.seats`, stamps `trialConvertedAt`,
sets `ACTIVE`, and emits `trial.converted` (`trial.ts` lines 82-116).

### Extend (`extendTrial`)

Only a `TRIALING` sub, `1–365` days. It extends from **the later of** the current
`trialEndsAt` or now (line 134) — so an already-lapsed trial resumes sensibly rather
than extending from a past date — and emits `trial.extended` with the new end date.

### Cancel (`cancelTrial`)

Only a `TRIALING` sub → `CANCELED` with `canceledAt = now`, history kept, emits
`trial.canceled` (lines 144-155).

All three admin actions are exposed on the plan-API under
`/v1/admin/subscriptions/:orgId/{convert,extend-trial,cancel-trial}` — `convert` and
`cancel` additionally publish `subscription.plan_changed` onto the stream
(`plan-api.ts` lines 298-318).

## Rate lock (historical pricing)

The rate lock is the mechanism that stops a plan-price edit from retroactively
rewriting an existing subscriber's bill. On `Subscription`, four nullable columns
snapshot the commercial terms (`schema.prisma` lines 81-84):

`lockedBasePrice`, `lockedIncludedSeats`, `lockedAdditionalSeatPrice`,
`lockedTotalPrice`.

They are written:

| When | Where |
|---|---|
| Provisioning (`organization.created`) | `main.ts` lines 125-128 (from `planPricingOf(plan)` at licensed seats) |
| Admin plan/seat change | `plan-api.ts` lines 216-221 (re-locked from target plan) |
| Trial conversion | `trial.ts` lines 105-108 |

They are **read** at renewal via `effectivePricing(locked, livePlan)`
(`contracts/pricing.ts` line 64): if all three lock components are present it uses
the lock; otherwise (pre-migration subs, `locked* = null`) it falls back to the live
plan. So a renewal always bills the agreed historical rate, and only an explicit
plan/seat change or conversion re-locks it. Admin changes take effect **at the next
renewal** — there is no mid-cycle proration (`plan-api.ts` line 167, Stripe
deferred).

## Related docs

- `Architecture.md` — process bootstrap, the interval scheduler, and config.
- `Database-Events.md` — the `BillingEvent` catalog these workers emit and the invoice/subscription schema.
