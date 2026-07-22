import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { offsetPaginationQuerySchema } from "@retainiq/contracts";
import { z } from "zod";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { StorageService } from "./storage.service.js";

const uploadSchema = z.object({
  employeeId: z.string().uuid().optional(),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
  sizeBytes: z.coerce.number().int().positive().max(50 * 1024 * 1024), // 50MB/screenshot ceiling
  capturedAt: z.coerce.date().optional(),
});
type UploadInput = z.infer<typeof uploadSchema>;

const listQuerySchema = offsetPaginationQuerySchema.extend({ employeeId: z.string().uuid().optional() });
type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * Tenant screenshot storage.
 * - Upload + usage: any authenticated member (the employee's agent uploads).
 * - List/view: Owner + Managers (HR / project managers) see all; employees see
 *   only their own (scoped in the service). Requires screenshots.read.
 * - Delete: Owner only (screenshots.delete).
 */
@Controller("storage")
@RequireFeature("screenshots")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get("usage")
  usage() {
    return this.storage.usage(requireTenantContext().orgId);
  }

  /** Reserve quota + get a presigned PUT URL; the client uploads the binary directly. */
  @Post("screenshots")
  createUpload(@Body(new ZodValidationPipe(uploadSchema)) body: UploadInput) {
    const ctx = requireTenantContext();
    return this.storage.createUpload({
      orgId: ctx.orgId,
      membershipId: ctx.membershipId,
      employeeId: body.employeeId,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      capturedAt: body.capturedAt ?? new Date(),
    });
  }

  /** Gallery folders: screenshots grouped by employee (RBAC-scoped). */
  @Get("screenshots/employees")
  @RequirePermissions(permissions.screenshotsRead)
  screenshotsByEmployee() {
    const ctx = requireTenantContext();
    return this.storage.screenshotsByEmployee({ orgId: ctx.orgId, userId: ctx.userId });
  }

  @Get("screenshots")
  @RequirePermissions(permissions.screenshotsRead)
  listScreenshots(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery) {
    const ctx = requireTenantContext();
    return this.storage.listScreenshots({
      orgId: ctx.orgId,
      userId: ctx.userId,
      employeeId: query.employeeId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Delete("screenshots/:id")
  @RequirePermissions(permissions.screenshotsDelete)
  deleteScreenshot(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.storage.deleteScreenshot(requireTenantContext().orgId, id);
  }

  /** Run the retention purge now for this org (auto-deletes screenshots past the configured window). */
  @Post("screenshots/purge")
  @RequirePermissions(permissions.screenshotsDelete)
  purge() {
    return this.storage.purgeRequestOrg();
  }
}
