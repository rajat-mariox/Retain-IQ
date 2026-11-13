import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ChangeRequestService } from "./change-request.service.js";

const CHAIN_ROLES = ["MANAGER", "NEW_MANAGER", "HR", "DEPARTMENT_HEAD", "FINANCE"] as const;

const proposedSchema = z
  .object({
    designationId: z.string().uuid().nullable().optional(),
    title: z.string().max(120).nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    teamId: z.string().uuid().nullable().optional(),
    managerId: z.string().uuid().nullable().optional(),
    location: z.string().max(120).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one proposed change." });

const createSchema = z.object({
  proposed: proposedSchema,
  reason: z.string().max(1000).optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const decisionSchema = z.object({ approve: z.boolean(), note: z.string().max(1000).optional() });
const chainSchema = z
  .object({ promotionChain: z.array(z.enum(CHAIN_ROLES)).max(6), transferChain: z.array(z.enum(CHAIN_ROLES)).max(6) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

/**
 * Promotion & transfer change requests plus their org-level approval-chain config.
 * Creating/deciding needs employee.write; the service additionally ABAC-scopes the
 * subject employee and enforces per-step approver assignment.
 */
@Controller("employees")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ChangeRequestController {
  constructor(
    private readonly changes: ChangeRequestService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(":employeeId/promotion")
  @RequirePermissions(permissions.employeeWrite)
  promote(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.changes.create(employeeId, "PROMOTION", body.proposed, { reason: body.reason, effectiveDate: body.effectiveDate });
  }

  @Post(":employeeId/transfer")
  @RequirePermissions(permissions.employeeWrite)
  transfer(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.changes.create(employeeId, "TRANSFER", body.proposed, { reason: body.reason, effectiveDate: body.effectiveDate });
  }

  @Get(":employeeId/change-requests")
  @RequirePermissions(permissions.employeeRead)
  listRequests(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.changes.listForEmployee(employeeId);
  }

  @Get(":employeeId/career")
  @RequirePermissions(permissions.employeeRead)
  career(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.changes.careerHistory(employeeId);
  }

  @Get("change-requests/mine")
  @RequirePermissions(permissions.employeeWrite)
  myApprovals() {
    return this.changes.myApprovals();
  }

  @Post("change-requests/:requestId/decision")
  @RequirePermissions(permissions.employeeWrite)
  decide(@Param("requestId", ParseUUIDPipe) requestId: string, @Body(new ZodValidationPipe(decisionSchema)) body: z.infer<typeof decisionSchema>) {
    return this.changes.decide(requestId, body.approve, body.note);
  }

  @Post("change-requests/:requestId/cancel")
  @RequirePermissions(permissions.employeeWrite)
  cancel(@Param("requestId", ParseUUIDPipe) requestId: string) {
    return this.changes.cancel(requestId);
  }

  // ---- org approval-chain settings ----
  @Get("workforce-settings")
  @RequirePermissions(permissions.employeeRead)
  async getSettings() {
    const ctx = requireTenantContext();
    const s = await this.prisma.workforceSetting.findUnique({ where: { orgId: ctx.orgId } });
    return s ?? { promotionChain: ["MANAGER", "HR", "FINANCE"], transferChain: ["MANAGER", "NEW_MANAGER", "HR"] };
  }

  @Patch("workforce-settings")
  @RequirePermissions(permissions.employeeWrite)
  async updateSettings(@Body(new ZodValidationPipe(chainSchema)) body: z.infer<typeof chainSchema>) {
    const ctx = requireTenantContext();
    return this.prisma.workforceSetting.upsert({
      where: { orgId: ctx.orgId },
      create: { orgId: ctx.orgId, ...body },
      update: body,
    });
  }
}
