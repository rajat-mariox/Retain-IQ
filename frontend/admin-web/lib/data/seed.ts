import type { MrrPoint, Organization, OrgStatus, Plan, PlanId, UsagePoint } from "./types";

// ---------------------------------------------------------------------------
// Deterministic mock dataset.
//
// Everything below is generated from a fixed seed + a fixed "now" anchor so the
// numbers are stable across requests and identical on server and client (no
// hydration drift). Swapping to a real platform-admin API later means replacing
// the modules in lib/data/* — this file goes away, the types do not.
// ---------------------------------------------------------------------------

/** Fixed reference time (matches the project's current date) for all date math. */
export const NOW = Date.parse("2026-06-24T12:00:00.000Z");

const DAY = 86_400_000;

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", pricePerSeat: 0, color: "#64748b" },
  basic: { id: "basic", name: "Basic", pricePerSeat: 8, color: "#3fa45b" },
  professional: { id: "professional", name: "Professional", pricePerSeat: 14, color: "#1f883d" },
  enterprise: { id: "enterprise", name: "Enterprise", pricePerSeat: 22, color: "#14532d" },
};

export const PLAN_ORDER: PlanId[] = ["free", "basic", "professional", "enterprise"];

/** Small, fast, deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(1337);
const rand = (min: number, max: number) => min + rng() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rng() * arr.length)];

const COMPANIES = [
  "Northwind Trading", "Aperture Labs", "Globex Systems", "Initech", "Umbrella Health",
  "Hooli", "Pied Piper", "Stark Industries", "Wayne Enterprises", "Wonka Industries",
  "Acme Robotics", "Cyberdyne", "Soylent Foods", "Tyrell Corp", "Massive Dynamic",
  "Vandelay Industries", "Gekko & Co", "Bluth Group", "Dunder Mifflin", "Prestige Worldwide",
  "Oscorp", "Nakatomi Trading", "Weyland Logistics", "Monarch Sciences", "Kruger Industrial",
  "Sterling Cooper", "Pearson Hardman", "Wernham Hogg", "Genco Pura", "Black Mesa",
];

const COUNTRIES = ["US", "UK", "India", "Germany", "Canada", "Australia", "Singapore", "France", "Brazil", "Netherlands"];

const SEAT_RANGES: Record<PlanId, [number, number]> = {
  free: [3, 12],
  basic: [8, 45],
  professional: [25, 130],
  enterprise: [70, 420],
};

function weightedPlan(): PlanId {
  const r = rng();
  if (r < 0.16) return "free";
  if (r < 0.52) return "basic";
  if (r < 0.86) return "professional";
  return "enterprise";
}

function weightedStatus(): OrgStatus {
  const r = rng();
  if (r < 0.7) return "active";
  if (r < 0.84) return "trialing";
  if (r < 0.92) return "suspended";
  return "churned";
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildOrganizations(): Organization[] {
  return COMPANIES.map((name, i): Organization => {
    const plan = weightedPlan();
    const status = weightedStatus();
    const [smin, smax] = SEAT_RANGES[plan];
    const seats = randInt(smin, smax);
    const activeSeats = Math.max(1, Math.round(seats * rand(0.55, 0.96)));
    const paying = status === "active" && plan !== "free";
    const mrr = paying ? PLANS[plan].pricePerSeat * activeSeats : 0;

    const createdAt = new Date(NOW - randInt(20, 760) * DAY).toISOString();
    const lastActiveOffsetDays =
      status === "churned" ? randInt(25, 140)
      : status === "suspended" ? randInt(6, 45)
      : rand(0, 3);
    const lastActiveAt = new Date(NOW - lastActiveOffsetDays * DAY).toISOString();

    return {
      id: `org_${(i + 1).toString().padStart(3, "0")}`,
      name,
      slug: slugify(name),
      country: pick(COUNTRIES),
      plan,
      status,
      seats,
      activeSeats,
      mrr,
      users: activeSeats + randInt(1, 4),
      employees: Math.round(seats * rand(1.0, 1.45)),
      avgProductivity: Math.round(rand(55, 92)),
      activeHours: Math.round(activeSeats * rand(58, 142)),
      createdAt,
      lastActiveAt,
    };
  });
}

export const ORGANIZATIONS: Organization[] = buildOrganizations();

/** 30-day cross-org usage series with a weekly dip + gentle upward trend. */
function buildUsageSeries(): UsagePoint[] {
  const activeOrgs = ORGANIZATIONS.filter((o) => o.status === "active" || o.status === "trialing");
  const dailyBase = activeOrgs.reduce((sum, o) => sum + o.activeHours, 0) / 30;

  const points: UsagePoint[] = [];
  for (let d = 29; d >= 0; d -= 1) {
    const date = new Date(NOW - d * DAY);
    const dow = date.getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 0.45 : 1;
    const trend = 1 + (29 - d) * 0.006; // ~18% growth across the window
    const noise = rand(0.9, 1.1);
    const activeHours = Math.round(dailyBase * weekend * trend * noise);
    const idleHours = Math.round(activeHours * rand(0.32, 0.48));
    const productiveHours = Math.round(activeHours * rand(0.6, 0.74));
    points.push({
      date: date.toISOString().slice(0, 10),
      activeHours,
      idleHours,
      productiveHours,
      avgProductivity: Math.round(rand(68, 84) + (29 - d) * 0.05),
    });
  }
  return points;
}

export const USAGE_SERIES: UsagePoint[] = buildUsageSeries();

/** 12-month MRR trend reconstructed backwards from the current paying MRR. */
function buildMrrTrend(): MrrPoint[] {
  const currentMrr = ORGANIZATIONS.reduce((sum, o) => sum + (o.mrr ?? 0), 0);
  const months: MrrPoint[] = [];
  let mrr = currentMrr;
  const fmt = (dt: Date) => dt.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

  for (let m = 0; m < 12; m += 1) {
    const dt = new Date(Date.UTC(2026, 5 - m, 1));
    const newMrr = Math.round(mrr * rand(0.05, 0.11));
    const churnedMrr = Math.round(mrr * rand(0.02, 0.05));
    months.unshift({ month: fmt(dt), mrr: Math.round(mrr), newMrr, churnedMrr });
    // Walk backwards: previous month = current minus net new.
    mrr = Math.max(0, mrr - newMrr + churnedMrr);
  }
  return months;
}

export const MRR_TREND: MrrPoint[] = buildMrrTrend();
