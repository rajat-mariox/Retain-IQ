#!/usr/bin/env bash
# Demo data for billing-db. Reads org IDs from identity-db and provisions a
# subscription + 12 months of PAID invoices per org, directly in billing-db.
# Idempotent (ON CONFLICT DO NOTHING). Plans must already be seeded (billing-service
# does this on boot). Run after `docker compose up`:
#   bash backend/scripts/seed-billing-demo.sh
set -euo pipefail

ID_DB="docker exec -i retainiq-identity-db psql -U identity -d retainiq-identity"
BILL_DB="docker exec -i retainiq-billing-db psql -U billing -d retainiq-billing"

# org_id:ordinal pairs (ordinal drives deterministic plan assignment).
ROWS=$($ID_DB -tAc "SELECT id || ':' || (row_number() over (order by \"createdAt\") - 1) FROM \"Organization\"")

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

WITH plan_pick AS (
  SELECT o.org_id,
         (ARRAY['free','starter','growth','enterprise'])[1 + (o.ord % 4)] AS plan_id,
         8 + (o.ord * 7 % 32) AS seats
  FROM org_seed o
),
ins_sub AS (
  INSERT INTO "Subscription"(
    id, "orgId", "planId", status, seats, "activeSeats",
    "currentPeriodStart", "currentPeriodEnd", "autoRenew", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), pp.org_id, pp.plan_id, 'ACTIVE'::"SubscriptionStatus",
         pp.seats, pp.seats,
         date_trunc('month', now()), date_trunc('month', now()) + interval '1 month',
         true, now(), now()
  FROM plan_pick pp
  ON CONFLICT ("orgId") DO NOTHING
  RETURNING id, "orgId", "planId", "activeSeats"
)
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
       s."activeSeats" * pl."pricePerSeat",
       s."activeSeats" * pl."pricePerSeat",
       0, 'USD', now(), now()
FROM ins_sub s
JOIN "Plan" pl ON pl.id = s."planId",
     generate_series(0, 11) g
WHERE pl."pricePerSeat" > 0
ON CONFLICT ("invoiceNumber") DO NOTHING;

SELECT (SELECT count(*) FROM "Subscription") AS subscriptions,
       (SELECT count(*) FROM "Invoice")      AS invoices;
SQL

echo "billing-db demo seed complete."
