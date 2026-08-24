import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { PublicRoute } from "../../common/decorators/public-route.decorator.js";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { TimeTrackingService } from "./timetracking.service.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const createEntrySchema = z.object({
  date,
  projectId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  minutes: z.coerce.number().int().min(1).max(24 * 60),
  billable: z.boolean().optional(),
  description: z.string().max(500).optional(),
});
const updateEntrySchema = z
  .object({
    date,
    projectId: z.string().uuid().nullable(),
    taskId: z.string().uuid().nullable(),
    minutes: z.coerce.number().int().min(1).max(24 * 60),
    billable: z.boolean(),
    description: z.string().max(500),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
const submitSchema = z.object({ week: date.optional() });
const decisionSchema = z.object({ approve: z.boolean(), note: z.string().max(500).optional() });
const billableSummarySchema = z.object({
  from: date.optional(),
  to: date.optional(),
  groupBy: z.enum(["employee", "team", "project", "client"]).optional(),
});

@Controller("time")
@RequireFeature("timeTracking")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class TimeTrackingController {
  constructor(private readonly time: TimeTrackingService) {}

  /** The caller's timesheet for a week (entries + status). */
  @Get("timesheet")
  @PublicRoute("the caller's own timesheet")
  timesheet(@Query("week") week?: string) {
    return this.time.getTimesheet(week);
  }

  @Post("entries")
  @PublicRoute("the caller logs their own time")
  createEntry(@Body(new ZodValidationPipe(createEntrySchema)) body: z.infer<typeof createEntrySchema>) {
    return this.time.createEntry(body);
  }

  @Patch("entries/:id")
  @PublicRoute("the caller edits their own entry (ownership enforced in-service)")
  updateEntry(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateEntrySchema)) body: z.infer<typeof updateEntrySchema>) {
    return this.time.updateEntry(id, body);
  }

  @Delete("entries/:id")
  @PublicRoute("the caller deletes their own entry (ownership enforced in-service)")
  deleteEntry(@Param("id", ParseUUIDPipe) id: string) {
    return this.time.deleteEntry(id);
  }

  /** Submit the week's timesheet for approval. */
  @Post("timesheet/submit")
  @PublicRoute("the caller submits their own timesheet")
  submit(@Body(new ZodValidationPipe(submitSchema)) body: z.infer<typeof submitSchema>) {
    return this.time.submit(body.week);
  }

  /** The caller's own timesheet history (all weeks, by status). */
  @Get("timesheets/mine")
  @PublicRoute("the caller's own timesheet history")
  mine() {
    return this.time.mine();
  }

  /**
   * Billable vs non-billable rollup by employee / team / project / client —
   * managers/admins. Defaults to the last 30 days grouped by project.
   */
  @Get("billable-summary")
  @RequirePermissions(permissions.attendanceRead)
  billableSummary(@Query(new ZodValidationPipe(billableSummarySchema)) query: z.infer<typeof billableSummarySchema>) {
    return this.time.billableSummary(query);
  }

  /** Submitted timesheets awaiting decision — managers/admins. */
  @Get("timesheets/pending")
  @RequirePermissions(permissions.attendanceApprove)
  pending() {
    return this.time.pending();
  }

  /** Full detail of a submitted timesheet for review — managers/admins. */
  @Get("timesheets/:id")
  @RequirePermissions(permissions.attendanceApprove)
  review(@Param("id", ParseUUIDPipe) id: string) {
    return this.time.review(id);
  }

  @Post("timesheets/:id/decision")
  @RequirePermissions(permissions.attendanceApprove)
  decide(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(decisionSchema)) body: z.infer<typeof decisionSchema>) {
    return this.time.decide(id, body.approve, body.note);
  }

  /**
   * Generate AUTO time entries from tracked activity for this org now (defaults to
   * yesterday) — the admin "sync tracked time" action, instead of waiting for the
   * nightly sweep. Managers/admins only.
   */
  @Post("auto-sync")
  @RequirePermissions(permissions.attendanceApprove)
  autoSync(@Body(new ZodValidationPipe(z.object({ day: date.optional() }))) body: { day?: string }) {
    return this.time.syncAutoEntriesForOrg(body.day);
  }
}
