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

/** Today, in the org's timezone terms; the seed window is the 15 days ending here. */
const TODAY = "2026-07-22";
const WINDOW_DAYS = 15;

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
const LEAVE_PLAN = {
  "a1000002-0000-4000-8000-000000000002": [{ code: "SL", start: 4, days: 2, status: "APPROVED", reason: "Viral fever, advised rest" }],
  "a1000003-0000-4000-8000-000000000003": [{ code: "CL", start: 8, days: 1, status: "APPROVED", reason: "Personal work" }],
  "a1000005-0000-4000-8000-000000000005": [
    { code: "PL", start: 2, days: 1, status: "APPROVED", reason: "Family function" },
    { code: "PL", start: 10, days: 2, status: "PENDING", reason: "Short trip, planned well in advance" },
  ],
  "a1000004-0000-4000-8000-000000000004": [{ code: "CL", start: 6, days: 1, status: "REJECTED", reason: "Wanted a long weekend" }],
  "3f00d11a-2562-4e25-99b5-cd21c18c288d": [{ code: "SL", start: 5, days: 1, status: "APPROVED", reason: "Migraine" }],
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
    const slice = workdays.slice(plan.start, plan.start + plan.days);
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
      factRows.push(
        `('${uuid()}','${ORG}','${person.emp}','${day.iso}',${activeSeconds},${Math.round(activeSeconds * (0.12 + rng() * 0.1))},${Math.round(activeSeconds * profile.productivity)},${300 + Math.round(rng() * 900)},${profile.productivity.toFixed(3)},${profile.focus.toFixed(3)},NOW(),NOW())`,
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
