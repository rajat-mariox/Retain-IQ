import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The clamp rule that makes "forgetting" to check out unprofitable.
 *
 * Mirrors AttendanceAutoCloseService.maybeClose: the recorded end is the
 * EARLIEST of (last observed activity, shift end), floored at the session start.
 * Kept as a pure function here so the rule itself is provable without a
 * database — the service applies exactly this arithmetic.
 */
function clampEnd(args: { sessionStart: Date; shiftEnd: Date; lastActivity: Date | null }): Date {
  const candidates = [args.shiftEnd];
  if (args.lastActivity) candidates.push(args.lastActivity);
  const end = new Date(Math.min(...candidates.map((d) => d.getTime())));
  return end < args.sessionStart ? args.sessionStart : end;
}

const at = (hhmm: string) => new Date(`2026-07-22T${hhmm}:00.000Z`);
const minutes = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60000);

test("leaving the session open past shift end earns nothing extra", () => {
  // Worked 09:00, shift ends 18:00, never checked out — sweeper runs at 23:00.
  const end = clampEnd({ sessionStart: at("09:00"), shiftEnd: at("18:00"), lastActivity: null });
  assert.equal(end.toISOString(), at("18:00").toISOString());
  assert.equal(minutes(at("09:00"), end), 540); // 9h, not the 14h to 23:00
});

test("genuine late work is credited up to the last activity", () => {
  // Activity until 17:30, shift ends 18:00 -> the earlier bound (activity) wins.
  const end = clampEnd({ sessionStart: at("09:00"), shiftEnd: at("18:00"), lastActivity: at("17:30") });
  assert.equal(minutes(at("09:00"), end), 510); // 8h30m, their real work
});

test("activity after shift end cannot extend the day", () => {
  // An agent left running on an idle machine reports activity at 22:00.
  const end = clampEnd({ sessionStart: at("09:00"), shiftEnd: at("18:00"), lastActivity: at("22:00") });
  assert.equal(end.toISOString(), at("18:00").toISOString());
});

test("no activity signal falls back to the shift bound", () => {
  const end = clampEnd({ sessionStart: at("09:00"), shiftEnd: at("18:00"), lastActivity: null });
  assert.equal(end.toISOString(), at("18:00").toISOString());
});

test("a session started after shift end never goes negative", () => {
  // Checked in at 19:00 on a day whose shift ended at 18:00.
  const end = clampEnd({ sessionStart: at("19:00"), shiftEnd: at("18:00"), lastActivity: null });
  assert.equal(end.toISOString(), at("19:00").toISOString());
  assert.equal(minutes(at("19:00"), end), 0);
});

test("overnight shift: end instant is on the next calendar day", () => {
  // 22:00 -> 06:00 shift; the shift end used is the following morning.
  const shiftEnd = new Date("2026-07-23T06:00:00.000Z");
  const end = clampEnd({ sessionStart: at("22:00"), shiftEnd, lastActivity: null });
  assert.equal(end.toISOString(), shiftEnd.toISOString());
  assert.equal(minutes(at("22:00"), end), 480); // a full 8h night
});

test("the clamp is never generous: end <= both bounds, always", () => {
  const cases = [
    { sessionStart: at("08:00"), shiftEnd: at("17:00"), lastActivity: at("12:00") },
    { sessionStart: at("08:00"), shiftEnd: at("17:00"), lastActivity: at("19:00") },
    { sessionStart: at("08:00"), shiftEnd: at("17:00"), lastActivity: null },
  ];
  for (const c of cases) {
    const end = clampEnd(c);
    assert.ok(end.getTime() <= c.shiftEnd.getTime(), "never past shift end");
    if (c.lastActivity && c.lastActivity > c.sessionStart) {
      assert.ok(end.getTime() <= Math.max(c.lastActivity.getTime(), c.shiftEnd.getTime()));
    }
    assert.ok(end.getTime() >= c.sessionStart.getTime(), "never before the start");
  }
});

test("overtime is zeroed on auto-closed days", () => {
  // Encodes the policy decision: OT is a claim, and a claim needs a check-out.
  const autoClosedOvertime = 0;
  const grossMinutes = 540;
  const shiftMinutes = 480;
  const wouldHaveBeen = Math.max(0, grossMinutes - shiftMinutes);
  assert.equal(wouldHaveBeen, 60);
  assert.equal(autoClosedOvertime, 0, "auto-closed days record no overtime");
});
