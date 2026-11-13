import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { offsetPaginationQuerySchema } from "@retainiq/contracts";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { RbacService } from "./rbac.service.js";

const createGrantSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  scopeType: z.enum(["ORG", "DEPARTMENT", "TEAM", "SELF"]),
  scopeId: z.string().uuid().nullable().optional(),
});

const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).nullable().optional(),
  permissions: z.array(z.string()).min(1),
});

const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  permissions: z.array(z.string()).min(1).optional(),
});

const accessQuerySchema = offsetPaginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
});

/**
 * Access control management: role catalog + per-user role grants. Guarded by
 * `settings.security.manage` (org admin / Owner) — granting roles is sensitive.
 */
@Controller("rbac")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get("roles")
  @RequirePermissions(permissions.securityManage)
  roles() {
    return this.rbac.listRoles();
  }

  /** The plain-language catalog of things a role can be allowed to do. */
  @Get("permissions")
  @RequirePermissions(permissions.securityManage)
  permissionCatalog() {
    return this.rbac.listPermissionCatalog();
  }

  @Post("roles")
  @RequirePermissions(permissions.securityManage)
  createRole(@Body(new ZodValidationPipe(createRoleSchema)) body: z.infer<typeof createRoleSchema>) {
    return this.rbac.createRole(body);
  }

  @Patch("roles/:id")
  @RequirePermissions(permissions.securityManage)
  updateRole(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: z.infer<typeof updateRoleSchema>,
  ) {
    return this.rbac.updateRole(id, body);
  }

  @Delete("roles/:id")
  @RequirePermissions(permissions.securityManage)
  deleteRole(@Param("id", ParseUUIDPipe) id: string) {
    return this.rbac.deleteRole(id);
  }

  @Get("access")
  @RequirePermissions(permissions.securityManage)
  access(@Query(new ZodValidationPipe(accessQuerySchema)) query: z.infer<typeof accessQuerySchema>) {
    return this.rbac.listAccess(query);
  }

  @Post("grants")
  @RequirePermissions(permissions.securityManage)
  createGrant(@Body(new ZodValidationPipe(createGrantSchema)) body: z.infer<typeof createGrantSchema>) {
    return this.rbac.createGrant(body);
  }

  @Delete("grants/:id")
  @RequirePermissions(permissions.securityManage)
  revokeGrant(@Param("id", ParseUUIDPipe) id: string) {
    return this.rbac.revokeGrant(id);
  }
}
