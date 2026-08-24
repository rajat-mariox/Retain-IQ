#!/usr/bin/env bash
# Demo data for billing-db. Creates ONE subscription per org with VARIED lifecycle
# states so the recurring-billing worker + the Subscriptions views are
# demonstrable: active, trialing, expiring-soon, renewal-due, non-renewing, and
# past-due (with overdue invoices that the worker escalates to suspended).
# Resets billing-db first, so it's reproducible. Run after `docker compose up`:
#   bash backend/scripts/seed-billing-demo.sh   (then restart billing-service)
set -euo pipefail

ID_DB="docker exec -i retainiq-identity-db psql -U identity -d retainiq-identity"
BILL_DB="docker exec -i retainiq-billing-db psql -U billing -d retainiq-billing"

ROWS=$($ID_DB -tAc "SELECT id || ':' || (row_number() over (order by \"createdAt\") - 1) FROM \"Organization\" WHERE status <> 'DELETED'")
if [ -z "${ROWS// }" ]; then
  echo "No organizations found in identity-db — nothing to seed."
  exit 0
fi

VALUES=""
while IFS=: read -r oid ord; do
  [ -z "$oid" ] && continue
  VALUES+="('${oid}'::uuid, ${ord}),"
done <<< "$ROWS"
VALUES="${VALUES%,}"

$BILL_DB -v ON_ERROR_STOP=1 <<SQL
CREATE TEMP TABLE org_seed(org_id uuid, ord int);
INSERT INTO org_seed(org_id, ord) VALUES ${VALUES};

-- Reset so the varied states below are reproducible.
DELETE FROM "BillingEvent";
DELETE FROM "Invoice";
DELETE FROM "Subscription";

WITH plan_pick AS (
  SELECT o.org_id, o.ord,
         (ARRAY['free','basic','professional','enterprise'])[1 + (o.ord % 4)] AS plan_id,
         8 + (o.ord * 7 % 32) AS seats,
         (CASE WHEN o.ord % 9 = 0 THEN 'TRIALING'
               WHEN o.ord % 6 = 1 THEN 'PAST_DUE'
               ELSE 'ACTIVE' END) AS status,
         (CASE
            WHEN o.ord % 9 = 0 THEN now() + interval '4 days'    -- trialing, ending soon
            WHEN o.ord % 6 = 1 THEN now() + interval '15 days'   -- past_due (dunning; period future)
            WHEN o.ord % 5 = 2 THEN now() + interval '5 days'    -- expiring soon
            WHEN o.ord % 5 = 3 THEN now() - interval '3 days'    -- renewal due
            WHEN o.ord % 5 = 4 THEN now() - interval '20 days'   -- overdue renewal
            ELSE now() + interval '20 days'                       -- active
          END) AS period_end,
         (5 + (o.ord % 4) * 8) AS overdue_days  -- 5/13/21/29: >14 -> worker suspends
  FROM org_seed o
),
ins_sub AS (
  INSERT INTO "Subscription"(
    id, "orgId", "planId", status, seats, "activeSeats",
    "currentPeriodStart", "currentPeriodEnd", "trialEndsAt", "autoRenew", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), pp.org_id, pp.plan_id, pp.status::"SubscriptionStatus",
         pp.seats, pp.seats,
         pp.period_end - interval '1 month', pp.period_end,
         (CASE WHEN pp.status = 'TRIALING' THEN pp.period_end ELSE NULL END),
         (pp.ord % 7 <> 0), now(), now()
  FROM plan_pick pp
  RETURNING id, "orgId", "planId", "activeSeats", status
),
hist AS (
  -- 11 months of PAID history (revenue trend) for paid plans.
  INSERT INTO "Invoice"(
    id, "orgId", "subscriptionId", "invoiceNumber", status,
    "issuedAt", "dueAt", "paidAt", "periodStart", "periodEnd",
    subtotal, "totalAmount", "amountDue", currency, "createdAt", "updatedAt")
  SELECT gen_random_uuid(), s."orgId", s.id,
         'INV-' || to_char(date_trunc('month', now()) - (g || ' month')::interval, 'YYYYMM')
                || '-' || left(replace(s."orgId"::text, '-', ''), 8),
         'PAID'::"InvoiceStatus",
         date_trunc('month', now()) - (g || ' month')::interval,
         date_trunc('month', now()) - (g || ' month')::interval + interval '7 day',
         date_trunc('month', now()) - (g || ' month')::interval + interval '1 day',
         date_trunc('month', now()) - (g || ' month')::interval,
         date_trunc('month', now()) - (g || ' month')::interval + interval '1 month',
         pl."basePrice" + GREATEST(0, s."activeSeats" - pl."includedSeats") * pl."additionalSeatPrice",
         pl."basePrice" + GREATEST(0, s."activeSeats" - pl."includedSeats") * pl."additionalSeatPrice", 0, 'USD', now(), now()
  FROM ins_sub s JOIN "Plan" pl ON pl.id = s."planId", generate_series(1, 11) g
  WHERE pl."additionalSeatPrice" > 0 OR pl."basePrice" > 0
  RETURNING 1
)
-- Open OVERDUE invoice for PAST_DUE subs (Failed Payments; worker may escalate to Suspended).
INSERT INTO "Invoice"(
  id, "orgId", "subscriptionId", "invoiceNumber", status,
  "issuedAt", "dueAt", "paidAt", "periodStart", "periodEnd",
  subtotal, "totalAmount", "amountDue", currency, "createdAt", "updatedAt")
SELECT gen_random_uuid(), s."orgId", s.id,
       'INV-DUE-' || left(replace(s."orgId"::text, '-', ''), 10),
       'OPEN'::"InvoiceStatus",
       now() - (pp.overdue_days + 7) * interval '1 day',
       now() - pp.overdue_days * interval '1 day',
       NULL,
       now() - interval '1 month', now(),
       pl."basePrice" + GREATEST(0, s."activeSeats" - pl."includedSeats") * pl."additionalSeatPrice",
       pl."basePrice" + GREATEST(0, s."activeSeats" - pl."includedSeats") * pl."additionalSeatPrice",
       pl."basePrice" + GREATEST(0, s."activeSeats" - pl."includedSeats") * pl."additionalSeatPrice", 'USD', now(), now()
FROM ins_sub s
JOIN plan_pick pp ON pp.org_id = s."orgId"
JOIN "Plan" pl ON pl.id = s."planId"
WHERE s.status = 'PAST_DUE' AND (pl."additionalSeatPrice" > 0 OR pl."basePrice" > 0);

SELECT (SELECT count(*) FROM "Subscription") AS subscriptions,
       (SELECT count(*) FROM "Invoice")      AS invoices;
SQL

echo "billing-db demo seed complete (varied lifecycle states)."
