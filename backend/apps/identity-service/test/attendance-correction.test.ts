import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Validation rules for approving an attendance correction.
 *
 * Mirrors the guards in AttendanceCorrectionService.decide(). A correction
 * rewrites the FIRST session's start and/or the LAST session's end, so the
 * requested times must fit those sessions — not merely the day. Checking only
 * against the day's first check-in let an approval write an end that preceded
 * its own session's start, producing a negative-length session.
 */
type Session = { startedAt: Date; endedAt: Date | null };

function validateCorrection(args: {
  dayCheckInAt: Date | null;
  dayCheckOutAt: Date | null;
  first: Session | null;
  last: Session | null;
  requestedCheckInAt?: Date;
  requestedCheckOutAt?: Date;
}): string | null {
  const newIn = args.requestedCheckInAt ?? args.dayCheckInAt;
  const newOut = args.requestedCheckOutAt ?? args.dayCheckOutAt;
  if (newIn && newOut && newOut < newIn) return "check-out before check-in";
  if (args.requestedCheckOutAt && args.last && args.requestedCheckOutAt < args.last.startedAt) {
    return "check-out before the last session started";
  }
  if (args.requestedCheckInAt && args.first?.endedAt && args.requestedCheckInAt > args.first.endedAt) {
    return "check-in after the first session ended";
  }
  return null;
}

const at = (hhmm: string) => new Date(`2026-07-22T${hhmm}:00.000Z`);

test("a straightforward missed check-out is accepted", () => {
  const err = validateCorrection({
    dayCheckInAt: at("09:00"),
    dayCheckOutAt: null,
    first: { startedAt: at("09:00"), endedAt: null },
    last: { startedAt: at("09:00"), endedAt: null },
    requestedCheckOutAt: at("18:00"),
  });
  assert.equal(err, null);
});

test("check-out before check-in is rejected", () => {
  const err = validateCorrection({
    dayCheckInAt: at("09:00"),
    dayCheckOutAt: null,
    first: { startedAt: at("09:00"), endedAt: null },
    last: { startedAt: at("09:00"), endedAt: null },
    requestedCheckOutAt: at("08:00"),
  });
  assert.equal(err, "check-out before check-in");
});

test("THE BUG: on a multi-session day, a check-out before the LAST session's start is rejected", () => {
  // Day starts 07:12; a later session starts 13:34. Asking for 13:00 is after
  // the day's check-in but before that session began — previously accepted, and
  // it wrote a session whose end preceded its own start.
  const err = validateCorrection({
    dayCheckInAt: at("07:12"),
    dayCheckOutAt: at("13:24"),
    first: { startedAt: at("07:12"), endedAt: at("11:22") },
    last: { startedAt: at("13:34"), endedAt: at("13:34") },
    requestedCheckOutAt: at("13:00"),
  });
  assert.equal(err, "check-out before the last session started");
});

test("the same time is fine once it falls inside the last session", () => {
  const err = validateCorrection({
    dayCheckInAt: at("07:12"),
    dayCheckOutAt: at("13:24"),
    first: { startedAt: at("07:12"), endedAt: at("11:22") },
    last: { startedAt: at("12:30"), endedAt: at("13:24") },
    requestedCheckOutAt: at("13:00"),
  });
  assert.equal(err, null);
});

test("a check-in moved past the first session's end is rejected", () => {
  const err = validateCorrection({
    dayCheckInAt: at("09:00"),
    dayCheckOutAt: at("18:00"),
    first: { startedAt: at("09:00"), endedAt: at("12:00") },
    last: { startedAt: at("13:00"), endedAt: at("18:00") },
    requestedCheckInAt: at("14:00"),
  });
  assert.equal(err, "check-in after the first session ended");
});

test("correcting a late arrival within the first session is accepted", () => {
  const err = validateCorrection({
    dayCheckInAt: at("09:00"),
    dayCheckOutAt: at("18:00"),
    first: { startedAt: at("09:00"), endedAt: at("12:00") },
    last: { startedAt: at("13:00"), endedAt: at("18:00") },
    requestedCheckInAt: at("09:30"),
  });
  assert.equal(err, null);
});

test("no approved correction can produce a negative-length session", () => {
  const cases = [
    { last: { startedAt: at("13:34"), endedAt: at("13:34") }, out: at("13:00") },
    { last: { startedAt: at("09:00"), endedAt: null }, out: at("08:59") },
    { last: { startedAt: at("17:00"), endedAt: at("18:00") }, out: at("16:00") },
  ];
  for (const c of cases) {
    const err = validateCorrection({
      dayCheckInAt: at("07:00"),
      dayCheckOutAt: null,
      first: { startedAt: at("07:00"), endedAt: at("08:00") },
      last: c.last,
      requestedCheckOutAt: c.out,
    });
    assert.notEqual(err, null, `expected rejection for out=${c.out.toISOString()}`);
  }
});

test("direct overtime approval can trim a claim but never inflate it", () => {
  // approveOvertime(): the measured amount is always the ceiling.
  const grant = (claimed: number, measured: number) => Math.max(0, Math.min(claimed, measured));
  assert.equal(grant(120, 90), 90, "capped at what was measured");
  assert.equal(grant(60, 90), 60, "approver may grant less");
  assert.equal(grant(0, 90), 0, "may grant nothing");
});

/**
 * The correction path is the escape hatch for overtime the clock never saw —
 * typically a missed check-out, where auto-close clamped the day to shift end
 * and measured overtime is therefore zero. The manager's sign-off is the
 * evidence there, but it is still bounded by the day's worked time.
 */
test("overtime correction: measured amount is the ceiling when there is one", () => {
  const payable = (claimed: number, measuredOt: number, workMinutes: number) =>
    Math.max(0, Math.min(claimed, measuredOt > 0 ? measuredOt : workMinutes));
  assert.equal(payable(120, 90, 600), 90, "trimmed to measured overtime");
  assert.equal(payable(45, 90, 600), 45, "a smaller claim stands");
});

test("overtime correction: unmeasured overtime is allowed but capped at worked time", () => {
  const payable = (claimed: number, measuredOt: number, workMinutes: number) =>
    Math.max(0, Math.min(claimed, measuredOt > 0 ? measuredOt : workMinutes));
  // Missed check-out: auto-close zeroed OT, but they really did work late.
  assert.equal(payable(45, 0, 480), 45, "manager sign-off is the evidence");
  // A claim can never exceed the day's actual work.
  assert.equal(payable(900, 0, 480), 480, "bounded by worked minutes");
  assert.equal(payable(60, 0, 0), 0, "no work means no overtime");
});
