import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { EscalationService } from "./escalation.service.js";

const reasonSchema = z.object({ reason: z.string().max(1000).optional() });
const noteSchema = z.object({ note: z.string().max(1000).optional() });
const resolveSchema = z.object({ note: z.string().min(1).max(1000) });

/** Escalation flow — a standalone module. Managers/HR act on escalations in reach. */
@Controller("escalations")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class EscalationController {
  constructor(private readonly escalations: EscalationService) {}

  @Get()
  @RequirePermissions(permissions.observationRead)
  list(@Query("status") status?: string, @Query("mine") mine?: string, @Query("employeeId") employeeId?: string) {
    return this.escalations.list({ status, mine: mine === "1" || mine === "true", employeeId });
  }

  /** Open observation + escalation counts grouped by department and team. */
  @Get("rollup")
  @RequirePermissions(permissions.observationRead)
  rollup() {
    return this.escalations.rollupByGroup();
  }

  @Get(":id")
  @RequirePermissions(permissions.observationRead)
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.escalations.get(id);
  }

  @Post(":id/acknowledge")
  @RequirePermissions(permissions.observationManage)
  acknowledge(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>) {
    return this.escalations.acknowledge(id, body.note);
  }

  @Post(":id/bump")
  @RequirePermissions(permissions.observationManage)
  bump(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>) {
    return this.escalations.bump(id, body.note);
  }

  @Post(":id/resolve")
  @RequirePermissions(permissions.observationManage)
  resolve(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(resolveSchema)) body: z.infer<typeof resolveSchema>) {
    return this.escalations.resolve(id, body.note);
  }
}

/** The "escalate this observation" action lives on the observations resource. */
@Controller("observations")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ObservationEscalateController {
  constructor(private readonly escalations: EscalationService) {}

  @Post(":id/escalate")
  @RequirePermissions(permissions.observationManage)
  escalate(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return this.escalations.escalate(id, body.reason);
  }
}
