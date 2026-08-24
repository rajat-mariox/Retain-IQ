import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { toXlsx, exportMeta } from "../../common/reports/report-export.js";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { PublicRoute } from "../../common/decorators/public-route.decorator.js";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { AttendanceCorrectionService } from "./attendance-correction.service.js";
import { AttendanceInsightsService } from "./attendance-insights.service.js";
import { ReportScheduleService } from "./report-schedule.service.js";
import { AttendancePolicyService } from "./attendance-policy.service.js";
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
const bulkDecisionSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  approve: z.boolean(),
  note: z.string().max(500).optional(),
});
const reportScheduleSchema = z.object({
  scope: z.enum(["org", "department", "team", "employee"]),
  scopeId: z.string().uuid().optional().nullable(),
  period: z.enum(["today", "week", "month"]),
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  recipients: z.array(z.string().uuid()).max(50).optional(),
});
/** `minutes` omitted = approve everything measured; never more than measured. */
const overtimeSchema = z.object({ minutes: z.coerce.number().int().min(0).max(1440).optional(), note: z.string().max(500).optional() });

/** Org attendance rules — editable by the org itself (attendance.manage). */
const policySchema = z
  .object({
    allowMultipleSessions: z.boolean(),
    allowReEntry: z.boolean(),
    maxSessionsPerDay: z.coerce.number().int().min(1).max(20),
    maxBreaksPerDay: z.coerce.number().int().min(0).max(50),
    maxBreakMinutesPerDay: z.coerce.number().int().min(0).max(1440),
    maxSingleBreakMinutes: z.coerce.number().int().min(0).max(1440),
    paidBreakMinutesPerDay: z.coerce.number().int().min(0).max(1440),
    allowCheckOutOnBreak: z.boolean(),
    minMinutesBeforeBreak: z.coerce.number().int().min(0).max(480),
    minMinutesBeforeCheckOut: z.coerce.number().int().min(0).max(480),
    graceMinutes: z.coerce.number().int().min(0).max(240),
    autoCheckOutAtShiftEnd: z.boolean(),
    autoCheckOutAfterMinutes: z.coerce.number().int().min(0).max(1440),
    idleCheckoutMinutes: z.coerce.number().int().min(0).max(480),
    idleCheckoutWarnMinutes: z.coerce.number().int().min(1).max(60),
    overtimeAfterMinutes: z.coerce.number().int().min(0).max(1440),
    minHoursForPresent: z.coerce.number().int().min(0).max(1440),
    workModel: z.enum(["WFO", "WFH", "HYBRID"]),
    allowedLocations: z.array(z.enum(["OFFICE", "HOME", "CLIENT_SITE", "REMOTE"])).min(1),
    requireLocation: z.boolean(),
    allowManualCorrection: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." })
  // The warning window must be shorter than the checkout threshold — otherwise the
  // desktop agent would show the countdown the instant someone goes idle. Only
  // enforced when idle-checkout is on (idleCheckoutMinutes > 0) and both are set.
  .refine(
    (v) => v.idleCheckoutMinutes === undefined || v.idleCheckoutWarnMinutes === undefined || v.idleCheckoutMinutes <= 0 || v.idleCheckoutWarnMinutes < v.idleCheckoutMinutes,
    { message: "The idle warning time must be less than the auto-checkout time.", path: ["idleCheckoutWarnMinutes"] },
  );

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
    private readonly policy: AttendancePolicyService,
    private readonly insights: AttendanceInsightsService,
    private readonly schedules: ReportScheduleService,
  ) {}

  /**
   * The org's own attendance rules. Read requires attendance.read (any admin who
   * can see the dashboard); editing requires attendance.manage (Owner by default,
   * plus HR managers / roles it's been granted to) — so a tenant runs its own
   * grace period, auto-checkout buffer, breaks, overtime, work model, etc.
   */
  @Get("policy")
  @RequirePermissions(permissions.attendanceRead)
  getPolicy() {
    return this.policy.getForEditing(requireTenantContext().orgId);
  }

  @Patch("policy")
  @RequirePermissions(permissions.attendanceManage)
  updatePolicy(@Body(new ZodValidationPipe(policySchema)) body: z.infer<typeof policySchema>) {
    return this.policy.update(requireTenantContext().orgId, body);
  }

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

  /** Approve or reject several correction requests at once; partial failures are reported, not fatal. */
  @Post("corrections/bulk-decision")
  @HttpCode(200)
  @RequirePermissions(permissions.attendanceApprove)
  bulkDecideCorrections(@Body(new ZodValidationPipe(bulkDecisionSchema)) body: z.infer<typeof bulkDecisionSchema>) {
    return this.corrections.decideMany(body.ids, body.approve, body.note);
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

  /** Month calendar — per-employee, per-day status grid (team availability view). */
  @Get("calendar")
  @RequirePermissions(permissions.attendanceRead)
  monthlyCalendar(@Query("month") month?: string) {
    return this.attendance.monthlyCalendar(month);
  }

  /** Overtime trends — approved OT per employee + per month across a window. */
  @Get("overtime/trends")
  @RequirePermissions(permissions.attendanceRead)
  overtimeTrends(@Query("months") months?: string) {
    const n = months ? Number(months) : undefined;
    return this.attendance.overtimeTrends(Number.isFinite(n) ? n : undefined);
  }

  /** Attendance intelligence — per-employee attendance/punctuality/consistency/risk scores. */
  @Get("scores")
  @RequirePermissions(permissions.attendanceRead)
  attendanceScores(@Query("months") months?: string) {
    const n = months ? Number(months) : undefined;
    return this.insights.attendanceScores(Number.isFinite(n) ? n : undefined);
  }

  /** Scope options for the configurable report — only what the caller can reach. */
  @Get("report/scope-options")
  @RequirePermissions(permissions.attendanceRead)
  reportScopeOptions() {
    return this.attendance.reportScopeOptions();
  }

  /**
   * Configurable attendance report — pick a scope (org/department/team/employee)
   * and a period (today/week/month). `format=csv` returns { filename, body } for
   * a client download; otherwise the JSON view. Always clamped to the caller's reach.
   */
  @Get("report")
  @RequirePermissions(permissions.attendanceRead)
  async report(
    @Res({ passthrough: true }) res: FastifyReply,
    @Query("scope") scope?: string,
    @Query("scopeId") scopeId?: string,
    @Query("period") period?: string,
    @Query("format") format?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("columns") columns?: string,
  ) {
    const report = await this.attendance.buildReport({ scope, scopeId: scopeId || null, period, from, to });
    // Optional column selection (comma-separated keys) for the export.
    const columnKeys = columns ? columns.split(",").map((c) => c.trim()).filter(Boolean) : undefined;
    if (format === "xlsx") {
      // Native Excel workbook, streamed as a download.
      const table = this.attendance.reportTable(report, columnKeys);
      const meta = exportMeta(table.baseName, "xlsx");
      const buf = toXlsx("Attendance", table);
      await res.header("Content-Type", meta.contentType).header("Content-Disposition", `attachment; filename="${meta.filename}"`).send(buf);
      return;
    }
    // CSV stays a { filename, body } JSON payload the client turns into a blob.
    if (format === "csv") {
      const t = this.attendance.reportTable(report, columnKeys);
      const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      return { filename: `${t.baseName}.csv`, body: [t.columns.map(esc).join(","), ...t.rows.map((r) => r.map(esc).join(","))].join("\r\n") };
    }
    return report;
  }

  /** List the org's saved recurring report schedules. */
  @Get("report/schedules")
  @RequirePermissions(permissions.attendanceRead)
  listSchedules() {
    return this.schedules.list();
  }

  /** Create a recurring report schedule (scope + period + frequency + recipients). */
  @Post("report/schedules")
  @RequirePermissions(permissions.attendanceRead)
  createSchedule(@Body(new ZodValidationPipe(reportScheduleSchema)) body: z.infer<typeof reportScheduleSchema>) {
    return this.schedules.create(body);
  }

  /** Send a saved schedule's report right now (to its recipients). */
  @Post("report/schedules/:id/run")
  @RequirePermissions(permissions.attendanceRead)
  async runSchedule(@Param("id", ParseUUIDPipe) id: string) {
    const sent = await this.schedules.runOne(id);
    return { sent };
  }

  /** Delete a saved report schedule. */
  @Post("report/schedules/:id/delete")
  @RequirePermissions(permissions.attendanceRead)
  deleteSchedule(@Param("id", ParseUUIDPipe) id: string) {
    return this.schedules.remove(id);
  }
}
