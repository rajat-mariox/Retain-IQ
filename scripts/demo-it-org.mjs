/**
 * Demo IT organization: seed a complete, realistic tenant to click through, and
 * remove every trace of it again with one command.
 *
 *   npm run demo:seed     → creates "Mariox Software (Demo)" + 11 people + data
 *   npm run demo:remove   → deletes that org and its users from every database
 *
 * SEED goes through the real HTTP APIs (super-admin create org → owner setup →
 * add members → each person logs in and works), so every step exercises the same
 * code paths the apps use: outbox events, billing provisioning, notifications,
 * approvals, the activity pipeline into analytics.
 *
 * REMOVE talks to Postgres directly (docker exec psql as the DB superuser) and
 * deletes, in every service database, every row whose orgId is the demo org,
 * plus the demo users (all on the reserved @mariox.test domain). It never
 * touches any other organization.
 *
 * Needs the stack running (npm run up:local, or npm run up). Zero dependencies.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const API = process.env.RETAINIQ_API ?? "http://localhost:3001/v1";
const INGEST = process.env.RETAINIQ_INGEST_API ?? "http://localhost:3002/v1";
const ORG_NAME = "Mariox Software (Demo)";
const DOMAIN = "mariox.test"; // reserved TLD: can never be a real mailbox
const PASSWORD = "Mariox@Demo2026"; // every demo login uses this
const PLAN = "enterprise"; // unlocks every feature (monitoring, AI, …) for testing
const SEATS = 40;

const env = readDotEnv();
const ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL ?? env.PLATFORM_ADMIN_EMAIL ?? "admin@retainiq.com";
const ADMIN_PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD ?? env.PLATFORM_ADMIN_PASSWORD ?? "SuperAdmin123!";

/** The team. `reportsTo` = key of their reporting manager (approves leave/timesheets). The Owner (Rahul) is created separately. */
const PEOPLE = [
  { key: "ekta", first: "Ekta", last: "Sharma", role: "HR Manager", dept: "HR", scope: "ORG", title: "HR Manager", desig: "HR Manager", pay: 80000 },
  { key: "akash", first: "Akash", last: "Verma", role: "Manager", dept: "Sales", scope: "DEPARTMENT", title: "Sales Head", desig: "Sales Head", pay: 150000 },
  { key: "bhanu", first: "Bhanu", last: "Pratap", role: "Manager", dept: "QA", scope: "DEPARTMENT", title: "QA Head", desig: "QA Head", pay: 120000 },
  { key: "abhishek", first: "Abhishek", last: "Tripathi", role: "Manager", dept: "IT", scope: "DEPARTMENT", title: "Team Lead - IT", desig: "Team Lead - IT", pay: 160000 },
  { key: "rajat", first: "Rajat", last: "Kumar", role: "Employee", dept: "IT", team: "Web Team", title: "Full Stack Developer", desig: "Full Stack Developer", pay: 90000, reportsTo: "abhishek", persona: "focused" },
  { key: "ronak", first: "Ronak", last: "Jain", role: "Employee", dept: "IT", team: "Web Team", title: "Frontend Developer", desig: "Frontend Developer", pay: 75000, reportsTo: "abhishek", persona: "focused" },
  { key: "praveen", first: "Praveen", last: "Yadav", role: "Employee", dept: "IT", team: "Mobile Team", title: "Senior Backend Developer", desig: "Senior Backend Developer", pay: 120000, reportsTo: "abhishek", persona: "overworked" },
  { key: "ujjwal", first: "Ujjwal", last: "Mishra", role: "Employee", dept: "IT", team: "Mobile Team", title: "Mobile App Developer", desig: "Mobile App Developer", pay: 70000, reportsTo: "abhishek", persona: "distracted" },
  { key: "nikhil", first: "Nikhil", last: "Arora", role: "Employee", dept: "Sales", team: "Sales Team", title: "Sales Executive", desig: "Sales Executive", pay: 45000, reportsTo: "akash", persona: "sales" },
  { key: "isha", first: "Isha", last: "Mehta", role: "Employee", dept: "Sales", team: "Sales Team", title: "Sales Executive", desig: "Sales Executive", pay: 45000, reportsTo: "akash", persona: "sales" },
];

/** The company's GitHub repositories, added as projects (IT, managed by Abhishek). */
const REPOS = [
  "rajat-mariox/shop-near", "rajat-mariox/Accounting-software", "rajat-mariox/Advok", "rajat-mariox/scooty-Renatal-admin",
  "TinkuMariox/klick-pic-frontend", "sksainimariox/scooty-rental-admin", "Abhishek-Tripathi-Mariox/scooty-backend", "rajat-mariox/retainIQ",
  "rajat-mariox/kebu", "Abhishek-Tripathi-Mariox/scooty-user-app", "rajat-mariox/accounting-backend", "Abhishek-Tripathi-Mariox/scooty-owner-app",
  "rajat-mariox/MIRA-AI", "TinkuMariox/movezy-admin", "sksainimariox/megha-gold-admin", "sksainimariox/karma-guru-admin",
  "rajat-mariox/SEO-Optimizer", "TinkuMariox/heal-win-frontend", "TinkuMariox/tedora", "rajat-mariox/advok-website-",
  "rajat-mariox/zomato-clone-", "TinkuMariox/OTG-Admin", "rajat-mariox/Retain-IQ", "Abhishek-Tripathi-Mariox/vimalwireandcable",
];

// ---------------------------------------------------------------------------
// SEED
// ---------------------------------------------------------------------------
async function seed() {
  step("Checking the stack");
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`identity-service is not reachable at ${API}. Start the stack first (npm run up:local).`);
  const existing = sql("identity", `SELECT count(*) FROM "User" WHERE email LIKE '%@${DOMAIN}';`).trim();
  if (existing !== "0") throw new Error(`Demo data already exists (${existing} demo users). Run "npm run demo:remove" first.`);

  // 1. Super Admin creates the org --------------------------------------------
  step("Super Admin creates the organization");
  const admin = await withRetry(() => call("POST", "/platform/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }));
  const created = await call("POST", "/platform/admin/organizations", {
    token: admin.accessToken,
    body: {
      orgName: ORG_NAME,
      ownerEmail: `rahul@${DOMAIN}`,
      ownerFirstName: "Rahul",
      ownerLastName: "Gupta",
      planId: PLAN,
      seats: SEATS,
      attendancePolicy: { graceMinutes: 15, workModel: "HYBRID", allowMultipleSessions: true, allowReEntry: true, maxSessionsPerDay: 3, maxBreaksPerDay: 2, paidBreakMinutesPerDay: 30 },
    },
  });
  const orgId = created.org.id;
  ok(`${ORG_NAME} (${orgId}) on the ${created.plan.name} plan, ${SEATS} seats`);

  step("Waiting for billing-service to provision the subscription");
  await waitFor(() => sql("billing", `SELECT count(*) FROM "Subscription" WHERE "orgId"::text = '${orgId}';`).trim() !== "0", 60, "subscription");
  ok("subscription ready");

  // 2. Owner first login + setup ---------------------------------------------
  step("Owner (Rahul) logs in and changes the temporary password");
  const owner = await loginAndSetPassword(`rahul@${DOMAIN}`, created.owner.tempPassword);
  const O = owner.accessToken;

  step("Owner sets up the company structure");
  const dept = {};
  for (const [name, description] of [["IT", "Software development"], ["QA", "Quality assurance"], ["HR", "People operations"], ["Sales", "Business development"]]) {
    dept[name] = (await call("POST", "/departments", { token: O, body: { name, description } })).id;
  }
  const team = {};
  for (const [name, d, description] of [["Web Team", "IT", "Web apps and admin panels"], ["Mobile Team", "IT", "Mobile apps and backends"], ["QA Team", "QA", "Manual and automation testing"], ["Sales Team", "Sales", "Client acquisition"]]) {
    team[name] = (await call("POST", "/teams", { token: O, body: { name, departmentId: dept[d], description } })).id;
  }
  const desig = {};
  for (const p of PEOPLE) {
    if (desig[p.desig]) continue;
    desig[p.desig] = (await call("POST", "/designations", { token: O, body: { title: p.desig, departmentId: dept[p.dept] } })).id;
  }
  const shift = await call("POST", "/shifts", {
    token: O,
    body: { name: "General Shift 10-7", startMinute: 600, endMinute: 1140, graceMinutes: 15, workingDays: [1, 2, 3, 4, 5], breaks: [{ name: "Lunch", startMinute: 810, endMinute: 840 }], isDefault: true },
  });
  const leaveType = {};
  for (const [name, code, annualQuota, paid] of [["Casual Leave", "CL", 12, true], ["Sick Leave", "SL", 8, true], ["Earned Leave", "EL", 15, true], ["Leave Without Pay", "LWP", 0, false]]) {
    leaveType[code] = (await call("POST", "/leave/types", { token: O, body: { name, code, annualQuota, paid } })).id;
  }
  const HOLIDAYS = [["Diwali", "2026-11-08"], ["Guru Nanak Jayanti", "2026-11-24"], ["Christmas", "2026-12-25"], ["New Year's Day", "2027-01-01"], ["Republic Day", "2027-01-26"]];
  for (const [name, date] of HOLIDAYS) await call("POST", "/holidays", { token: O, body: { name, date, type: "COMPANY" } });
  const client = {};
  for (const [name, code, contactEmail] of [["Scooty Rentals", "SCR", `it@scooty.${DOMAIN}`], ["Advok Legal", "ADV", `tech@advok.${DOMAIN}`]]) {
    client[name] = (await call("POST", "/clients", { token: O, body: { name, code, contactEmail } })).id;
  }
  ok("4 departments, 4 teams, designations, 1 shift, 4 leave types, 5 holidays, 2 clients");

  // 3. Add the team ------------------------------------------------------------
  step(`Adding ${PEOPLE.length} team members`);
  const roles = await call("GET", "/rbac/roles", { token: O });
  const roleId = (name) => (Array.isArray(roles) ? roles : roles.items).find((r) => r.name === name)?.id;
  const emp = {}; // key → { id, email, token }
  for (const p of PEOPLE) {
    const email = `${p.key}@${DOMAIN}`;
    const res = await call("POST", "/members", {
      token: O,
      body: {
        firstName: p.first, lastName: p.last, email,
        roleId: roleId(p.role), departmentId: dept[p.dept],
        scopeType: p.scope ?? "SELF", title: p.title,
        baseAmount: p.pay, currencyCode: "INR", payFrequency: "MONTHLY", paymentBasis: "FIXED",
      },
    });
    emp[p.key] = { id: res.employee.id, email, temp: res.tempPassword };
    ok(`${p.first} ${p.last} · ${p.role} · ${p.dept}`);
  }

  step("Owner assigns managers, teams, designations and the shift");
  for (const p of PEOPLE) {
    await call("PATCH", `/employees/${emp[p.key].id}`, {
      token: O,
      body: {
        managerId: p.reportsTo ? emp[p.reportsTo].id : null,
        teamId: p.team ? team[p.team] : null,
        designationId: desig[p.desig],
        shiftId: shift.id,
      },
    });
  }
  await call("PATCH", `/departments/${dept.IT}`, { token: O, body: { leadEmployeeId: emp.abhishek.id } });
  await call("PATCH", `/departments/${dept.QA}`, { token: O, body: { leadEmployeeId: emp.bhanu.id } });
  await call("PATCH", `/departments/${dept.HR}`, { token: O, body: { leadEmployeeId: emp.ekta.id } });
  await call("PATCH", `/departments/${dept.Sales}`, { token: O, body: { leadEmployeeId: emp.akash.id } });
  await call("PATCH", `/teams/${team["Web Team"]}`, { token: O, body: { leadEmployeeId: emp.abhishek.id } });
  await call("PATCH", `/teams/${team["Mobile Team"]}`, { token: O, body: { leadEmployeeId: emp.abhishek.id } });
  await call("PATCH", `/teams/${team["QA Team"]}`, { token: O, body: { leadEmployeeId: emp.bhanu.id } });
  await call("PATCH", `/teams/${team["Sales Team"]}`, { token: O, body: { leadEmployeeId: emp.akash.id } });
  ok("reporting lines, teams, leads set");

  step("Every member logs in once and sets the demo password");
  for (const p of PEOPLE) {
    const s = await loginAndSetPassword(emp[p.key].email, emp[p.key].temp);
    emp[p.key].token = s.accessToken;
  }
  ok(`all ${PEOPLE.length} can log in`);

  // 4. Projects + tasks ------------------------------------------------------------
  step("Projects and tasks");
  const iso = (d) => d.toISOString();
  const inDays = (n) => new Date(Date.now() + n * 864e5);
  const proj = {};
  for (const [i, full] of REPOS.entries()) {
    const name = full.split("/")[1].replace(/-+$/, "");
    const lower = name.toLowerCase();
    const mobile = lower.startsWith("scooty") && /(-app|-backend)$/.test(lower);
    const c = lower.startsWith("scooty") ? "Scooty Rentals" : lower.startsWith("advok") ? "Advok Legal" : null;
    proj[name] = (await call("POST", "/projects", {
      token: O,
      body: { name, description: `GitHub: ${full}`, status: "ACTIVE", ownerEmployeeId: emp.abhishek.id, teamId: team[mobile ? "Mobile Team" : "Web Team"], clientId: c ? client[c] : null, startDate: iso(inDays(-30 - (i % 4) * 10)), dueDate: iso(inDays(30 + (i % 5) * 15)) },
    })).id;
  }
  const TASKS = [
    ["retainIQ", "Desktop agent auto sign-in", "rajat", "IN_PROGRESS", "HIGH"],
    ["retainIQ", "Payslip PDF layout", "ronak", "IN_REVIEW", "MEDIUM"],
    ["Accounting-software", "GST report export", "rajat", "TODO", "MEDIUM"],
    ["MIRA-AI", "Chat interface", "rajat", "TODO", "LOW"],
    ["shop-near", "Checkout page UI", "ronak", "IN_PROGRESS", "HIGH"],
    ["shop-near", "Store search filters", "ronak", "TODO", "MEDIUM"],
    ["scooty-backend", "Ride booking API", "praveen", "IN_PROGRESS", "URGENT"],
    ["scooty-backend", "Payment webhook", "praveen", "DONE", "HIGH"],
    ["scooty-owner-app", "Earnings dashboard", "praveen", "TODO", "MEDIUM"],
    ["scooty-user-app", "Ride booking screen", "ujjwal", "IN_PROGRESS", "HIGH"],
    ["scooty-user-app", "Push notifications", "ujjwal", "TODO", "LOW"],
  ];
  // A project is managed by its assigned manager: only they (not the Owner) add tasks.
  for (const [p, title, who, status, priority] of TASKS) {
    await call("POST", `/projects/${proj[p]}/tasks`, { token: emp.abhishek.token, body: { title, assigneeEmployeeId: emp[who].id, status, priority, dueDate: iso(inDays(10)) } });
  }
  ok(`${REPOS.length} projects (your GitHub repos), ${TASKS.length} tasks`);

  // 5. Time tracking ---------------------------------------------------------------
  step("Time entries and weekly timesheets");
  const today = ymd(new Date());
  const thisMonday = mondayOf(today);
  const lastMonday = addDays(thisMonday, -7);
  const projFor = { rajat: "retainIQ", ronak: "shop-near", praveen: "scooty-backend", ujjwal: "scooty-user-app" };
  const staff = PEOPLE.filter((p) => p.role === "Employee");
  for (const p of staff) {
    const project = projFor[p.key] ? proj[projFor[p.key]] : null;
    const billable = Boolean(projFor[p.key]);
    // Last week: Mon–Fri, 8h a day (one 1h internal meeting on Wednesday).
    for (let i = 0; i < 5; i++) {
      const date = addDays(lastMonday, i);
      await call("POST", "/time/entries", { token: emp[p.key].token, body: { date, projectId: project, minutes: i === 2 ? 420 : 480, billable, description: `${p.title} work` } });
      if (i === 2) await call("POST", "/time/entries", { token: emp[p.key].token, body: { date, projectId: null, minutes: 60, billable: false, description: "Team meeting" } });
    }
    // This week so far (drafts): Monday up to yesterday.
    for (let d = thisMonday; d < today; d = addDays(d, 1)) {
      await call("POST", "/time/entries", { token: emp[p.key].token, body: { date: d, projectId: project, minutes: 450, billable, description: `${p.title} work` } });
    }
  }
  // Everyone except Isha submits last week.
  for (const p of staff.filter((p) => !["isha"].includes(p.key))) {
    await call("POST", "/time/timesheet/submit", { token: emp[p.key].token, body: { week: lastMonday } });
  }
  // Managers decide: Abhishek approves Rajat + Ronak, rejects Ujjwal; Praveen stays pending. Akash approves Nikhil.
  const decide = async (mgr, who, approve, note) => {
    const pending = await call("GET", "/time/timesheets/pending", { token: emp[mgr].token });
    const ts = pending.find((t) => t.employeeId === emp[who].id);
    if (ts) await call("POST", `/time/timesheets/${ts.id}/decision`, { token: emp[mgr].token, body: { approve, note } });
  };
  await decide("abhishek", "rajat", true);
  await decide("abhishek", "ronak", true);
  await decide("abhishek", "ujjwal", false, "Wednesday hours have no project. Please fix and resubmit.");
  await decide("akash", "nikhil", true);
  ok("last week: 3 approved, Ujjwal rejected, Praveen pending (Abhishek), Isha not submitted · this week: drafts");

  // 6. Leave ---------------------------------------------------------------------
  step("Leave requests");
  const holidaySet = new Set(HOLIDAYS.map((h) => h[1]));
  const workday = (from) => { let d = from; while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()) || holidaySet.has(d)) d = addDays(d, 1); return d; };
  const d1 = workday(addDays(today, 8));
  const d2 = workday(addDays(d1, 3));
  const d3 = workday(addDays(d1, 7));
  const rajatLeave = await call("POST", "/leave/requests", { token: emp.rajat.token, body: { leaveTypeId: leaveType.CL, startDate: d1, endDate: d1, reason: "Family function" } });
  await call("POST", `/leave/requests/${rajatLeave.id}/decision`, { token: emp.abhishek.token, body: { approve: true, note: "Enjoy!" } });
  await call("POST", "/leave/requests", { token: emp.ronak.token, body: { leaveTypeId: leaveType.SL, startDate: d2, endDate: d2, reason: "Doctor appointment" } });
  await call("POST", "/leave/requests", { token: emp.praveen.token, body: { leaveTypeId: leaveType.EL, startDate: d3, endDate: workday(addDays(d3, 1)), reason: "Trip home" } });
  await call("POST", "/leave/requests", { token: emp.isha.token, body: { leaveTypeId: leaveType.CL, startDate: d2, endDate: d2, dayPart: "FIRST_HALF", reason: "Personal work" } });
  ok(`Rajat ${d1} approved · Ronak ${d2} pending (Abhishek) · Praveen from ${d3} pending (Abhishek) · Isha half day pending (Akash)`);

  // 7. Attendance today -----------------------------------------------------------
  step("Today's attendance");
  const present = PEOPLE.filter((p) => !["nikhil"].includes(p.key));
  for (const p of present) {
    await call("POST", `/attendance/check-in?source=web&location=${p.key === "ronak" ? "HOME" : "OFFICE"}`, { token: emp[p.key].token }).catch((e) => warn(`${p.first} check-in: ${e.message}`));
  }
  for (const k of ["isha"]) await call("POST", "/attendance/check-out?source=web", { token: emp[k].token }).catch((e) => warn(`${k} check-out: ${e.message}`));
  ok(`${present.length} checked in (Ronak from home), Isha already checked out, Nikhil absent`);

  // 8. Observations ----------------------------------------------------------------
  step("Manual observations");
  const obs = await call("POST", "/observations", { token: emp.abhishek.token, body: { employeeId: emp.ujjwal.id, type: "LOW_ENGAGEMENT", severity: "MEDIUM", title: "Ujjwal seems blocked on the ride booking screen", detail: "Task has not moved for a week and stand-up updates are vague." } });
  await call("POST", `/observations/${obs.id}/acknowledge`, { token: emp.abhishek.token, body: { note: "Will pair with him tomorrow." } }).catch(() => undefined);
  await call("POST", "/observations", { token: emp.akash.token, body: { employeeId: emp.isha.id, type: "OTHER", severity: "LOW", title: "Isha needs CRM training", detail: "Lead follow-ups are being tracked in a spreadsheet." } });
  ok("2 observations (1 acknowledged)");

  // 9. Desktop-agent activity → analytics -------------------------------------
  step("Sending 10 working days of desktop-agent activity through the pipeline");
  let sent = 0;
  for (const p of staff) {
    const events = activityFor(p, emp[p.key].id, today);
    for (let i = 0; i < events.length; i += 400) {
      const res = await fetch(`${INGEST}/ingest/activity`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${emp[p.key].token}` }, body: JSON.stringify({ events: events.slice(i, i + 400) }) });
      if (!res.ok) { warn(`activity for ${p.first}: HTTP ${res.status}`); break; }
      sent += Math.min(400, events.length - i);
    }
  }
  ok(`${sent} activity events queued (analytics processes them within a few seconds)`);

  // Done -----------------------------------------------------------------------------
  console.log(`\n✔ Demo org ready. Every login uses the password:  ${PASSWORD}\n`);
  console.table([
    { who: "Super Admin", email: ADMIN_EMAIL, app: "admin-web http://localhost:3100", password: "(your .env)" },
    { who: "Owner · Rahul Gupta", email: `rahul@${DOMAIN}`, app: "org-web http://localhost:3200", password: PASSWORD },
    ...PEOPLE.map((p) => ({ who: `${p.role} · ${p.first} ${p.last}`, email: emp[p.key].email, app: "org-web http://localhost:3200", password: PASSWORD })),
  ]);
  console.log("Remove everything again with:  npm run demo:remove\n");
}

/** Realistic app/website usage per persona for the last 10 working days (not today). */
function activityFor(p, employeeId, today) {
  const mix = {
    focused: [["app", "Visual Studio Code", 10], ["web", "github.com", 4], ["app", "Slack", 3], ["web", "stackoverflow.com", 2], ["web", "youtube.com", 1]],
    overworked: [["app", "Visual Studio Code", 12], ["web", "github.com", 4], ["app", "Slack", 6], ["web", "stackoverflow.com", 3]],
    distracted: [["app", "Android Studio", 5], ["web", "youtube.com", 5], ["web", "instagram.com", 3], ["app", "Slack", 3], ["web", "github.com", 2]],
    steady: [["app", "Google Chrome", 6], ["web", "jira.atlassian.com", 5], ["app", "Slack", 3], ["app", "Microsoft Excel", 3], ["web", "youtube.com", 1]],
    sales: [["web", "linkedin.com", 6], ["app", "Microsoft Outlook", 6], ["app", "Zoom", 4], ["app", "Microsoft Excel", 3], ["web", "youtube.com", 1]],
  }[p.persona ?? "steady"];
  const slots = p.persona === "overworked" ? 40 : p.persona === "distracted" ? 18 : 28; // × 15 min
  const bag = mix.flatMap(([kind, name, w]) => Array(w).fill([kind, name]));
  const events = [];
  let day = today, made = 0, seed = [...p.key].reduce((a, c) => a + c.charCodeAt(0), 7);
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  while (made < 10) {
    day = addDays(day, -1);
    if ([0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())) continue;
    made++;
    const start = Date.parse(`${day}T04:30:00Z`); // 10:00 IST
    for (let s = 0; s < slots; s++) {
      const [kind, name] = bag[Math.floor(rand() * bag.length)];
      const occurredAt = new Date(start + s * 900_000).toISOString();
      const sourceEventId = `demo-${p.key}-${day}-${s}`;
      events.push(kind === "app"
        ? { eventType: "activity.app.used", occurredAt, employeeId, sourceEventId, payload: { app: name, seconds: 900 } }
        : { eventType: "activity.website.visited", occurredAt, employeeId, sourceEventId, payload: { domain: name, url: `https://${name}/`, seconds: 900 } });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// REMOVE
// ---------------------------------------------------------------------------
async function remove() {
  step("Finding demo data");
  const orgIds = sql("identity", `
    SELECT DISTINCT o.id FROM "Organization" o
    WHERE o.name = '${ORG_NAME}'
       OR o.id IN (SELECT m."orgId" FROM "OrganizationMembership" m JOIN "User" u ON u.id = m."userId" WHERE u.email LIKE '%@${DOMAIN}');`)
    .split("\n").map((s) => s.trim()).filter(Boolean);
  const userIds = sql("identity", `SELECT id FROM "User" WHERE email LIKE '%@${DOMAIN}';`).split("\n").map((s) => s.trim()).filter(Boolean);
  if (orgIds.length === 0 && userIds.length === 0) {
    ok("nothing to remove: no demo org or demo users found");
    return;
  }
  ok(`${orgIds.length} demo org(s), ${userIds.length} demo user(s)`);

  const arr = (ids) => `ARRAY[${ids.map((i) => `'${i}'`).join(",") || "''"}]::text[]`;
  // Delete every row carrying the demo orgId, in every table that has an orgId
  // column. FK triggers are paused for this transaction only (replica role), so
  // the order of tables doesn't matter; nothing outside the demo org is touched.
  const purgeOrgRows = `
    DO $$
    DECLARE r record; n bigint; total bigint := 0;
    BEGIN
      FOR r IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
               WHERE c.table_schema = 'public' AND c.column_name = 'orgId' AND t.table_type = 'BASE TABLE' LOOP
        EXECUTE format('DELETE FROM %I WHERE "orgId"::text = ANY(%s)', r.table_name, '${arr(orgIds).replace(/'/g, "''")}');
        GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
      END LOOP;
      RAISE NOTICE 'deleted % rows', total;
    END $$;`;

  for (const db of ["identity", "analytics", "notifications", "billing", "inbox"]) {
    let extra = "";
    if (db === "identity") {
      extra = `
        DELETE FROM "Session" WHERE "userId"::text = ANY(${arr(userIds)});
        DELETE FROM "User" WHERE id::text = ANY(${arr(userIds)});
        DELETE FROM "Organization" WHERE id::text = ANY(${arr(orgIds)});`;
    }
    sql(db, `BEGIN; SET LOCAL session_replication_role = replica; ${purgeOrgRows} ${extra} COMMIT;`);
    ok(`${db} database cleaned`);
  }
  console.log("\n✔ Demo org and all its data removed. Run \"npm run demo:seed\" to create it again.\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), "user-agent": "retainiq-demo-seed" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = data?.error?.message ?? data?.message ?? text.slice(0, 200);
    const err = new Error(`${method} ${path} → HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Login is rate-limited per IP; wait and retry on 429 instead of failing. */
async function withRetry(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e.status !== 429 || attempt >= 8) throw e;
      process.stdout.write(`    (login rate limit hit, waiting 15s…)\n`);
      await sleep(15_000);
    }
  }
}

async function loginAndSetPassword(email, tempPassword) {
  const s = await withRetry(() => call("POST", "/auth/login", { body: { email, password: tempPassword } }));
  await call("POST", "/auth/change-password", { token: s.accessToken, body: { currentPassword: tempPassword, newPassword: PASSWORD } });
  return s;
}

/** Postgres via docker exec as the DB superuser. Works for the local (one instance) and full (one per service) stacks. */
function sql(db, query) {
  const names = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" }).split("\n");
  const local = names.includes("retainiq-db");
  const container = local ? "retainiq-db" : `retainiq-${db}-db`;
  const user = local ? "postgres" : db;
  if (!names.includes(container)) throw new Error(`Database container "${container}" is not running. Start the stack first.`);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", user, "-d", `retainiq-${db}`, "-v", "ON_ERROR_STOP=1", "-tAq"], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

async function waitFor(check, seconds, what) {
  for (let i = 0; i < seconds; i++) {
    if (check()) return;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for the ${what}. Is billing-service running? (docker ps)`);
}

function readDotEnv() {
  const file = new URL("../.env", import.meta.url);
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeJson = (t) => { try { return JSON.parse(t); } catch { return null; } };
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => ymd(new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5));
const mondayOf = (s) => { const dow = new Date(`${s}T00:00:00Z`).getUTCDay(); return addDays(s, -((dow + 6) % 7)); };
const step = (t) => console.log(`\n▸ ${t}`);
const ok = (t) => console.log(`  ✓ ${t}`);
const warn = (t) => console.log(`  ! ${t}`);

// ---------------------------------------------------------------------------
// Entry (last, so every helper above is initialised)
// ---------------------------------------------------------------------------
const cmd = process.argv[2];
try {
  if (cmd === "seed") await seed();
  else if (cmd === "remove") await remove();
  else {
    console.log("Usage: node scripts/demo-it-org.mjs <seed|remove>");
    process.exit(1);
  }
} catch (e) {
  console.error(`\n✖ ${e.message}`);
  process.exit(1);
}
