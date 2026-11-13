import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { IncidentService } from "./incident.service.js";
import { IncidentEvidenceService } from "./incident-evidence.service.js";

const CATEGORY = ["ATTENDANCE", "PRODUCTIVITY", "BEHAVIOUR", "SECURITY", "COMPLIANCE"] as const;
const SEVERITY = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

const openSchema = z.object({
  employeeId: z.string().uuid().optional().nullable(),
  category: z.enum(CATEGORY),
  severity: z.enum(SEVERITY),
  title: z.string().min(3).max(160),
  summary: z.string().max(4000).optional(),
});
const promoteSchema = z.object({ category: z.enum(CATEGORY), summary: z.string().max(4000).optional() });
const noteSchema = z.object({ note: z.string().max(2000).optional() });
const resolveSchema = z.object({ note: z.string().min(1).max(2000) });
const commentSchema = z.object({ body: z.string().min(1).max(2000) });
const evidenceSchema = z.object({ fileName: z.string().min(1).max(200), contentType: z.string().min(1).max(160), sizeBytes: z.coerce.number().int().positive() });

/** Incident Management — a standalone module, gated by incident.manage (HR/Owner). */
@Controller("incidents")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class IncidentController {
  constructor(
    private readonly incidents: IncidentService,
    private readonly evidence: IncidentEvidenceService,
  ) {}

  @Get()
  @RequirePermissions(permissions.incidentManage)
  list(@Query("status") status?: string, @Query("category") category?: string, @Query("mine") mine?: string) {
    return this.incidents.list({ status, category, mine: mine === "1" || mine === "true" });
  }

  @Get(":id")
  @RequirePermissions(permissions.incidentManage)
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.incidents.get(id);
  }

  @Post()
  @RequirePermissions(permissions.incidentManage)
  open(@Body(new ZodValidationPipe(openSchema)) body: z.infer<typeof openSchema>) {
    return this.incidents.openManual(body);
  }

  @Post(":id/investigate")
  @RequirePermissions(permissions.incidentManage)
  investigate(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>) {
    return this.incidents.startInvestigation(id, body.note);
  }

  @Post(":id/resolve")
  @RequirePermissions(permissions.incidentManage)
  resolve(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(resolveSchema)) body: z.infer<typeof resolveSchema>) {
    return this.incidents.resolve(id, body.note);
  }

  @Post(":id/close")
  @RequirePermissions(permissions.incidentManage)
  close(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>) {
    return this.incidents.close(id, body.note);
  }

  @Post(":id/comments")
  @RequirePermissions(permissions.incidentManage)
  comment(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(commentSchema)) body: z.infer<typeof commentSchema>) {
    return this.incidents.comment(id, body.body);
  }

  @Get(":id/evidence")
  @RequirePermissions(permissions.incidentManage)
  listEvidence(@Param("id", ParseUUIDPipe) id: string) {
    return this.evidence.list(id);
  }

  @Post(":id/evidence")
  @RequirePermissions(permissions.incidentManage)
  createEvidence(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(evidenceSchema)) body: z.infer<typeof evidenceSchema>) {
    return this.evidence.createUpload(id, body);
  }

  @Post(":id/evidence/:eid/delete")
  @RequirePermissions(permissions.incidentManage)
  deleteEvidence(@Param("id", ParseUUIDPipe) id: string, @Param("eid", ParseUUIDPipe) eid: string) {
    return this.evidence.delete(id, eid);
  }
}

/** Promote an escalation into an incident — lives on the escalations resource. */
@Controller("escalations")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class EscalationPromoteController {
  constructor(private readonly incidents: IncidentService) {}

  @Post(":id/promote")
  @RequirePermissions(permissions.incidentManage)
  promote(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(promoteSchema)) body: z.infer<typeof promoteSchema>) {
    return this.incidents.openFromEscalation(id, body.category, body.summary);
  }
}
