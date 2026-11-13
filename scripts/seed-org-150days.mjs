/**
 * Seeds 15 days of realistic operational history for every employee in the
 * Mariox org, so the app can be exercised end to end against data that hangs
 * together.
 *
 * The guiding rule: analytics is the source of truth. Each person-day already
 * has an EmployeeDayFact (activeSeconds, productivity, focus) driving the
 * dashboards, so attendance, timesheets and time entries are DERIVED from that
 * same number instead of being invented separately. A day analytics reports as
 * 6.2 active hours becomes a 6.2-hour attendance day and a 6.2-hour timesheet —
 * the three views can never disagree. Where analytics has no fact for a day
 * (the two DBs cover different windows), a fact is generated first from the
 * person's own profile, and attendance follows from it.
 *
 * Everything is deterministic (seeded PRNG) and idempotent (ON CONFLICT DO
 * NOTHING / existence guards), so re-running changes nothing. It only ever
 * touches the Mariox org, and it never rewrites an existing password.
 *
 * Usage: node scripts/seed-org-demo.mjs [--dry]
 */
import { execFileSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";

const ORG = "b5fa0d83-a318-4708-aafb-61f970b9128e";
const DRY = process.argv.includes("--dry");

/** Today, in the org's timezone terms; the seed window is the 150 days ending here. */
const TODAY = process.env.SEED_TODAY || new Date().toISOString().slice(0, 10);
const WINDOW_DAYS = 150;

const ROLES = {
  Owner: "67cc87cd-9b84-40dd-a806-a892573d1259",
  Manager: "b1623e53-17b6-4009-b122-11369f8bbb91",
  Employee: "661c5b48-bf70-4f4c-a99d-fd988993bb02",
};
const SHIFT_GENERAL = "702a9516-8279-4100-a012-8a4b8df97653"; // 09:30–17:30 IST
const LEAVE_TYPE = {
  CL: "f496e59e-57a8-468a-a1e9-74236bd3685e",
  SL: "6a94a100-fd46-4054-9db7-9b7560ae236d",
  PL: "27d55a02-bbe9-4316-a4c5-c1e3564e977e",
};
const PROJECT = {
  retainiq: "fb4be54c-69c1-4740-975e-d2a755493e61",
  revamp: "eb40a29e-1931-4ce4-9c85-c64b52c74ba3",
  ops: "b2000000-0000-4000-8000-000000000003",
};

const OWNER_EMP = "e341bf8f-5e9b-4314-89ee-b8120a8ad4bb";
const OWNER_USER = "c298a1f8-ac04-40a7-a082-730344718fef";
const MANAGER_EMP = "1e1ededa-cf78-45c8-a356-fb975fe57aa0";

/** Attendance policy as configured for this org (AttendancePolicy row). */
const POLICY = {
  graceMinutes: 10,
  paidBreakMinutesPerDay: 15,
  minHoursForPresent: 240, // minutes
  shiftStartMinute: 570, // 09:30 IST
  shiftEndMinute: 1050, // 17:30 IST
  shiftMinutes: 480,
};
const IST_OFFSET = 330; // minutes ahead of UTC

/**
 * Per-person behavioural profile. `productivity` and `hours` describe the
 * person's typical day and are used ONLY to fill days analytics has no fact
 * for; where a fact exists it always wins. The named archetypes line up with
 * the AI-recommendation scenarios the insights engine looks for.
 */
const PEOPLE = [
  { emp: "a1000001-0000-4000-8000-000000000001", email: "aarav.mehta@demo.local", name: "Aarav Mehta", role: "Employee", project: "retainiq", archetype: "burnout", hours: 9.7, needsLogin: true },
  { emp: "a1000002-0000-4000-8000-000000000002", email: "diya.sharma@demo.local", name: "Diya Sharma", role: "Employee", project: "revamp", archetype: "disengaged", hours: 2.4, needsLogin: true },
  { emp: "a1000003-0000-4000-8000-000000000003", email: "kabir.nair@demo.local", name: "Kabir Nair", role: "Employee", project: "retainiq", archetype: "healthy", hours: 6.9, needsLogin: true },
  { emp: "a1000004-0000-4000-8000-000000000004", email: "ishita.rao@demo.local", name: "Ishita Rao", role: "Employee", project: "ops", archetype: "improving", hours: 6.4, needsLogin: true },
  { emp: "a1000005-0000-4000-8000-000000000005", email: "rohan.gupta@demo.local", name: "Rohan Gupta", role: "Employee", project: "revamp", archetype: "declining", hours: 6.2, needsLogin: true },
  { emp: "a1000006-0000-4000-8000-000000000006", email: "meera.iyer@demo.local", name: "Meera Iyer", role: "Employee", project: "ops", archetype: "healthy", hours: 6.2, needsLogin: true },
  // Existing accounts: history is filled in, credentials are left untouched.
  { emp: "e8846e77-d913-45ed-884c-96cff0222530", email: "testdeveloper@yopmail.com", name: "Test Developer", role: "Employee", project: "retainiq", archetype: "healthy", hours: 5.1, needsLogin: false },
  { emp: "3f00d11a-2562-4e25-99b5-cd21c18c288d", email: "testdevops@yopmail.com", name: "Test devops", role: "Employee", project: "ops", archetype: "healthy", hours: 5.0, needsLogin: false },
  { emp: MANAGER_EMP, email: "testmanager@yopmail.com", name: "Test Manager", role: "Manager", project: "retainiq", archetype: "healthy", hours: 6.0, needsLogin: false },
  // The Owner runs the org rather than working shifts, so they are deliberately
  // excluded from attendance/timesheets (see OrgRolesService) — analytics only.
  { emp: OWNER_EMP, email: "sarvesh@marioxsoftware.com", name: "Sarvesh Singh", role: "Owner", project: "retainiq", archetype: "healthy", hours: 5.3, needsLogin: false, ownerExcluded: true },
];

const DEMO_PASSWORD = "Demo@1234";

// ---------------------------------------------------------------- utilities

/** Deterministic PRNG so repeated runs produce byte-identical data. */
function makeRng(seedStr) {
  let h = 2166136261;
  for (const ch of seedStr) {
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  }
  let s = h >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, "0");
const sqlStr = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const uuid = () => {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Matches password.util.ts: scrypt$N$r$p$saltHex$hashHex. */
function hashPassword(plain) {
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** IST wall-clock minutes on a given day → UTC instant. */
function istToUtc(dayIso, minutesIst) {
  const [y, m, d] = dayIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutesIst - IST_OFFSET));
}
const isoOf = (date) => date.toISOString().replace("T", " ").slice(0, 23);

/**
 * Runs SQL through psql. The script is piped on stdin rather than passed as
 * -c, because the full seed is a few hundred KB — well past the command-line
 * length limit.
 */
function psql(db, user, sql) {
  const args = ["compose", "exec", "-T", db, "psql", "-U", user, "-d", `retainiq-${user}`, "-v", "ON_ERROR_STOP=1", "-A", "-F", "|", "-f", "-"];
  return execFileSync("docker", args, { encoding: "utf8", input: sql, maxBuffer: 64 * 1024 * 1024 });
}
const identity = (sql) => psql("postgres-identity", "identity", sql);
const analytics = (sql) => psql("postgres-analytics", "analytics", sql);

/** Rows of `col1|col2` output → array of objects. */
function rows(raw) {
  const lines = raw.trim().split("\n").filter((l) => l && !/^\(\d+ rows?\)$/.test(l));
  if (lines.length < 1) return [];
  const head = lines[0].split("|");
  return lines.slice(1).map((l) => Object.fromEntries(l.split("|").map((v, i) => [head[i], v])));
}

// ------------------------------------------------------------- day calendar

const days = [];
{
  const [y, m, d] = TODAY.split("-").map(Number);
  const end = Date.UTC(y, m - 1, d);
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const dt = new Date(end - i * 86400000);
    const iso = dt.toISOString().slice(0, 10);
    const dow = dt.getUTCDay();
    days.push({ iso, dow, weekend: dow === 0 || dow === 6 });
  }
}
const workdays = days.filter((d) => !d.weekend);
/** Monday of that day's week — the key Timesheet is unique on. */
function mondayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const back = (dt.getUTCDay() + 6) % 7;
  return new Date(dt.getTime() - back * 86400000).toISOString().slice(0, 10);
}

// -------------------------------------------------------- analytics profile

/**
 * Shapes a person's day: active hours plus productivity/focus. Archetypes give
 * each person a distinguishable trend so the insight engine has something real
 * to detect — steadily long days (burnout), very short ones (disengaged), a
 * rising line (improving), a falling one (declining).
 */
function dayProfile(person, dayIndex, total, rng) {
  const t = total > 1 ? dayIndex / (total - 1) : 1; // 0 → oldest, 1 → newest
  const jitter = (spread) => (rng() * 2 - 1) * spread;
  let hours = person.hours;
  let productivity;
  let focus;

  switch (person.archetype) {
    case "burnout":
      hours = 9.4 + t * 0.9 + jitter(0.5);
      productivity = 0.72 - t * 0.14 + jitter(0.04);
      focus = 0.62 - t * 0.16 + jitter(0.04);
      break;
    case "disengaged":
      hours = 2.9 - t * 0.7 + jitter(0.4);
      productivity = 0.42 - t * 0.08 + jitter(0.05);
      focus = 0.38 - t * 0.06 + jitter(0.05);
      break;
    case "improving":
      hours = 5.6 + t * 1.5 + jitter(0.4);
      productivity = 0.55 + t * 0.26 + jitter(0.04);
      focus = 0.5 + t * 0.24 + jitter(0.04);
      break;
    case "declining":
      hours = 7.2 - t * 1.9 + jitter(0.4);
      productivity = 0.78 - t * 0.25 + jitter(0.04);
      focus = 0.72 - t * 0.22 + jitter(0.04);
      break;
    default: // healthy
      hours = person.hours + jitter(0.7);
      productivity = 0.74 + jitter(0.06);
      focus = 0.68 + jitter(0.06);
  }

  hours = Math.min(11.5, Math.max(1.2, hours));
  const clamp01 = (v) => Math.min(0.97, Math.max(0.15, v));
  return {
    activeSeconds: Math.round(hours * 3600),
    productivity: clamp01(productivity),
    focus: clamp01(focus),
  };
}

// ------------------------------------------------------------------ leave plan

/**
 * Leave is planned first, because an approved leave day must NOT also produce
 * an attendance record — that contradiction is exactly what makes seeded data
 * look fake. Indices are into `workdays`.
 */
// `start` is a fraction (0..1) of the way through the workday window, so leave
// spreads realistically across 150 days regardless of how many workdays there are.
// A couple of recent PENDING requests keep the approval queue populated.
const LEAVE_PLAN = {
  "a1000001-0000-4000-8000-000000000001": [
    { at: 0.18, code: "CL", days: 1, status: "APPROVED", reason: "Personal errand" },
    { at: 0.55, code: "SL", days: 2, status: "APPROVED", reason: "Fever" },
    { at: 0.95, code: "PL", days: 3, status: "PENDING", reason: "Family wedding" },
  ],
  "a1000002-0000-4000-8000-000000000002": [
    { at: 0.12, code: "SL", days: 2, status: "APPROVED", reason: "Viral fever, advised rest" },
    { at: 0.4, code: "CL", days: 1, status: "APPROVED", reason: "Bank work" },
    { at: 0.7, code: "SL", days: 1, status: "APPROVED", reason: "Dental appointment" },
    { at: 0.9, code: "CL", days: 1, status: "REJECTED", reason: "Long weekend request declined" },
  ],
  "a1000003-0000-4000-8000-000000000003": [
    { at: 0.3, code: "CL", days: 1, status: "APPROVED", reason: "Personal work" },
    { at: 0.65, code: "PL", days: 4, status: "APPROVED", reason: "Annual vacation" },
  ],
  "a1000004-0000-4000-8000-000000000004": [
    { at: 0.25, code: "SL", days: 1, status: "APPROVED", reason: "Migraine" },
    { at: 0.5, code: "CL", days: 1, status: "REJECTED", reason: "Wanted a long weekend" },
    { at: 0.85, code: "CL", days: 1, status: "APPROVED", reason: "Family function" },
  ],
  "a1000005-0000-4000-8000-000000000005": [
    { at: 0.2, code: "PL", days: 1, status: "APPROVED", reason: "Family function" },
    { at: 0.45, code: "SL", days: 3, status: "APPROVED", reason: "Recovering from flu" },
    { at: 0.92, code: "PL", days: 2, status: "PENDING", reason: "Short trip, planned in advance" },
  ],
  "a1000006-0000-4000-8000-000000000006": [
    { at: 0.35, code: "CL", days: 1, status: "APPROVED", reason: "House shifting" },
    { at: 0.75, code: "PL", days: 3, status: "APPROVED", reason: "Festival break" },
  ],
  "e8846e77-d913-45ed-884c-96cff0222530": [
    { at: 0.5, code: "SL", days: 1, status: "APPROVED", reason: "Not well" },
  ],
  "3f00d11a-2562-4e25-99b5-cd21c18c288d": [
    { at: 0.28, code: "SL", days: 1, status: "APPROVED", reason: "Migraine" },
    { at: 0.6, code: "CL", days: 2, status: "APPROVED", reason: "Out of town" },
  ],
};

// ------------------------------------------------------------------- tasks

const TASK_TITLES = {
  retainiq: ["Harden auth guards on attendance routes", "Add SSE reconnect backoff", "Tune Postgres indexes for day reports", "Fix timezone drift in monthly export", "Ship desktop agent auto-update"],
  revamp: ["Rebuild org settings screen", "Migrate legacy leave balances", "Design tokens pass on tables", "Accessibility audit of forms", "Split route bundles"],
  ops: ["Automate onboarding checklist", "Quarterly access review", "Vendor invoice reconciliation", "Refresh incident runbooks", "Headcount capacity forecast"],
};

// ================================================================== build

const stmts = [];
const summary = [];
const credentials = [];

/** Facts already in analytics — these win over anything generated. */
const existingFacts = new Map();
for (const r of rows(analytics(`SELECT "employeeId", day::text AS day, "activeSeconds", "productivityScore", "focusScore" FROM "EmployeeDayFact" WHERE "orgId"='${ORG}';`))) {
  existingFacts.set(`${r.employeeId}|${r.day}`, r);
}

const existingLogins = new Set(
  rows(identity(`SELECT u.email FROM "User" u JOIN "OrganizationMembership" m ON m."userId"=u.id WHERE m."orgId"='${ORG}';`)).map((r) => r.email),
);

const factRows = [];

for (const person of PEOPLE) {
  const rng = makeRng(person.emp);

  // ---- 1. login account (only for people who have none) ----
  if (person.needsLogin && !existingLogins.has(person.email)) {
    const userId = uuid();
    const hash = hashPassword(DEMO_PASSWORD);
    stmts.push(
      `INSERT INTO "User" (id,email,"passwordHash",status,"mustChangePassword","createdAt","updatedAt") VALUES ('${userId}',${sqlStr(person.email)},${sqlStr(hash)},'ACTIVE',false,NOW(),NOW()) ON CONFLICT (email) DO NOTHING;`,
      `INSERT INTO "OrganizationMembership" (id,"orgId","userId","employeeId","roleId",status,"createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${userId}','${person.emp}','${ROLES[person.role]}','ACTIVE',NOW(),NOW() WHERE EXISTS (SELECT 1 FROM "User" WHERE id='${userId}') ON CONFLICT ("orgId","userId") DO NOTHING;`,
      `INSERT INTO "RoleAssignment" (id,"orgId","userId","employeeId","roleId","scopeType","scopeId",status,"createdAt","createdBy") SELECT '${uuid()}','${ORG}','${userId}','${person.emp}','${ROLES[person.role]}','ORG',NULL,'ACTIVE',NOW(),'${OWNER_USER}' WHERE EXISTS (SELECT 1 FROM "User" WHERE id='${userId}') ON CONFLICT DO NOTHING;`,
    );
    credentials.push({ name: person.name, email: person.email, password: DEMO_PASSWORD, role: person.role });
  }

  // Everyone on the clock gets the General shift, which is what late/overtime
  // is measured against.
  if (!person.ownerExcluded) {
    stmts.push(`UPDATE "Employee" SET "shiftId"='${SHIFT_GENERAL}' WHERE id='${person.emp}' AND "shiftId" IS NULL;`);
  }

  // ---- 2. leave (planned before attendance so the two agree) ----
  const leaveDays = new Set();
  for (const plan of LEAVE_PLAN[person.emp] ?? []) {
    const startIdx = Math.min(workdays.length - plan.days, Math.max(0, Math.round(plan.at * (workdays.length - 1))));
    const slice = workdays.slice(startIdx, startIdx + plan.days);
    if (slice.length === 0) continue;
    const decided = plan.status === "PENDING" ? null : `${slice[0].iso} 04:30:00`;
    const decider = plan.status === "PENDING" ? null : OWNER_USER;
    stmts.push(
      `INSERT INTO "LeaveRequest" (id,"orgId","employeeId","leaveTypeId","startDate","endDate",days,reason,status,"decidedBy","decidedAt","createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${person.emp}','${LEAVE_TYPE[plan.code]}','${slice[0].iso}','${slice[slice.length - 1].iso}',${slice.length},${sqlStr(plan.reason)},'${plan.status}',${sqlStr(decider)}${decider ? "::uuid" : ""},${sqlStr(decided)}${decided ? "::timestamp" : ""},NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "LeaveRequest" WHERE "employeeId"='${person.emp}' AND "startDate"='${slice[0].iso}' AND "leaveTypeId"='${LEAVE_TYPE[plan.code]}');`,
    );
    // Only an APPROVED leave actually keeps someone away from work.
    if (plan.status === "APPROVED") for (const d of slice) leaveDays.add(d.iso);
  }

  // ---- 3. per-day analytics facts + attendance ----
  const weekMinutes = new Map();
  let attCount = 0;
  let leaveCount = leaveDays.size;

  workdays.forEach((day, idx) => {
    const key = `${person.emp}|${day.iso}`;
    const existing = existingFacts.get(key);
    const profile = dayProfile(person, idx, workdays.length, rng);

    // On approved leave: no attendance, and no activity fact either.
    if (leaveDays.has(day.iso)) {
      if (!person.ownerExcluded) {
        stmts.push(
          `INSERT INTO "AttendanceRecord" (id,"orgId","employeeId",day,status,state,"workMinutes","createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${person.emp}','${day.iso}','ON_LEAVE','ON_LEAVE',0,NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "AttendanceRecord" WHERE "orgId"='${ORG}' AND "employeeId"='${person.emp}' AND day='${day.iso}');`,
        );
      }
      return;
    }

    // The fact drives everything; generate one only where analytics has none.
    const activeSeconds = existing ? Number(existing.activeSeconds) : profile.activeSeconds;
    if (!existing) {
      // productivityScore/focusScore are stored on a 0..100 scale (same as the
      // analytics scoring worker). profile.productivity/focus are 0..1 fractions,
      // so scale them up — otherwise the UI renders e.g. 0.62 as "1%".
      factRows.push(
        `('${uuid()}','${ORG}','${person.emp}','${day.iso}',${activeSeconds},${Math.round(activeSeconds * (0.12 + rng() * 0.1))},${Math.round(activeSeconds * profile.productivity)},${300 + Math.round(rng() * 900)},${(profile.productivity * 100).toFixed(2)},${(profile.focus * 100).toFixed(2)},NOW(),NOW())`,
      );
    }

    if (person.ownerExcluded) return; // Owner is not staff — no attendance/timesheet.

    // ---- attendance derived from the same activeSeconds ----
    const activeMinutes = Math.round(activeSeconds / 60);
    const startMin = POLICY.shiftStartMinute + Math.round((rng() * 2 - 1) * 22); // ~09:30 ±22m
    const unpaidBreak = 30;
    const paidBreak = Math.min(POLICY.paidBreakMinutesPerDay, 15);
    const breakMinutes = unpaidBreak + paidBreak;
    const workMinutes = activeMinutes;
    const grossMinutes = workMinutes + unpaidBreak; // net + unpaid = wall clock

    const checkIn = istToUtc(day.iso, startMin);
    const checkOut = new Date(checkIn.getTime() + grossMinutes * 60000);
    const lateMinutes = Math.max(0, startMin - (POLICY.shiftStartMinute + POLICY.graceMinutes));
    const endMin = startMin + grossMinutes;
    const earlyExit = Math.max(0, POLICY.shiftEndMinute - endMin);
    const overtime = Math.max(0, workMinutes - POLICY.shiftMinutes);
    // Overtime is measured but not payable until a manager signs it off; the
    // most recent days are left unapproved so the approval queue has real work
    // waiting in it, and managers sometimes grant less than was measured.
    const approvedOt = overtime > 0 && idx < workdays.length - 3 ? (rng() < 0.25 ? Math.round(overtime * 0.6) : overtime) : 0;
    // Someone who checked in is never ABSENT, even on a short day — the record
    // carries their real hours and the shortfall shows up in the reports.
    const status = lateMinutes > 0 ? "LATE" : "PRESENT";
    const attId = uuid();
    const sessId = uuid();

    stmts.push(
      `INSERT INTO "AttendanceRecord" (id,"orgId","employeeId",day,"checkInAt","checkOutAt",status,state,"workMinutes","breakMinutes","unpaidBreakMinutes","overtimeMinutes","approvedOvertimeMinutes","overtimeApprovedBy","overtimeApprovedAt","lateMinutes","earlyExitMinutes",source,"checkOutSource","workLocation","createdAt","updatedAt") SELECT '${attId}','${ORG}','${person.emp}','${day.iso}','${isoOf(checkIn)}','${isoOf(checkOut)}','${status}','COMPLETED',${workMinutes},${breakMinutes},${unpaidBreak},${overtime},${approvedOt},${approvedOt > 0 ? `'${OWNER_USER}'` : "NULL"},${approvedOt > 0 ? `'${isoOf(checkOut)}'` : "NULL"},${lateMinutes},${earlyExit},'agent','agent','OFFICE',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "AttendanceRecord" WHERE "orgId"='${ORG}' AND "employeeId"='${person.emp}' AND day='${day.iso}');`,
      `INSERT INTO "AttendanceSession" (id,"orgId","employeeId","attendanceId",sequence,"startedAt","endedAt",minutes,"startSource","endSource","workLocation","autoClosed","createdAt") SELECT '${sessId}','${ORG}','${person.emp}','${attId}',1,'${isoOf(checkIn)}','${isoOf(checkOut)}',${grossMinutes},'agent','agent','OFFICE',false,NOW() WHERE EXISTS (SELECT 1 FROM "AttendanceRecord" WHERE id='${attId}');`,
      // Lunch (unpaid) and a short tea break (paid) inside the session.
      `INSERT INTO "AttendanceBreak" (id,"orgId","employeeId","attendanceId","sessionId","startedAt","endedAt",minutes,kind,paid,source,"createdAt") SELECT '${uuid()}','${ORG}','${person.emp}','${attId}','${sessId}','${isoOf(new Date(checkIn.getTime() + Math.round(grossMinutes * 0.45) * 60000))}','${isoOf(new Date(checkIn.getTime() + (Math.round(grossMinutes * 0.45) + unpaidBreak) * 60000))}',${unpaidBreak},'LUNCH',false,'agent',NOW() WHERE EXISTS (SELECT 1 FROM "AttendanceSession" WHERE id='${sessId}');`,
      `INSERT INTO "AttendanceBreak" (id,"orgId","employeeId","attendanceId","sessionId","startedAt","endedAt",minutes,kind,paid,source,"createdAt") SELECT '${uuid()}','${ORG}','${person.emp}','${attId}','${sessId}','${isoOf(new Date(checkIn.getTime() + Math.round(grossMinutes * 0.75) * 60000))}','${isoOf(new Date(checkIn.getTime() + (Math.round(grossMinutes * 0.75) + paidBreak) * 60000))}',${paidBreak},'TEA',true,'agent',NOW() WHERE EXISTS (SELECT 1 FROM "AttendanceSession" WHERE id='${sessId}');`,
    );
    attCount++;

    // ---- time entry: the same worked minutes, booked to the project ----
    stmts.push(
      `INSERT INTO "TimeEntry" (id,"orgId","employeeId",date,"projectId",minutes,billable,description,source,"createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${person.emp}','${day.iso}','${PROJECT[person.project]}',${workMinutes},true,'Project work','AUTO',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "TimeEntry" WHERE "orgId"='${ORG}' AND "employeeId"='${person.emp}' AND date='${day.iso}');`,
    );

    const wk = mondayOf(day.iso);
    weekMinutes.set(wk, (weekMinutes.get(wk) ?? 0) + workMinutes);
  });

  // ---- 4. timesheets: one per week, totals matching the entries above ----
  if (!person.ownerExcluded) {
    const weeks = [...weekMinutes.keys()].sort();
    weeks.forEach((wk, i) => {
      const isCurrent = i === weeks.length - 1;
      const status = isCurrent ? "DRAFT" : i === weeks.length - 2 ? "SUBMITTED" : "APPROVED";
      const submitted = isCurrent ? null : `${wk} 12:00:00`;
      const decided = status === "APPROVED" ? `${wk} 13:00:00` : null;
      stmts.push(
        `INSERT INTO "Timesheet" (id,"orgId","employeeId","weekStart",status,"totalMinutes","submittedAt","decidedBy","decidedAt","createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${person.emp}','${wk}','${status}',${weekMinutes.get(wk)},${sqlStr(submitted)}${submitted ? "::timestamp" : ""},${decided ? `'${OWNER_USER}'::uuid` : "NULL"},${sqlStr(decided)}${decided ? "::timestamp" : ""},NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "Timesheet" WHERE "orgId"='${ORG}' AND "employeeId"='${person.emp}' AND "weekStart"='${wk}');`,
      );
    });

    // ---- 5. tasks on the person's project ----
    TASK_TITLES[person.project].forEach((title, i) => {
      const status = i < 2 ? "DONE" : i === 2 ? "IN_PROGRESS" : i === 3 ? "IN_REVIEW" : "TODO";
      const priority = ["HIGH", "MEDIUM", "URGENT", "MEDIUM", "LOW"][i];
      const due = workdays[Math.min(workdays.length - 1, 3 + i * 2)].iso;
      stmts.push(
        `INSERT INTO "Task" (id,"orgId","projectId",title,description,status,priority,"assigneeEmployeeId","dueDate","createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${PROJECT[person.project]}',${sqlStr(title)},${sqlStr(`Owned by ${person.name}.`)},'${status}','${priority}','${person.emp}','${due}',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "Task" WHERE "orgId"='${ORG}' AND "assigneeEmployeeId"='${person.emp}' AND title=${sqlStr(title)});`,
      );
    });
  }

  summary.push({ name: person.name, attendance: attCount, leave: leaveCount, weeks: weekMinutes.size });
}

// =================================================================================
//  EXTRA DOMAINS (150-day full seed) — everything the 15-day seed didn't cover.
//  Kept separate so the core (above) stays identical to the proven generator.
// =================================================================================

const analyticsExtra = []; // AppUsageDaily / WebsiteUsageDaily / WorkSession rows

// ---- A) Monitoring detail: per person-day app + website usage + a work session.
//        Names match the productivity classifier so the dashboards categorise them.
const APPS = [
  ["Visual Studio Code", "PRODUCTIVE"], ["IntelliJ IDEA", "PRODUCTIVE"], ["Terminal", "PRODUCTIVE"],
  ["Slack", "NEUTRAL"], ["Google Chrome", "NEUTRAL"], ["Figma", "PRODUCTIVE"],
  ["Zoom", "NEUTRAL"], ["Notion", "PRODUCTIVE"], ["YouTube", "DISTRACTING"], ["Spotify", "NEUTRAL"],
];
const SITES = [
  ["github.com", "PRODUCTIVE"], ["stackoverflow.com", "PRODUCTIVE"], ["docs.google.com", "PRODUCTIVE"],
  ["mail.google.com", "NEUTRAL"], ["youtube.com", "DISTRACTING"], ["linkedin.com", "NEUTRAL"],
  ["chat.openai.com", "PRODUCTIVE"], ["twitter.com", "DISTRACTING"], ["figma.com", "PRODUCTIVE"],
];
for (const person of PEOPLE) {
  const rng = makeRng(`mon-${person.emp}`);
  const leaveSet = new Set(); // recompute approved-leave days for this person
  for (const plan of LEAVE_PLAN[person.emp] ?? []) {
    if (plan.status !== "APPROVED") continue;
    const startIdx = Math.min(workdays.length - plan.days, Math.max(0, Math.round(plan.at * (workdays.length - 1))));
    for (const d of workdays.slice(startIdx, startIdx + plan.days)) leaveSet.add(d.iso);
  }
  workdays.forEach((day, idx) => {
    if (leaveSet.has(day.iso)) return;
    const profile = dayProfile(person, idx, workdays.length, rng);
    const activeSec = profile.activeSeconds;
    // Split active time across a few apps + sites (productive-weighted).
    const appPick = [0, 1, 2, 3, 4, 5].sort(() => rng() - 0.5).slice(0, 4);
    let remaining = activeSec;
    appPick.forEach((ai, k) => {
      const share = k === appPick.length - 1 ? remaining : Math.round(activeSec * (0.15 + rng() * 0.25));
      remaining = Math.max(0, remaining - share);
      const [appName, cat] = APPS[ai];
      analyticsExtra.push({ t: "app", sql: `('${uuid()}','${ORG}','${person.emp}','${day.iso}',${sqlStr(appName)},'${cat}',${Math.max(60, share)},NOW(),NOW())` });
    });
    const sitePick = [0, 1, 2, 3, 4, 5, 6].sort(() => rng() - 0.5).slice(0, 3);
    sitePick.forEach((si) => {
      const [domain, cat] = SITES[si];
      analyticsExtra.push({ t: "web", sql: `('${uuid()}','${ORG}','${person.emp}','${day.iso}',${sqlStr(domain)},'${cat}',${Math.round(activeSec * (0.08 + rng() * 0.18))},${1 + Math.round(rng() * 12)},NOW(),NOW())` });
    });
    // One work session for the day.
    const startMin = POLICY.shiftStartMinute + Math.round((rng() * 2 - 1) * 20);
    const started = istToUtc(day.iso, startMin);
    const ended = new Date(started.getTime() + (activeSec + 1800) * 1000);
    analyticsExtra.push({ t: "sess", sql: `('${uuid()}','${ORG}','${person.emp}','seed-${person.emp.slice(0, 8)}-${day.iso}','${day.iso}','${isoOf(started)}','${isoOf(ended)}',${activeSec},${Math.round(activeSec * 0.15)},1800,NOW(),NOW())` });
  });
}

// ---- B) Holidays across the window (company + a couple regional).
const HOLIDAYS = [
  { name: "Republic Day", at: 0.05, type: "COMPANY" },
  { name: "Holi", at: 0.22, type: "COMPANY" },
  { name: "Good Friday", at: 0.35, type: "REGIONAL" },
  { name: "Labour Day", at: 0.48, type: "COMPANY" },
  { name: "Eid", at: 0.6, type: "REGIONAL" },
  { name: "Independence Day", at: 0.98, type: "COMPANY" },
];
for (const h of HOLIDAYS) {
  const d = days[Math.min(days.length - 1, Math.round(h.at * (days.length - 1)))].iso;
  stmts.push(`INSERT INTO "Holiday" (id,"orgId",name,date,type,"createdAt","updatedAt") SELECT '${uuid()}','${ORG}',${sqlStr(h.name)},'${d}','${h.type}',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "Holiday" WHERE "orgId"='${ORG}' AND date='${d}' AND name=${sqlStr(h.name)});`);
}

// ---- C) Clients + a bill rate each (invoices reference these).
const CLIENTS = [
  { id: "c1000000-0000-4000-8000-000000000001", name: "Northwind Retail", code: "NWR", rate: 6500 },
  { id: "c1000000-0000-4000-8000-000000000002", name: "Acme Logistics", code: "ACM", rate: 5200 },
];
for (const c of CLIENTS) {
  stmts.push(
    `INSERT INTO "Client" (id,"orgId",name,code,status,"createdAt","updatedAt") SELECT '${c.id}','${ORG}',${sqlStr(c.name)},${sqlStr(c.code)},'ACTIVE',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "Client" WHERE "orgId"='${ORG}' AND name=${sqlStr(c.name)});`,
    `INSERT INTO "BillRate" (id,"orgId","clientId","billRateCents","effectiveFrom","createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${c.id}',${c.rate},'${days[0].iso}',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "BillRate" WHERE "orgId"='${ORG}' AND "clientId"='${c.id}' AND "projectId" IS NULL);`,
  );
}
// Link the retainiq + revamp projects to clients so billable hours have a client.
stmts.push(
  `UPDATE "Project" SET "clientId"='${CLIENTS[0].id}' WHERE id='${PROJECT.retainiq}' AND "clientId" IS NULL;`,
  `UPDATE "Project" SET "clientId"='${CLIENTS[1].id}' WHERE id='${PROJECT.revamp}' AND "clientId" IS NULL;`,
);

// ---- D) Employee cost/bill rates (payroll foundation).
const RATE = {
  "a1000001-0000-4000-8000-000000000001": [2200, 5000],
  "a1000002-0000-4000-8000-000000000002": [1800, 4200],
  "a1000003-0000-4000-8000-000000000003": [2000, 4800],
  "a1000004-0000-4000-8000-000000000004": [1700, 4000],
  "a1000005-0000-4000-8000-000000000005": [1900, 4500],
  "a1000006-0000-4000-8000-000000000006": [1750, 4100],
  "e8846e77-d913-45ed-884c-96cff0222530": [2100, 4900],
  "3f00d11a-2562-4e25-99b5-cd21c18c288d": [2050, 4700],
  "1e1ededa-cf78-45c8-a356-fb975fe57aa0": [3000, 6500],
};
for (const [emp, [cost, bill]] of Object.entries(RATE)) {
  stmts.push(`INSERT INTO "EmployeeRate" (id,"orgId","employeeId","costRateCents","billRateCents","effectiveFrom","createdBy","createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${emp}',${cost},${bill},'${days[0].iso}','${OWNER_USER}',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "EmployeeRate" WHERE "orgId"='${ORG}' AND "employeeId"='${emp}' AND "effectiveTo" IS NULL);`);
}
// Payroll settings singleton (INR monthly).
stmts.push(`INSERT INTO "PayrollSetting" (id,"orgId",currency,"overtimeAfterMins","overtimeMultiplier","cycleFrequency","invoicePrefix","requireApproval","createdAt","updatedAt") SELECT '${uuid()}','${ORG}','INR',2400,150,'MONTHLY','INV',true,NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "PayrollSetting" WHERE "orgId"='${ORG}');`);

// ---- E) Monthly payroll cycles + per-employee lines across the window.
//        Older cycles PAID, then LOCKED, the current month DRAFT.
const STAFF = PEOPLE.filter((p) => !p.ownerExcluded);
const monthsBack = [];
{
  const [ty, tm] = TODAY.split("-").map(Number);
  for (let i = 4; i >= 0; i--) {
    const m0 = new Date(Date.UTC(ty, tm - 1 - i, 1));
    const start = m0.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    monthsBack.push({ start, end, idx: 4 - i });
  }
}
monthsBack.forEach((mo, i) => {
  const status = i < monthsBack.length - 2 ? "PAID" : i === monthsBack.length - 2 ? "LOCKED" : "DRAFT";
  const cycleId = uuid();
  const paidAt = status === "PAID" ? `'${mo.end} 10:00:00'::timestamp` : "NULL";
  const lockedAt = status !== "DRAFT" ? `'${mo.end} 09:00:00'::timestamp` : "NULL";
  stmts.push(`INSERT INTO "PayrollCycle" (id,"orgId","periodStart","periodEnd",status,currency,"runAt","lockedAt","lockedBy","paidAt",note,"createdAt","updatedAt") SELECT '${cycleId}','${ORG}','${mo.start}','${mo.end}','${status}','INR',${lockedAt},${lockedAt},${status !== "DRAFT" ? `'${OWNER_USER}'::uuid` : "NULL"},${paidAt},NULL,NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "PayrollCycle" WHERE "orgId"='${ORG}' AND "periodStart"='${mo.start}' AND "periodEnd"='${mo.end}');`);
  // One line per staff member; ~22 working days of 8h, some OT + billable share.
  for (const p of STAFF) {
    const [cost] = RATE[p.emp] ?? [2000];
    const bill = (RATE[p.emp] ?? [2000, 4500])[1];
    const rng = makeRng(`pay-${p.emp}-${mo.start}`);
    const regMin = 22 * 8 * 60 - Math.round(rng() * 600);
    const otMin = Math.round(rng() * 400);
    const billMin = Math.round(regMin * (0.5 + rng() * 0.35));
    const regPay = Math.round((regMin / 60) * cost);
    const otPay = Math.round((otMin / 60) * cost * 1.5);
    stmts.push(`INSERT INTO "PayrollLine" (id,"orgId","cycleId","employeeId","costRateCents","regularMinutes","overtimeMinutes","billableMinutes","regularPayCents","overtimePayCents","grossPayCents","createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${cycleId}','${p.emp}',${cost},${regMin},${otMin},${billMin},${regPay},${otPay},${regPay + otPay},NOW(),NOW() WHERE EXISTS (SELECT 1 FROM "PayrollCycle" WHERE id='${cycleId}') AND NOT EXISTS (SELECT 1 FROM "PayrollLine" WHERE "cycleId"='${cycleId}' AND "employeeId"='${p.emp}');`);
    void bill;
  }
});

// ---- F) Client invoices (one per client for a recent past month), PAID/SENT.
monthsBack.slice(-3, -1).forEach((mo, i) => {
  CLIENTS.forEach((c, ci) => {
    const invId = uuid();
    const num = `INV-${String(100 + i * 2 + ci).padStart(4, "0")}`;
    const status = i === 0 ? "PAID" : "SENT";
    const subtotal = 400000 + Math.round(Math.random() * 300000);
    stmts.push(
      `INSERT INTO "ClientInvoice" (id,"orgId","clientId","invoiceNumber","periodStart","periodEnd",status,currency,"subtotalCents","totalCents","issuedAt","paidAt","createdAt","updatedAt") SELECT '${invId}','${ORG}','${c.id}',${sqlStr(num)},'${mo.start}','${mo.end}','${status}','INR',${subtotal},${subtotal},'${mo.end} 11:00:00'::timestamp,${status === "PAID" ? `'${mo.end} 15:00:00'::timestamp` : "NULL"},NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "ClientInvoice" WHERE "orgId"='${ORG}' AND "invoiceNumber"=${sqlStr(num)});`,
      `INSERT INTO "ClientInvoiceLine" (id,"orgId","invoiceId","projectId",description,minutes,"billRateCents","amountCents","createdAt") SELECT '${uuid()}','${ORG}','${invId}','${ci === 0 ? PROJECT.retainiq : PROJECT.revamp}',${sqlStr(`${c.name} — billable engineering hours`)},${Math.round(subtotal / (c.rate / 60))},${c.rate},${subtotal},NOW() WHERE EXISTS (SELECT 1 FROM "ClientInvoice" WHERE id='${invId}');`,
    );
  });
});

// ---- G) Performance: one CLOSED cycle + one ACTIVE, reviews + ratings + achievements.
const CYCLE_CLOSED = uuid();
const CYCLE_ACTIVE = uuid();
stmts.push(
  `INSERT INTO "ReviewCycle" (id,"orgId",name,status,"periodStart","periodEnd","createdAt","updatedAt") SELECT '${CYCLE_CLOSED}','${ORG}','H1 2026 Review','CLOSED','${days[0].iso}','${days[Math.round(days.length * 0.5)].iso}',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "ReviewCycle" WHERE "orgId"='${ORG}' AND name='H1 2026 Review');`,
  `INSERT INTO "ReviewCycle" (id,"orgId",name,status,"periodStart","periodEnd","createdAt","updatedAt") SELECT '${CYCLE_ACTIVE}','${ORG}','H2 2026 Review','ACTIVE','${days[Math.round(days.length * 0.5)].iso}','${days[days.length - 1].iso}',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "ReviewCycle" WHERE "orgId"='${ORG}' AND name='H2 2026 Review');`,
);
const COMPETENCIES = ["Delivery", "Collaboration", "Ownership", "Communication"];
STAFF.forEach((p, i) => {
  const rng = makeRng(`perf-${p.emp}`);
  // Closed cycle: fully submitted + acknowledged with an overall rating.
  const rev1 = uuid();
  const rating = 3 + Math.round(rng() * 2); // 3..5
  stmts.push(`INSERT INTO "PerformanceReview" (id,"orgId","cycleId","employeeId","reviewerEmployeeId",status,"overallRating","selfAssessment","managerComment","submittedAt","acknowledgedAt","createdAt","updatedAt") SELECT '${rev1}','${ORG}','${CYCLE_CLOSED}','${p.emp}','${MANAGER_EMP}','ACKNOWLEDGED',${rating},'Delivered my key goals this half.','Solid half — keep it up.','${days[Math.round(days.length * 0.5)].iso} 12:00:00'::timestamp,'${days[Math.round(days.length * 0.52)].iso} 12:00:00'::timestamp,NOW(),NOW() WHERE (SELECT count(*) FROM "ReviewCycle" WHERE id='${CYCLE_CLOSED}')=1 AND NOT EXISTS (SELECT 1 FROM "PerformanceReview" WHERE "cycleId"='${CYCLE_CLOSED}' AND "employeeId"='${p.emp}');`);
  COMPETENCIES.forEach((c) => {
    stmts.push(`INSERT INTO "ReviewRating" (id,"orgId","reviewId",competency,score) SELECT '${uuid()}','${ORG}','${rev1}',${sqlStr(c)},${3 + Math.round(rng() * 2)} WHERE EXISTS (SELECT 1 FROM "PerformanceReview" WHERE id='${rev1}');`);
  });
  // Active cycle: in-progress self-review, no rating yet.
  stmts.push(`INSERT INTO "PerformanceReview" (id,"orgId","cycleId","employeeId","reviewerEmployeeId",status,"createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${CYCLE_ACTIVE}','${p.emp}','${MANAGER_EMP}','${i % 2 === 0 ? "SELF_REVIEW" : "PENDING"}',NOW(),NOW() WHERE (SELECT count(*) FROM "ReviewCycle" WHERE id='${CYCLE_ACTIVE}')=1 AND NOT EXISTS (SELECT 1 FROM "PerformanceReview" WHERE "cycleId"='${CYCLE_ACTIVE}' AND "employeeId"='${p.emp}');`);
  // A recognition achievement for the strong performers.
  if (rating >= 4) {
    stmts.push(`INSERT INTO "Achievement" (id,"orgId","employeeId",title,description,category,"awardedOn","createdBy","createdAt") SELECT '${uuid()}','${ORG}','${p.emp}','Star Performer — H1','Recognised for consistent delivery.','AWARD','${days[Math.round(days.length * 0.5)].iso}','${OWNER_USER}',NOW() WHERE NOT EXISTS (SELECT 1 FROM "Achievement" WHERE "orgId"='${ORG}' AND "employeeId"='${p.emp}' AND title='Star Performer — H1');`);
  }
});

// ---- H) Recruitment: open requisitions + candidates + applications + interviews + offers.
const REQS = [
  { id: "d1000000-0000-4000-8000-000000000001", title: "Senior Backend Engineer", openings: 2, status: "OPEN" },
  { id: "d1000000-0000-4000-8000-000000000002", title: "Product Designer", openings: 1, status: "OPEN" },
  { id: "d1000000-0000-4000-8000-000000000003", title: "DevOps Engineer", openings: 1, status: "FILLED" },
];
for (const r of REQS) {
  stmts.push(`INSERT INTO "Requisition" (id,"orgId",title,openings,status,location,"employmentType",description,"createdAt","updatedAt") SELECT '${r.id}','${ORG}',${sqlStr(r.title)},${r.openings},'${r.status}','Remote','FULL_TIME','We are hiring a ${r.title.toLowerCase()}.',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "Requisition" WHERE "orgId"='${ORG}' AND title=${sqlStr(r.title)});`);
}
const CANDIDATES = [
  { first: "Nikhil", last: "Verma", stage: "INTERVIEW", req: 0 },
  { first: "Sana", last: "Khan", stage: "OFFER", req: 1 },
  { first: "Arjun", last: "Reddy", stage: "SCREENING", req: 0 },
  { first: "Priya", last: "Menon", stage: "HIRED", req: 2 },
  { first: "Vikram", last: "Bose", stage: "REJECTED", req: 0 },
];
CANDIDATES.forEach((c, i) => {
  const candId = uuid();
  const appId = uuid();
  const req = REQS[c.req];
  stmts.push(
    `INSERT INTO "Candidate" (id,"orgId","firstName","lastName",email,source,"createdAt","updatedAt") SELECT '${candId}','${ORG}',${sqlStr(c.first)},${sqlStr(c.last)},${sqlStr(`${c.first.toLowerCase()}.${c.last.toLowerCase()}@example.com`)},'LinkedIn',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "Candidate" WHERE "orgId"='${ORG}' AND email=${sqlStr(`${c.first.toLowerCase()}.${c.last.toLowerCase()}@example.com`)});`,
    `INSERT INTO "Application" (id,"orgId","candidateId","requisitionId",stage,rating,"updatedAt") SELECT '${appId}','${ORG}','${candId}','${req.id}','${c.stage}',${3 + (i % 3)},NOW() WHERE EXISTS (SELECT 1 FROM "Candidate" WHERE id='${candId}') AND EXISTS (SELECT 1 FROM "Requisition" WHERE id='${req.id}');`,
  );
  if (["INTERVIEW", "OFFER", "HIRED"].includes(c.stage)) {
    stmts.push(`INSERT INTO "Interview" (id,"orgId","applicationId",round,outcome,"scheduledAt",interviewer,mode,rating,"createdAt") SELECT '${uuid()}','${ORG}','${appId}',1,'${c.stage === "INTERVIEW" ? "PENDING" : "PASS"}','${days[Math.round(days.length * 0.9)].iso} 06:00:00'::timestamp,'Test Manager','VIDEO',4,NOW() WHERE EXISTS (SELECT 1 FROM "Application" WHERE id='${appId}');`);
  }
  if (["OFFER", "HIRED"].includes(c.stage)) {
    stmts.push(`INSERT INTO "Offer" (id,"orgId","applicationId",title,status,salary,"joiningDate","sentAt","createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${appId}',${sqlStr(req.title)},'${c.stage === "HIRED" ? "ACCEPTED" : "SENT"}','₹18,00,000','${days[days.length - 1].iso}','${days[Math.round(days.length * 0.92)].iso} 06:00:00'::timestamp,NOW(),NOW() WHERE EXISTS (SELECT 1 FROM "Application" WHERE id='${appId}');`);
  }
});

// ---- I) Onboarding: a template + a journey for the two most-recent joiners.
//        Reuse an existing "Standard Onboarding" template if the org already has
//        one (a fresh org won't), so FKs always resolve to a real template id.
const existingTemplate = rows(identity(`SELECT id FROM "OnboardingTemplate" WHERE "orgId"='${ORG}' AND name='Standard Onboarding' LIMIT 1;`))[0];
const TEMPLATE = existingTemplate ? existingTemplate.id : uuid();
if (!existingTemplate) {
  stmts.push(`INSERT INTO "OnboardingTemplate" (id,"orgId",name,"isDefault","createdAt","updatedAt") VALUES ('${TEMPLATE}','${ORG}','Standard Onboarding',true,NOW(),NOW());`);
}
[["Sign offer letter", "DOCUMENT", "HR", 1], ["Set up laptop & accounts", "ACCESS", "IT", 2], ["Read the handbook", "POLICY", "EMPLOYEE", 3], ["Intro with the team", "TASK", "MANAGER", 4], ["Security training", "TRAINING", "EMPLOYEE", 5]].forEach(([title, cat, assignee, order]) => {
  stmts.push(`INSERT INTO "OnboardingTemplateItem" (id,"orgId","templateId",title,category,assignee,"order",required) SELECT '${uuid()}','${ORG}','${TEMPLATE}',${sqlStr(title)},'${cat}','${assignee}',${order},true WHERE EXISTS (SELECT 1 FROM "OnboardingTemplate" WHERE id='${TEMPLATE}') AND NOT EXISTS (SELECT 1 FROM "OnboardingTemplateItem" WHERE "templateId"='${TEMPLATE}' AND title=${sqlStr(title)});`);
});
[["e8846e77-d913-45ed-884c-96cff0222530", "IN_PROGRESS"], ["3f00d11a-2562-4e25-99b5-cd21c18c288d", "COMPLETED"]].forEach(([emp, status]) => {
  const jid = uuid();
  stmts.push(`INSERT INTO "OnboardingJourney" (id,"orgId","employeeId","templateId",status,"startedAt","completedAt") SELECT '${jid}','${ORG}','${emp}','${TEMPLATE}','${status}','${days[Math.round(days.length * 0.25)].iso} 09:00:00'::timestamp,${status === "COMPLETED" ? `'${days[Math.round(days.length * 0.3)].iso} 10:00:00'::timestamp` : "NULL"} WHERE NOT EXISTS (SELECT 1 FROM "OnboardingJourney" WHERE "employeeId"='${emp}');`);
  ["Sign offer letter", "Set up laptop & accounts", "Read the handbook", "Intro with the team", "Security training"].forEach((title, k) => {
    const done = status === "COMPLETED" || k < 3;
    stmts.push(`INSERT INTO "OnboardingTask" (id,"orgId","journeyId",title,status,"completedAt","completedBy") SELECT '${uuid()}','${ORG}','${jid}',${sqlStr(title)},'${done ? "DONE" : "PENDING"}',${done ? `'${days[Math.round(days.length * 0.3)].iso} 10:00:00'::timestamp` : "NULL"},${done ? `'${OWNER_USER}'::uuid` : "NULL"} WHERE EXISTS (SELECT 1 FROM "OnboardingJourney" WHERE id='${jid}');`);
  });
});

// ---- J) Milestones + org/employee goals (incl. the MVP-4 productivity target).
Object.entries(PROJECT).forEach(([name, pid], i) => {
  [["Phase 1 — Foundation", "COMPLETED", 100], ["Phase 2 — Build", "IN_PROGRESS", 55], ["Phase 3 — Launch", "PENDING", 0]].forEach(([title, status, progress], k) => {
    const due = days[Math.min(days.length - 1, Math.round((0.3 + k * 0.25) * (days.length - 1)))].iso;
    stmts.push(`INSERT INTO "Milestone" (id,"orgId","projectId",title,status,progress,"dueDate","createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${pid}',${sqlStr(title)},'${status}',${progress},'${due}',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "Milestone" WHERE "orgId"='${ORG}' AND "projectId"='${pid}' AND title=${sqlStr(title)});`);
  });
});
stmts.push(
  // Org-level productivity target (MVP-4) — reused by the insights dashboard.
  `INSERT INTO "Goal" (id,"orgId",title,metric,target,current,status,"createdAt","updatedAt") SELECT '${uuid()}','${ORG}','Productivity target','productivity',85,0,'ACTIVE',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "Goal" WHERE "orgId"='${ORG}' AND metric='productivity' AND "projectId" IS NULL AND "ownerEmployeeId" IS NULL);`,
  `INSERT INTO "Goal" (id,"orgId",title,description,status,current,target,"dueDate","createdAt","updatedAt") SELECT '${uuid()}','${ORG}','Ship v2 of the platform','Complete the revamp and launch to all tenants','ACTIVE',60,100,'${days[days.length - 1].iso}',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "Goal" WHERE "orgId"='${ORG}' AND title='Ship v2 of the platform');`,
);

// ---- K) A couple of pending attendance corrections (approval queue).
[["a1000005-0000-4000-8000-000000000005", "MISSED_CHECK_OUT", "Forgot to check out, left at 6:30pm"], ["a1000002-0000-4000-8000-000000000002", "WRONG_TIME", "Agent recorded a late start; I was in at 9:35"]].forEach(([emp, type, reason]) => {
  const d = workdays[Math.max(0, workdays.length - 2)].iso;
  stmts.push(`INSERT INTO "AttendanceCorrection" (id,"orgId","employeeId",day,type,reason,status,"createdAt","updatedAt") SELECT '${uuid()}','${ORG}','${emp}','${d}','${type}',${sqlStr(reason)},'PENDING',NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "AttendanceCorrection" WHERE "orgId"='${ORG}' AND "employeeId"='${emp}' AND day='${d}' AND type='${type}');`);
});

// ------------------------------------------------------------------- apply

if (factRows.length > 0) {
  const factSql = `INSERT INTO "EmployeeDayFact" (id,"orgId","employeeId",day,"activeSeconds","idleSeconds","productiveSeconds","eventCount","productivityScore","focusScore","createdAt","updatedAt") VALUES\n${factRows.join(",\n")}\nON CONFLICT ("orgId","employeeId",day) DO NOTHING;`;
  if (DRY) {
    console.log(`-- analytics: ${factRows.length} EmployeeDayFact rows`);
  } else {
    analytics(factSql);
    console.log(`analytics: inserted up to ${factRows.length} EmployeeDayFact rows`);
  }
}

// App/website usage + work sessions (monitoring detail) — batched per table.
const appRows = analyticsExtra.filter((r) => r.t === "app").map((r) => r.sql);
const webRows = analyticsExtra.filter((r) => r.t === "web").map((r) => r.sql);
const sessRows = analyticsExtra.filter((r) => r.t === "sess").map((r) => r.sql);
if (!DRY) {
  const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  for (const c of chunk(appRows, 500)) analytics(`INSERT INTO "AppUsageDaily" (id,"orgId","employeeId",day,"appName",category,seconds,"createdAt","updatedAt") VALUES\n${c.join(",\n")}\nON CONFLICT ("orgId","employeeId",day,"appName") DO NOTHING;`);
  for (const c of chunk(webRows, 500)) analytics(`INSERT INTO "WebsiteUsageDaily" (id,"orgId","employeeId",day,domain,category,seconds,visits,"createdAt","updatedAt") VALUES\n${c.join(",\n")}\nON CONFLICT ("orgId","employeeId",day,domain) DO NOTHING;`);
  for (const c of chunk(sessRows, 500)) analytics(`INSERT INTO "WorkSession" (id,"orgId","employeeId","sessionKey",day,"startedAt","endedAt","activeSeconds","idleSeconds","breakSeconds","createdAt","updatedAt") VALUES\n${c.join(",\n")}\nON CONFLICT ("orgId","employeeId","sessionKey") DO NOTHING;`);
  console.log(`analytics: apps=${appRows.length} sites=${webRows.length} sessions=${sessRows.length}`);
} else {
  console.log(`-- analytics extra: apps=${appRows.length} sites=${webRows.length} sessions=${sessRows.length}`);
}

if (DRY) {
  console.log(`-- identity: ${stmts.length} statements`);
  console.log(stmts.slice(0, 12).join("\n"));
} else {
  // One transaction: either the whole history lands or none of it does.
  identity(`BEGIN;\n${stmts.join("\n")}\nCOMMIT;`);
  console.log(`identity: applied ${stmts.length} statements`);
}

console.table(summary);
if (credentials.length > 0) {
  console.log("\nNew logins created:");
  console.table(credentials);
}
