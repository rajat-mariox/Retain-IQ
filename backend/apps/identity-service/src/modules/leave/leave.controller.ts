import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { toCsv, toXlsx, exportMeta } from "../../common/reports/report-export.js";
import { PublicRoute } from "../../common/decorators/public-route.decorator.js";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { LeaveService } from "./leave.service.js";
import { LeaveAttachmentService } from "./leave-attachment.service.js";
import { CompOffService } from "./comp-off.service.js";

const createTypeSchema = z.object({
  name: z.string().min(1).max(60),
  code: z.string().min(1).max(10),
  annualQuota: z.coerce.number().int().min(0).max(365).optional(),
  paid: z.boolean().optional(),
  color: z.string().max(9).nullable().optional(),
});
const updateTypeSchema = z
  .object({ name: z.string().min(1).max(60), annualQuota: z.coerce.number().int().min(0).max(365), paid: z.boolean(), color: z.string().max(9).nullable(), status: z.enum(["ACTIVE", "ARCHIVED"]) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
const createRequestSchema = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // A half-day only makes sense for a single date; the service enforces start==end.
  dayPart: z.enum(["FULL", "FIRST_HALF", "SECOND_HALF"]).default("FULL"),
  reason: z.string().max(500).optional(),
});
const decisionSchema = z.object({ approve: z.boolean(), note: z.string().max(500).optional() });
const compOffGrantSchema = z.object({
  employeeId: z.string().uuid(),
  days: z.coerce.number().min(-365).max(365),
  note: z.string().max(300).optional(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
const attachmentUploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.coerce.number().int().min(1),
});

@Controller("leave")
@RequireFeature("leave")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly attachments: LeaveAttachmentService,
    private readonly compOff: CompOffService,
  ) {}

  /** The caller's comp-off balance + ledger (or a report's, within reach via ?employeeId). */
  @Get("comp-off/balance")
  @PublicRoute("the caller's own comp-off balance")
  compOffBalance(@Query("employeeId") employeeId?: string) {
    return this.compOff.myBalance(employeeId);
  }

  /** Manually grant (or debit) comp-off for someone the caller can approve. */
  @Post("comp-off/grant")
  @RequirePermissions(permissions.attendanceApprove)
  grantCompOff(@Body(new ZodValidationPipe(compOffGrantSchema)) body: z.infer<typeof compOffGrantSchema>) {
    return this.compOff.grant(body);
  }

  @Get("types")
  @PublicRoute("the org leave-type catalog every requester needs")
  listTypes() {
    return this.leave.listTypes();
  }

  @Post("types")
  @RequirePermissions(permissions.attendanceApprove)
  createType(@Body(new ZodValidationPipe(createTypeSchema)) body: z.infer<typeof createTypeSchema>) {
    return this.leave.createType(body);
  }

  @Patch("types/:id")
  @RequirePermissions(permissions.attendanceApprove)
  updateType(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateTypeSchema)) body: z.infer<typeof updateTypeSchema>) {
    return this.leave.updateType(id, body);
  }

  /** The caller's own leave balances. */
  @Get("me/balances")
  @PublicRoute("the caller's own leave balances")
  myBalances(@Query("year") year?: string) {
    return this.leave.balances(undefined, year ? Number(year) : undefined);
  }

  /** Any employee's balances — managers/admins. */
  @Get("balances")
  @RequirePermissions(permissions.attendanceRead)
  balances(@Query("employeeId") employeeId?: string, @Query("year") year?: string) {
    return this.leave.balances(employeeId, year ? Number(year) : undefined);
  }

  /** The caller's leave calendar for a month (week-offs from their shift + holidays + leaves). */
  @Get("calendar")
  @PublicRoute("the caller's own leave calendar")
  calendar(@Query("month") month?: string) {
    return this.leave.calendar(month);
  }

  /** Org-wide leave calendar for a month (all employees) — managers/admins. */
  @Get("org-calendar")
  @RequirePermissions(permissions.attendanceRead)
  orgCalendar(@Query("month") month?: string) {
    return this.leave.orgCalendar(month);
  }

  /** Approval-center analytics (pending queue, who's out, leave mix) — managers/admins. */
  @Get("analytics")
  @RequirePermissions(permissions.attendanceRead)
  analytics() {
    return this.leave.analytics();
  }

  /** Export leave requests (org-wide) as CSV (default) or Excel. Managers/admins. */
  @Get("export")
  @RequirePermissions(permissions.attendanceRead)
  async export(@Res({ passthrough: true }) res: FastifyReply, @Query("format") format?: string) {
    const table = await this.leave.exportRequests("all");
    const fmt = format === "xlsx" ? "xlsx" : "csv";
    const meta = exportMeta(table.baseName, fmt);
    const buf = fmt === "xlsx" ? toXlsx("Leave", table) : String.fromCharCode(0xfeff) + toCsv(table);
    await res.header("Content-Type", meta.contentType).header("Content-Disposition", `attachment; filename="${meta.filename}"`).send(buf);
  }

  /** The caller's own leave requests. */
  @Get("requests")
  @PublicRoute("the caller's own leave requests")
  myRequests(@Query("status") status?: string) {
    return this.leave.listRequests({ scope: "mine", status });
  }

  /** Org-wide leave requests (approval center) — managers/admins. */
  @Get("requests/all")
  @RequirePermissions(permissions.attendanceRead)
  allRequests(@Query("status") status?: string, @Query("employeeId") employeeId?: string) {
    return this.leave.listRequests({ scope: "all", status, employeeId });
  }

  @Post("requests")
  @PublicRoute("a person files their own leave request")
  createRequest(@Body(new ZodValidationPipe(createRequestSchema)) body: z.infer<typeof createRequestSchema>) {
    return this.leave.createRequest(body);
  }

  @Post("requests/:id/decision")
  @RequirePermissions(permissions.attendanceApprove)
  decide(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(decisionSchema)) body: z.infer<typeof decisionSchema>) {
    return this.leave.decide(id, body.approve, body.note);
  }

  @Post("requests/:id/cancel")
  @PublicRoute("a person cancels their own leave request")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.leave.cancel(id);
  }

  // ---- Supporting documents on a leave request (medical certificate, etc.) ----
  // The service checks access (own request, or an approver's reach), so these are
  // public routes that resolve the caller from the token.

  /** Reserve an attachment + get a presigned PUT URL; the client uploads the binary. */
  @Post("requests/:id/attachments")
  @PublicRoute("attach a supporting document to a leave request")
  createAttachment(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(attachmentUploadSchema)) body: z.infer<typeof attachmentUploadSchema>) {
    return this.attachments.createUpload(id, body);
  }

  /** A request's attachments with short-lived view URLs. */
  @Get("requests/:id/attachments")
  @PublicRoute("view a leave request's supporting documents")
  listAttachments(@Param("id", ParseUUIDPipe) id: string) {
    return this.attachments.list(id);
  }

  @Post("requests/:id/attachments/:attId/delete")
  @PublicRoute("remove a supporting document from a leave request")
  deleteAttachment(@Param("id", ParseUUIDPipe) id: string, @Param("attId", ParseUUIDPipe) attId: string) {
    return this.attachments.delete(id, attId);
  }
}
