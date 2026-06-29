#!/usr/bin/env node
// Coherent Customer-Success demo data. The various seeds set billing seats,
// identity employees/sessions and analytics activity facts INDEPENDENTLY, so
// health scores came out uniformly "at risk". This script assigns each org an
// engagement PROFILE and writes consistent data across all three stores so the
// dashboard shows a believable healthy / attention / at-risk spread:
//   seats (billing) ~ activeEmployees/utilization, activity facts (analytics)
//   with varied active-days + productivity, and session recency (identity).
// Idempotent: re-running re-derives every org from its profile. Run with:
//   node backend/scripts/seed-customer-success-demo.mjs   (then restart identity-service)
import { execSync } from "node:child_process";

const DBS = {
  identity: ["retainiq-identity-db", "identity", "retainiq-identity"],
  billing: ["retainiq-billing-db", "billing", "retainiq-billing"],
  analytics: ["retainiq-analytics-db", "analytics", "retainiq-analytics"],
};
const psql = (db, sql) => {
  const [c, u, d] = DBS[db];
  return execSync(`docker exec -i ${c} psql -U ${u} -d ${d} -v ON_ERROR_STOP=1 -tA`, { input: sql }).toString().trim();
};

// activeEmployees, target seat-utilization, active days (last 30), productivity
// band, hours/day and session recency (days ago). Tuned so the weighted score
// (35% freq / 35% util / 30% adoption) lands in the intended band.
const PROFILE = {
  thriving: { emp: 18, util: 0.9, days: 27, pmin: 82, pmax: 95, hours: 7.6, recency: 0 },
  steady: { emp: 14, util: 0.7, days: 19, pmin: 74, pmax: 86, hours: 7.0, recency: 5 },
  slipping: { emp: 8, util: 0.45, days: 9, pmin: 64, pmax: 76, hours: 5.8, recency: 11 },
  at_risk: { emp: 4, util: 0.22, days: 3, pmin: 58, pmax: 70, hours: 4.5, recency: 22 },
  dormant: { emp: 0, util: 0, days: 0, pmin: 0, pmax: 0, hours: 0, recency: null },
};
// Repeating pattern gives a balanced mix; orgs with no login session become dormant.
const PATTERN = ["thriving", "steady", "slipping", "at_risk", "thriving", "steady", "slipping", "thriving", "steady", "at_risk"];

const rows = psql(
  "identity",
  `SELECT o.id || '|' || (CASE WHEN EXISTS(SELECT 1 FROM "Session" s WHERE s."orgId" = o.id) THEN '1' ELSE '0' END)
   FROM "Organization" o WHERE o.status <> 'DELETED' ORDER BY o."createdAt"`,
);
const orgs = rows.split("\n").filter(Boolean).map((l) => {
  const [id, hasSession] = l.split("|");
  return { id, hasSession: hasSession === "1" };
});
if (orgs.length === 0) {
  console.log("No organizations found — nothing to seed.");
  process.exit(0);
}

const billing = [];
const sessions = [];
const facts = [];
const employees = [];
const tally = {};
orgs.forEach((o, i) => {
  const key = o.hasSession ? PATTERN[i % PATTERN.length] : "dormant";
  const p = PROFILE[key];
  tally[key] = (tally[key] ?? 0) + 1;

  const seats = p.emp > 0 ? Math.max(p.emp, Math.round(p.emp / p.util)) : 12 + (i % 5) * 3;
  billing.push(`UPDATE "Subscription" SET seats = ${seats}, "activeSeats" = ${Math.min(seats, p.emp || 1)} WHERE "orgId" = '${o.id}';`);

  // Provision identity Employee rows to match the profile headcount so the
  // seat-sync reconciler derives a realistic activeSeats (CSGEN-* are ours;
  // delete-then-insert keeps it idempotent — they carry no attendance/FKs).
  employees.push(`DELETE FROM "Employee" WHERE "orgId" = '${o.id}' AND "employeeCode" LIKE 'CSGEN-%';`);
  if (p.emp > 0) {
    employees.push(
      `INSERT INTO "Employee"(id,"orgId","employeeCode","firstName","lastName",status,"createdAt","updatedAt")
       SELECT gen_random_uuid(), '${o.id}'::uuid, 'CSGEN-'||g, 'Member', g::text, 'ACTIVE', now(), now()
       FROM generate_series(1, ${p.emp}) g;`,
    );
  }

  if (p.recency !== null) {
    sessions.push(`UPDATE "Session" SET "lastUsedAt" = now() - interval '${p.recency} days' WHERE "orgId" = '${o.id}';`);
  }

  facts.push(`DELETE FROM "EmployeeDayFact" WHERE "orgId" = '${o.id}';`);
  if (p.emp > 0) {
    const active = Math.round(p.hours * 3600);
    facts.push(
      `INSERT INTO "EmployeeDayFact"(id,"orgId","employeeId",day,"activeSeconds","idleSeconds","productiveSeconds","eventCount","productivityScore","focusScore","createdAt","updatedAt")
       SELECT gen_random_uuid(), '${o.id}'::uuid, e.eid, d::date,
              ${active}, ${Math.round(active * 0.25)}, ${Math.round(active * 0.8)}, 120 + (random()*180)::int,
              ${p.pmin} + random()*${p.pmax - p.pmin}, ${p.pmin} + random()*${p.pmax - p.pmin}, now(), now()
       FROM (SELECT gen_random_uuid() eid FROM generate_series(1, ${p.emp})) e
       CROSS JOIN generate_series((now()::date - ${p.days - 1}), now()::date, interval '1 day') d;`,
    );
  }
});

psql("billing", billing.join("\n"));
psql("identity", [...employees, ...sessions].join("\n"));
psql("analytics", facts.join("\n"));

console.log("Customer-success demo seed complete. Profile mix:");
for (const [k, n] of Object.entries(tally)) console.log(`  ${k.padEnd(10)} ${n} orgs`);
console.log("Restart identity-service to clear the 30s cache, then reload /customer-success.");
