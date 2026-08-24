import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ObservationService } from "./observation.service.js";
import { ObservationEvidenceService } from "./observation-evidence.service.js";

const createSchema = z.object({
  employeeId: z.string().uuid(),
  type: z.enum(["PRODUCTIVITY_DROP", "BURNOUT_RISK", "LOW_ENGAGEMENT", "ATTENDANCE_ANOMALY", "LATE_PATTERN", "BEHAVIOUR", "OTHER"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  title: z.string().min(3).max(160),
  detail: z.string().max(2000).optional(),
});
const noteSchema = z.object({ note: z.string().max(1000).optional() });
const resolveSchema = z.object({ note: z.string().min(1).max(1000) });
const commentSchema = z.object({ body: z.string().min(1).max(2000) });
const evidenceSchema = z.object({ fileName: z.string().min(1).max(200), contentType: z.string().min(1).max(160), sizeBytes: z.coerce.number().int().positive() });

/**
 * Observation Management — a standalone module (separate from Incident). Managers
 * see and act on observations within their reach; the Owner sees the whole org's.
 */
@Controller("observations")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ObservationController {
  constructor(
    private readonly observations: ObservationService,
    private readonly evidence: ObservationEvidenceService,
  ) {}

  @Get()
  @RequirePermissions(permissions.observationRead)
  list(
    @Query("status") status?: string,
    @Query("severity") severity?: string,
    @Query("employeeId") employeeId?: string,
    @Query("mine") mine?: string,
  ) {
    return this.observations.list({ status, severity, employeeId, mine: mine === "1" || mine === "true" });
  }

  @Get(":id")
  @RequirePermissions(permissions.observationRead)
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.observations.get(id);
  }

  @Post()
  @RequirePermissions(permissions.observationManage)
  create(@Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.observations.createManual(body);
  }

  @Post(":id/acknowledge")
  @RequirePermissions(permissions.observationManage)
  acknowledge(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>) {
    return this.observations.acknowledge(id, body.note);
  }

  @Post(":id/resolve")
  @RequirePermissions(permissions.observationManage)
  resolve(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(resolveSchema)) body: z.infer<typeof resolveSchema>) {
    return this.observations.resolve(id, body.note);
  }

  @Post(":id/dismiss")
  @RequirePermissions(permissions.observationManage)
  dismiss(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(resolveSchema)) body: z.infer<typeof resolveSchema>) {
    return this.observations.dismiss(id, body.note);
  }

  @Post(":id/comments")
  @RequirePermissions(permissions.observationManage)
  comment(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(commentSchema)) body: z.infer<typeof commentSchema>) {
    return this.observations.comment(id, body.body);
  }

  // ---- Evidence ----

  @Get(":id/evidence")
  @RequirePermissions(permissions.observationRead)
  listEvidence(@Param("id", ParseUUIDPipe) id: string) {
    return this.evidence.list(id);
  }

  @Post(":id/evidence")
  @RequirePermissions(permissions.observationManage)
  createEvidence(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(evidenceSchema)) body: z.infer<typeof evidenceSchema>) {
    return this.evidence.createUpload(id, body);
  }

  @Post(":id/evidence/:eid/delete")
  @RequirePermissions(permissions.observationManage)
  deleteEvidence(@Param("id", ParseUUIDPipe) id: string, @Param("eid", ParseUUIDPipe) eid: string) {
    return this.evidence.delete(id, eid);
  }
}
