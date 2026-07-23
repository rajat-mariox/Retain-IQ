import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { PublicRoute } from "../../common/decorators/public-route.decorator.js";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { AttendanceCorrectionService } from "./attendance-correction.service.js";
import { AttendanceService } from "./attendance.service.js";

const correctionSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum(["MISSED_CHECK_IN", "MISSED_CHECK_OUT", "WRONG_TIME", "OVERTIME", "OTHER"]),
    reason: z.string().min(3).max(500),
    checkInAt: z.string().datetime().optional(),
    checkOutAt: z.string().datetime().optional(),
    overtimeMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  });
const decisionSchema = z.object({ approve: z.boolean(), note: z.string().max(500).optional() });
/** `minutes` omitted = approve everything measured; never more than measured. */
const overtimeSchema = z.object({ minutes: z.coerce.number().int().min(0).max(1440).optional(), note: z.string().max(500).optional() });

@Controller("attendance")
@RequireFeature("attendance")
// PermissionGuard is a no-op on routes without @RequirePermissions, so listing
// it here costs the self-service routes nothing while making the approver-only
// ones (corrections queue, overtime sign-off) actually enforce their decorator.
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly corrections: AttendanceCorrectionService,
  ) {}

  /**
   * Self check-in. `source=agent` is sent by the desktop agent on sign-in;
   * the browser omits it and defaults to "web". Owner accounts are rejected
   * by the service — attendance is for staff only.
   */
  @Post("check-in")
  @HttpCode(200)
  @PublicRoute("a person checks themselves in")
  checkIn(@Query("source") source?: string, @Query("location") location?: string) {
    return this.attendance.checkIn(source === "agent" ? "agent" : "web", location);
  }

  /** Self check-out (agent sign-out/quit, or the browser button). */
  @Post("check-out")
  @HttpCode(200)
  @PublicRoute("a person checks themselves out")
  checkOut(@Query("source") source?: string) {
    return this.attendance.checkOut(source === "agent" ? "agent" : "web");
  }

  /** Start a break. Idempotent while a break is already open. */
  @Post("break/start")
  @HttpCode(200)
  @PublicRoute("a person starts their own break")
  startBreak(@Query("source") source?: string, @Query("kind") kind?: string) {
    return this.attendance.startBreak(source === "agent" ? "agent" : "web", kind || "BREAK");
  }

  /** End the open break; its minutes are deducted from worked time. */
  @Post("break/end")
  @HttpCode(200)
  @PublicRoute("a person ends their own break")
  endBreak(@Query("source") source?: string) {
    return this.attendance.endBreak(source === "agent" ? "agent" : "web");
  }

  /**
   * Live attendance state for the caller. Both the browser and the desktop
   * agent read this to stay in step after a change on the other surface.
   */
  @Get("status")
  @PublicRoute("the caller's own live attendance state")
  status() {
    return this.attendance.liveStatus();
  }

  // ---- Manual corrections & overtime approval ----

  /** Raise a correction for one of your own days (missed punch, wrong time, OT). */
  @Post("corrections")
  @HttpCode(200)
  @PublicRoute("a person raises a correction for their own day")
  requestCorrection(@Body(new ZodValidationPipe(correctionSchema)) body: z.infer<typeof correctionSchema>) {
    return this.corrections.request(body);
  }

  /** The caller's own correction history. */
  @Get("corrections/me")
  @PublicRoute("the caller's own correction history")
  myCorrections() {
    return this.corrections.mine();
  }

  /**
   * The approval queue. Scoped by reporting line: a manager sees their reports,
   * the Owner sees everyone who has no manager of their own.
   */
  @Get("corrections/pending")
  @RequirePermissions(permissions.attendanceApprove)
  pendingCorrections() {
    return this.corrections.pending();
  }

  @Post("corrections/:id/decision")
  @HttpCode(200)
  @RequirePermissions(permissions.attendanceApprove)
  decideCorrection(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decisionSchema)) body: z.infer<typeof decisionSchema>,
  ) {
    return this.corrections.decide(id, body.approve, body.note);
  }

  /** Days with measured-but-unapproved overtime, scoped to the approver's reports. */
  @Get("overtime/pending")
  @RequirePermissions(permissions.attendanceApprove)
  pendingOvertime() {
    return this.corrections.pendingOvertime();
  }

  /** Sign off overtime for a day. Only the approved portion is payable. */
  @Post("overtime/:attendanceId/approve")
  @HttpCode(200)
  @RequirePermissions(permissions.attendanceApprove)
  approveOvertime(
    @Param("attendanceId", ParseUUIDPipe) attendanceId: string,
    @Body(new ZodValidationPipe(overtimeSchema)) body: z.infer<typeof overtimeSchema>,
  ) {
    return this.corrections.approveOvertime(attendanceId, body.minutes, body.note);
  }

  /** Withdraw your own pending request. */
  @Post("corrections/:id/cancel")
  @HttpCode(200)
  @PublicRoute("a person withdraws their own pending request")
  cancelCorrection(@Param("id", ParseUUIDPipe) id: string) {
    return this.corrections.cancel(id);
  }

  /** The caller's own attendance (today + recent history). */
  @Get("me")
  @PublicRoute("the caller's own attendance")
  me() {
    return this.attendance.me();
  }

  /** Org-wide attendance for today — requires attendance.read. */
  @Get("today")
  @RequirePermissions(permissions.attendanceRead)
  today() {
    return this.attendance.today();
  }

  /** Full per-employee attendance roster for today (admin view) — requires attendance.read. */
  @Get("roster")
  @RequirePermissions(permissions.attendanceRead)
  roster() {
    return this.attendance.roster();
  }

  /** Daily Attendance report — per-employee for a given day (default today). */
  @Get("report/daily")
  @RequirePermissions(permissions.attendanceRead)
  reportDaily(@Query("day") day?: string) {
    return this.attendance.reportDaily(day);
  }

  /** Monthly Attendance report — per-employee counts across the month (default current). */
  @Get("report/monthly")
  @RequirePermissions(permissions.attendanceRead)
  reportMonthly(@Query("month") month?: string) {
    return this.attendance.reportMonthly(month);
  }

  /** Department Attendance report — grouped by department for a given day. */
  @Get("report/department")
  @RequirePermissions(permissions.attendanceRead)
  reportDepartment(@Query("day") day?: string) {
    return this.attendance.reportDepartment(day);
  }
}
