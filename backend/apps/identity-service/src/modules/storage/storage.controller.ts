import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { offsetPaginationQuerySchema } from "@retainiq/contracts";
import { z } from "zod";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PublicRoute } from "../../common/decorators/public-route.decorator.js";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { StorageService } from "./storage.service.js";

// Server-side masked upload: the agent sends the raw image (base64) and the
// backend masks its PII before storing, so raw captures never reach storage.
// (There is deliberately NO presign-and-PUT-direct path any more — that would
// let a raw, unmasked capture reach object storage.)
const maskedUploadSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
  data: z.string().min(1).max(24 * 1024 * 1024), // base64 of the raw screenshot
  capturedAt: z.coerce.date().optional(),
});
type MaskedUploadInput = z.infer<typeof maskedUploadSchema>;

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
  @PublicRoute("org storage usage aggregate, no personal data")
  usage() {
    return this.storage.usage(requireTenantContext().orgId);
  }

  /**
   * Masked upload: the agent posts the raw screenshot (base64) and the backend
   * masks its PII, then stores ONLY the masked image. Raw bytes are processed in
   * memory and never persisted. If masking is unavailable the request fails and
   * nothing is stored (fail closed).
   */
  @Post("screenshots/upload")
  @PublicRoute("the agent uploads its own screenshot for server-side masking + storage")
  uploadMasked(@Body(new ZodValidationPipe(maskedUploadSchema)) body: MaskedUploadInput) {
    const ctx = requireTenantContext();
    return this.storage.storeMaskedScreenshot({
      orgId: ctx.orgId,
      membershipId: ctx.membershipId,
      contentType: body.contentType,
      capturedAt: body.capturedAt ?? new Date(),
      data: Buffer.from(body.data, "base64"),
    });
  }

  /**
   * The caller's OWN screenshots (employee self-view). No screenshots.read
   * needed — that permission is the manager/admin gallery. Always hard-scoped to
   * the caller, so an employee sees only their own captures, never anyone else's.
   */
  @Get("screenshots/mine")
  @PublicRoute("a person's own screenshots, hard-scoped to the caller")
  myScreenshots(@Query(new ZodValidationPipe(offsetPaginationQuerySchema)) query: z.infer<typeof offsetPaginationQuerySchema>) {
    const ctx = requireTenantContext();
    return this.storage.listOwnScreenshots({ orgId: ctx.orgId, membershipId: ctx.membershipId, page: query.page, pageSize: query.pageSize });
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
