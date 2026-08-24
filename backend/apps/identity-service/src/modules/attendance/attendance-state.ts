/**
 * Attendance state machine.
 *
 * Pure functions over a snapshot of the day — no database, no request context —
 * so every rule here is directly testable and the service stays thin. The
 * service loads a snapshot, asks this module what is allowed, and only then
 * writes.
 */

export type AttendanceState =
  | "NOT_CHECKED_IN"
  | "WORKING"
  | "ON_BREAK"
  | "CHECKED_OUT"
  | "COMPLETED"
  | "ABSENT"
  | "ON_LEAVE"
  | "HOLIDAY"
  | "WEEKEND";

export type AttendanceAction = "CHECK_IN" | "CHECK_OUT" | "BREAK_START" | "BREAK_END";

/** The org rules that gate transitions. Mirrors the AttendancePolicy row. */
export interface AttendancePolicy {
  allowMultipleSessions: boolean;
  allowReEntry: boolean;
  maxSessionsPerDay: number;
  maxBreaksPerDay: number;
  maxBreakMinutesPerDay: number;
  maxSingleBreakMinutes: number;
  paidBreakMinutesPerDay: number;
  allowCheckOutOnBreak: boolean;
  minMinutesBeforeBreak: number;
  minMinutesBeforeCheckOut: number;
  graceMinutes: number;
  autoCheckOutAtShiftEnd: boolean;
  autoCheckOutAfterMinutes: number;
  idleCheckoutMinutes: number;
  idleCheckoutWarnMinutes: number;
  overtimeAfterMinutes: number;
  minHoursForPresent: number;
  workModel: string;
  allowedLocations: string[];
  requireLocation: boolean;
  allowManualCorrection: boolean;
}

export const DEFAULT_POLICY: AttendancePolicy = {
  // Conservative by default: one session a day, matching classic check-in/out.
  allowMultipleSessions: false,
  allowReEntry: false,
  maxSessionsPerDay: 1,
  maxBreaksPerDay: 0,
  maxBreakMinutesPerDay: 0,
  maxSingleBreakMinutes: 0,
  paidBreakMinutesPerDay: 0,
  allowCheckOutOnBreak: false,
  minMinutesBeforeBreak: 0,
  minMinutesBeforeCheckOut: 0,
  graceMinutes: 10,
  autoCheckOutAtShiftEnd: false,
  autoCheckOutAfterMinutes: 120,
  idleCheckoutMinutes: 0,
  idleCheckoutWarnMinutes: 5,
  overtimeAfterMinutes: 0,
  minHoursForPresent: 240,
  workModel: "WFO",
  allowedLocations: ["OFFICE", "HOME", "CLIENT_SITE", "REMOTE"],
  requireLocation: false,
  allowManualCorrection: true,
};

/** Everything the machine needs to know about the day, already loaded. */
export interface DaySnapshot {
  /** Non-working day classifications win over everything else. */
  isWeekend: boolean;
  isHoliday: boolean;
  isOnLeave: boolean;
  sessionCount: number;
  hasOpenSession: boolean;
  hasClosedSession: boolean;
  hasOpenBreak: boolean;
  breakCount: number;
  breakMinutesSoFar: number;
  /** Minutes elapsed in the currently open break, if any. */
  openBreakMinutes: number;
  /** Minutes elapsed in the currently open work session (since check-in), if any. */
  openSessionMinutes: number;
}

export interface Decision {
  allowed: boolean;
  /** Employee-facing explanation when not allowed. */
  reason?: string;
}

/**
 * Derive the day's state. Non-working classifications take precedence: a
 * holiday is a holiday even if someone punched in on it.
 */
export function deriveState(snap: DaySnapshot, policy: AttendancePolicy): AttendanceState {
  if (snap.hasOpenBreak) return "ON_BREAK";
  if (snap.hasOpenSession) return "WORKING";

  // Nothing worked yet — fall back to why the day is empty.
  if (snap.sessionCount === 0) {
    if (snap.isOnLeave) return "ON_LEAVE";
    if (snap.isHoliday) return "HOLIDAY";
    if (snap.isWeekend) return "WEEKEND";
    return "NOT_CHECKED_IN";
  }

  // Worked and currently out: can they come back?
  return canStartAnotherSession(snap, policy) ? "CHECKED_OUT" : "COMPLETED";
}

/** Is the employee permitted to open another session right now? */
function canStartAnotherSession(snap: DaySnapshot, policy: AttendancePolicy): boolean {
  if (snap.sessionCount === 0) return true; // first check-in of the day
  if (!policy.allowMultipleSessions && !policy.allowReEntry) return false;
  const cap = policy.maxSessionsPerDay > 0 ? policy.maxSessionsPerDay : Number.POSITIVE_INFINITY;
  return snap.sessionCount < cap;
}

/**
 * Can this action run from the current state? One place, so the API and the UI
 * never disagree about what's offered.
 */
export function can(action: AttendanceAction, snap: DaySnapshot, policy: AttendancePolicy): Decision {
  const state = deriveState(snap, policy);

  switch (action) {
    case "CHECK_IN": {
      if (snap.hasOpenSession || snap.hasOpenBreak) {
        return { allowed: false, reason: "You are already checked in." };
      }
      if (!canStartAnotherSession(snap, policy)) {
        return snap.sessionCount > 0
          ? { allowed: false, reason: "You have already completed attendance for today." }
          : { allowed: false, reason: "Checking in is not allowed right now." };
      }
      return { allowed: true };
    }

    case "CHECK_OUT": {
      if (!snap.hasOpenSession && !snap.hasOpenBreak) {
        return { allowed: false, reason: "You have not checked in." };
      }
      // Can't check out too soon after checking in (stops immediate cross-out).
      if (policy.minMinutesBeforeCheckOut > 0 && snap.hasOpenSession && snap.openSessionMinutes < policy.minMinutesBeforeCheckOut) {
        const left = policy.minMinutesBeforeCheckOut - snap.openSessionMinutes;
        return { allowed: false, reason: `You can check out ${left} minute${left === 1 ? "" : "s"} from now (minimum ${policy.minMinutesBeforeCheckOut} minutes after check-in).` };
      }
      if (snap.hasOpenBreak && !policy.allowCheckOutOnBreak) {
        return { allowed: false, reason: "End your break before checking out." };
      }
      return { allowed: true };
    }

    case "BREAK_START": {
      if (state === "ON_BREAK") return { allowed: false, reason: "You are already on a break." };
      if (!snap.hasOpenSession) return { allowed: false, reason: "Check in before taking a break." };
      // Can't take a break too soon after checking in.
      if (policy.minMinutesBeforeBreak > 0 && snap.openSessionMinutes < policy.minMinutesBeforeBreak) {
        const left = policy.minMinutesBeforeBreak - snap.openSessionMinutes;
        return { allowed: false, reason: `You can take a break ${left} minute${left === 1 ? "" : "s"} from now (minimum ${policy.minMinutesBeforeBreak} minutes after check-in).` };
      }
      if (policy.maxBreaksPerDay > 0 && snap.breakCount >= policy.maxBreaksPerDay) {
        return { allowed: false, reason: `You have used all ${policy.maxBreaksPerDay} breaks for today.` };
      }
      if (policy.maxBreakMinutesPerDay > 0 && snap.breakMinutesSoFar >= policy.maxBreakMinutesPerDay) {
        return { allowed: false, reason: `You have used your ${policy.maxBreakMinutesPerDay} minutes of break time for today.` };
      }
      return { allowed: true };
    }

    case "BREAK_END": {
      if (!snap.hasOpenBreak) return { allowed: false, reason: "You are not on a break." };
      return { allowed: true };
    }

    default:
      return { allowed: false, reason: "Unsupported action." };
  }
}

/** The actions the UI should render, in the order they make sense. */
export function availableActions(snap: DaySnapshot, policy: AttendancePolicy): AttendanceAction[] {
  const order: AttendanceAction[] = ["CHECK_IN", "BREAK_START", "BREAK_END", "CHECK_OUT"];
  return order.filter((a) => can(a, snap, policy).allowed);
}

/**
 * Split break minutes into paid and unpaid. The first
 * `paidBreakMinutesPerDay` minutes of the day are paid (counted as worked);
 * anything beyond is deducted.
 */
export function splitBreakMinutes(totalBreakMinutes: number, policy: AttendancePolicy): { paid: number; unpaid: number } {
  const paidAllowance = Math.max(0, policy.paidBreakMinutesPerDay);
  const paid = Math.min(totalBreakMinutes, paidAllowance);
  return { paid, unpaid: Math.max(0, totalBreakMinutes - paid) };
}

export interface DayTotalsInput {
  /** Gross wall-clock minutes across all sessions. */
  grossMinutes: number;
  breakMinutes: number;
  /** Assigned shift length in minutes; 0 when unknown. */
  shiftMinutes: number;
  policy: AttendancePolicy;
}

export interface DayTotals {
  workMinutes: number;
  breakMinutes: number;
  unpaidBreakMinutes: number;
  paidBreakMinutes: number;
  overtimeMinutes: number;
}

/**
 * Day totals. Net worked time deducts only the UNPAID part of breaks, and
 * overtime is measured past either an explicit threshold or the shift length.
 */
export function computeTotals(input: DayTotalsInput): DayTotals {
  const { paid, unpaid } = splitBreakMinutes(input.breakMinutes, input.policy);
  const workMinutes = Math.max(0, input.grossMinutes - unpaid);

  const otThreshold =
    input.policy.overtimeAfterMinutes > 0
      ? input.policy.overtimeAfterMinutes
      : input.shiftMinutes > 0
        ? input.shiftMinutes
        : 0;
  const overtimeMinutes = otThreshold > 0 ? Math.max(0, workMinutes - otThreshold) : 0;

  return {
    workMinutes,
    breakMinutes: input.breakMinutes,
    unpaidBreakMinutes: unpaid,
    paidBreakMinutes: paid,
    overtimeMinutes,
  };
}

/** Attendance status for reporting: PRESENT / LATE / half-day handling. */
export function deriveStatus(args: {
  workMinutes: number;
  lateMinutes: number;
  policy: AttendancePolicy;
  hasAnySession: boolean;
}): "PRESENT" | "LATE" | "ABSENT" {
  if (!args.hasAnySession) return "ABSENT";
  // Too short a day still counts as attendance, but flagged via workMinutes;
  // LATE wins as the visible status when the person arrived after grace.
  if (args.lateMinutes > 0) return "LATE";
  return "PRESENT";
}
