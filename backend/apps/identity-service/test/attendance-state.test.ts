import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availableActions,
  can,
  computeTotals,
  deriveState,
  DEFAULT_POLICY,
  splitBreakMinutes,
  type AttendancePolicy,
  type DaySnapshot,
} from "../src/modules/attendance/attendance-state.ts";

const emptyDay: DaySnapshot = {
  isWeekend: false,
  isHoliday: false,
  isOnLeave: false,
  sessionCount: 0,
  hasOpenSession: false,
  hasClosedSession: false,
  hasOpenBreak: false,
  breakCount: 0,
  breakMinutesSoFar: 0,
  openBreakMinutes: 0,
};
const day = (over: Partial<DaySnapshot>): DaySnapshot => ({ ...emptyDay, ...over });
const policy = (over: Partial<AttendancePolicy>): AttendancePolicy => ({ ...DEFAULT_POLICY, ...over });
const multi = policy({ allowMultipleSessions: true, allowReEntry: true, maxSessionsPerDay: 3 });

// ---- states ---------------------------------------------------------------

test("fresh day is NOT_CHECKED_IN", () => {
  assert.equal(deriveState(emptyDay, DEFAULT_POLICY), "NOT_CHECKED_IN");
});

test("open session is WORKING; open break wins over it", () => {
  assert.equal(deriveState(day({ sessionCount: 1, hasOpenSession: true }), DEFAULT_POLICY), "WORKING");
  assert.equal(
    deriveState(day({ sessionCount: 1, hasOpenSession: true, hasOpenBreak: true }), DEFAULT_POLICY),
    "ON_BREAK",
  );
});

test("after check-out: COMPLETED under single-session policy, CHECKED_OUT when re-entry is allowed", () => {
  const closed = day({ sessionCount: 1, hasClosedSession: true });
  assert.equal(deriveState(closed, DEFAULT_POLICY), "COMPLETED");
  assert.equal(deriveState(closed, multi), "CHECKED_OUT");
});

test("session cap turns CHECKED_OUT into COMPLETED", () => {
  const atCap = day({ sessionCount: 3, hasClosedSession: true });
  assert.equal(deriveState(atCap, multi), "COMPLETED");
});

test("non-working days are classified only when nothing was worked", () => {
  assert.equal(deriveState(day({ isWeekend: true }), DEFAULT_POLICY), "WEEKEND");
  assert.equal(deriveState(day({ isHoliday: true }), DEFAULT_POLICY), "HOLIDAY");
  assert.equal(deriveState(day({ isOnLeave: true }), DEFAULT_POLICY), "ON_LEAVE");
  // Leave outranks holiday/weekend.
  assert.equal(deriveState(day({ isOnLeave: true, isHoliday: true }), DEFAULT_POLICY), "ON_LEAVE");
  // Worked on a holiday -> the work wins.
  assert.equal(deriveState(day({ isHoliday: true, sessionCount: 1, hasOpenSession: true }), DEFAULT_POLICY), "WORKING");
});

// ---- guards ---------------------------------------------------------------

test("double check-in is rejected", () => {
  const r = can("CHECK_IN", day({ sessionCount: 1, hasOpenSession: true }), DEFAULT_POLICY);
  assert.equal(r.allowed, false);
  assert.match(r.reason!, /already checked in/i);
});

test("re-entry blocked by policy, allowed when enabled", () => {
  const closed = day({ sessionCount: 1, hasClosedSession: true });
  assert.equal(can("CHECK_IN", closed, DEFAULT_POLICY).allowed, false);
  assert.equal(can("CHECK_IN", closed, multi).allowed, true);
});

test("re-entry stops at maxSessionsPerDay", () => {
  assert.equal(can("CHECK_IN", day({ sessionCount: 3, hasClosedSession: true }), multi).allowed, false);
});

test("double check-out and check-out without check-in are rejected", () => {
  assert.equal(can("CHECK_OUT", emptyDay, DEFAULT_POLICY).allowed, false);
  assert.equal(can("CHECK_OUT", day({ sessionCount: 1, hasClosedSession: true }), multi).allowed, false);
});

test("check-out during a break follows policy", () => {
  const onBreak = day({ sessionCount: 1, hasOpenSession: true, hasOpenBreak: true });
  const blocked = can("CHECK_OUT", onBreak, DEFAULT_POLICY);
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason!, /End your break/i);
  assert.equal(can("CHECK_OUT", onBreak, policy({ allowCheckOutOnBreak: true })).allowed, true);
});

test("consecutive break starts rejected; break end without a break rejected", () => {
  const onBreak = day({ sessionCount: 1, hasOpenSession: true, hasOpenBreak: true });
  assert.equal(can("BREAK_START", onBreak, DEFAULT_POLICY).allowed, false);
  assert.equal(can("BREAK_END", day({ sessionCount: 1, hasOpenSession: true }), DEFAULT_POLICY).allowed, false);
});

test("break requires an open session", () => {
  assert.equal(can("BREAK_START", emptyDay, DEFAULT_POLICY).allowed, false);
  assert.equal(can("BREAK_START", day({ sessionCount: 1, hasClosedSession: true }), multi).allowed, false);
});

test("break count and daily break-minute caps are enforced", () => {
  const working = { sessionCount: 1, hasOpenSession: true };
  assert.equal(can("BREAK_START", day({ ...working, breakCount: 2 }), policy({ maxBreaksPerDay: 2 })).allowed, false);
  assert.equal(
    can("BREAK_START", day({ ...working, breakMinutesSoFar: 60 }), policy({ maxBreakMinutesPerDay: 60 })).allowed,
    false,
  );
  // Unlimited when the cap is 0.
  assert.equal(can("BREAK_START", day({ ...working, breakCount: 9, breakMinutesSoFar: 500 }), DEFAULT_POLICY).allowed, true);
});

// ---- UI action list -------------------------------------------------------

test("available actions match the state the UI should render", () => {
  assert.deepEqual(availableActions(emptyDay, DEFAULT_POLICY), ["CHECK_IN"]);
  assert.deepEqual(availableActions(day({ sessionCount: 1, hasOpenSession: true }), DEFAULT_POLICY), [
    "BREAK_START",
    "CHECK_OUT",
  ]);
  assert.deepEqual(
    availableActions(day({ sessionCount: 1, hasOpenSession: true, hasOpenBreak: true }), DEFAULT_POLICY),
    ["BREAK_END"],
  );
  // Completed day offers nothing; re-entry policy offers CHECK_IN again.
  assert.deepEqual(availableActions(day({ sessionCount: 1, hasClosedSession: true }), DEFAULT_POLICY), []);
  assert.deepEqual(availableActions(day({ sessionCount: 1, hasClosedSession: true }), multi), ["CHECK_IN"]);
});

// ---- calculations ---------------------------------------------------------

test("paid break allowance splits break minutes", () => {
  assert.deepEqual(splitBreakMinutes(45, policy({ paidBreakMinutesPerDay: 30 })), { paid: 30, unpaid: 15 });
  assert.deepEqual(splitBreakMinutes(20, policy({ paidBreakMinutesPerDay: 30 })), { paid: 20, unpaid: 0 });
  assert.deepEqual(splitBreakMinutes(45, DEFAULT_POLICY), { paid: 0, unpaid: 45 });
});

test("net work deducts only unpaid breaks", () => {
  const t = computeTotals({ grossMinutes: 480, breakMinutes: 60, shiftMinutes: 480, policy: policy({ paidBreakMinutesPerDay: 30 }) });
  assert.equal(t.unpaidBreakMinutes, 30);
  assert.equal(t.workMinutes, 450); // 480 − 30 unpaid
});

test("overtime is measured past the shift, or an explicit threshold", () => {
  assert.equal(computeTotals({ grossMinutes: 600, breakMinutes: 0, shiftMinutes: 480, policy: DEFAULT_POLICY }).overtimeMinutes, 120);
  assert.equal(
    computeTotals({ grossMinutes: 600, breakMinutes: 0, shiftMinutes: 480, policy: policy({ overtimeAfterMinutes: 540 }) }).overtimeMinutes,
    60,
  );
  // No shift and no threshold -> no overtime rather than a bogus number.
  assert.equal(computeTotals({ grossMinutes: 600, breakMinutes: 0, shiftMinutes: 0, policy: DEFAULT_POLICY }).overtimeMinutes, 0);
});

test("work minutes never go negative", () => {
  const t = computeTotals({ grossMinutes: 20, breakMinutes: 90, shiftMinutes: 480, policy: DEFAULT_POLICY });
  assert.equal(t.workMinutes, 0);
});
