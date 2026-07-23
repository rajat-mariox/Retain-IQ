/**
 * Headless test of the agent renderer's show/hide flow.
 *
 * The renderer is plain DOM code, so we can drive it with a minimal fake
 * document + a stubbed window.agent and assert which cards are visible in each
 * state. This is what the reported bug was about: the attendance card staying
 * visible after sign-out.
 */
import { readFileSync } from "node:fs";

// --- tiny DOM stub -------------------------------------------------------
function makeEl(id) {
  return {
    id,
    _classes: new Set(id === "statusView" || id === "attendance" ? ["hide"] : []),
    textContent: "",
    innerHTML: "",
    disabled: false,
    value: id === "breakKind" ? "LUNCH" : "",
    dataset: {},
    classList: {
      add: function (c) { this.owner._classes.add(c); },
      remove: function (c) { this.owner._classes.delete(c); },
      contains: function (c) { return this.owner._classes.has(c); },
    },
    addEventListener() {},
  };
}
const els = {};
for (const id of ["loginView", "statusView", "attendance", "sub", "who", "org", "state", "app", "site",
  "shots", "queued", "uploaded", "flush", "toggleBtn", "logoutBtn", "err", "email", "password",
  "remember", "loginBtn", "attState", "attIn", "attOut", "attBreak", "attOtRow", "attOt",
  "breakKind", "breakBtn", "punchBtn"]) {
  const el = makeEl(id);
  el.classList.owner = el;
  els[id] = el;
}
const visible = (id) => !els[id]._classes.has("hide");

globalThis.document = { getElementById: (id) => els[id] ?? null };
globalThis.setInterval = () => 0; // don't start the 3s poll

// --- stubbed agent bridge ------------------------------------------------
let state = { session: null, attendance: null };
globalThis.window = {
  agent: {
    session: async () => state.session,
    status: async () => ({ running: true, idle: false, lastApp: "Code", currentSite: null, queued: 0, uploadedTotal: 0, lastFlushAt: null, screenshotsEnabled: false }),
    attendance: async () => state.attendance,
    logout: async () => { state.session = null; state.attendance = null; return true; },
    breakStart: async () => {}, breakEnd: async () => {}, login: async () => {}, start: async () => {}, stop: async () => {},
  },
};

// Load the renderer (it calls render() once at the end).
const code = readFileSync(new URL("../src/renderer/renderer.js", import.meta.url), "utf8");
const run = new Function(code);
run();

const settle = () => new Promise((r) => setTimeout(r, 20));
let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} (got ${actual}, expected ${expected})`);
}

console.log("1) Signed out");
state = { session: null, attendance: null };
await globalThis.__render();
await settle();
check("login card visible", visible("loginView"), true);
check("status card hidden", visible("statusView"), false);
check("attendance card hidden", visible("attendance"), false);

console.log("\n2) Signed in, staff, checked in");
state = {
  session: { email: "dev@x.test", orgName: "Mariox" },
  attendance: { tracksAttendance: true, state: "WORKING", availableActions: ["BREAK_START","CHECK_OUT"], checkedIn: true, checkedOut: false, onBreak: false, checkInAt: new Date().toISOString(), checkOutAt: null, breakMinutes: 0, sessionCount: 1 },
};
await globalThis.__render();
await settle();
check("status card visible", visible("statusView"), true);
check("attendance card visible", visible("attendance"), true);
check("break button enabled", els.breakBtn.disabled, false);
check("break button label", els.breakBtn.textContent, "Start break");
// The kind picker is offered before a break; the overtime row is always shown
// (as 0h 0m until any accrues) so the employee can see it's being tracked.
check("break-kind picker visible before a break", visible("breakKind"), true);
check("overtime row visible even at zero", visible("attOtRow"), true);
check("overtime reads zero when none", els.attOt.textContent, "0h 0m");

console.log("\n2b) Overtime measured -> read-only row appears");
state.attendance = { ...state.attendance, overtimeMinutes: 95 };
await globalThis.__render();
await settle();
check("overtime row visible", visible("attOtRow"), true);
check("overtime shown as pending", els.attOt.textContent, "1h 35m (pending approval)");

console.log("\n3) On break");
state.attendance = { ...state.attendance, state: "ON_BREAK", availableActions: ["BREAK_END"], onBreak: true };
await globalThis.__render();
await settle();
check("break button label", els.breakBtn.textContent, "End break");
check("break-kind picker hidden while on a break", visible("breakKind"), false);

// The sign-out check must run while the attendance card is VISIBLE, otherwise
// an earlier state that happens to hide it (e.g. the owner case) masks the bug.
console.log("\n4) THE BUG: sign out while on break -> attendance must disappear");
check("precondition: attendance visible", visible("attendance"), true);
state = { session: null, attendance: null };
await globalThis.__render();
await settle();
check("login card visible", visible("loginView"), true);
check("status card hidden", visible("statusView"), false);
check("attendance card hidden", visible("attendance"), false);

console.log("\n5) Owner (not tracked for attendance)");
state = {
  session: { email: "owner@x.test", orgName: "Mariox" },
  attendance: { tracksAttendance: false, state: "NOT_CHECKED_IN", availableActions: [] },
};
await globalThis.__render();
await settle();
check("attendance card hidden for owner", visible("attendance"), false);
check("status card still visible", visible("statusView"), true);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
