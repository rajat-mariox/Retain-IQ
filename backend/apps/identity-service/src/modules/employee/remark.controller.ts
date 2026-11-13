import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { PublicRoute } from "../../common/decorators/public-route.decorator.js";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { RemarkService } from "./remark.service.js";

const VISIBILITY = ["MANAGER_ONLY", "HR_ONLY", "HR_AND_MANAGER", "EMPLOYEE_VISIBLE", "ADMIN_ONLY"] as const;

const createSchema = z.object({
  content: z.string().min(1).max(2000),
  visibility: z.enum(VISIBILITY).optional(),
  reason: z.string().max(120).optional(),
});

/**
 * Manager/HR remarks under the employee resource. Creating/deleting need
 * employee.write; listing is intentionally a public route (auth-only) because a
 * self-viewer with no employee.read still sees their own EMPLOYEE_VISIBLE remarks —
 * the service does the visibility filtering per the caller's relationship.
 */
@Controller("employees")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class RemarkController {
  constructor(private readonly remarks: RemarkService) {}

  @Get(":employeeId/remarks")
  @PublicRoute("visibility filtering is done in the service by the caller's relationship")
  list(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.remarks.listForEmployee(employeeId);
  }

  @Post(":employeeId/remarks")
  @RequirePermissions(permissions.employeeWrite)
  create(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.remarks.create(employeeId, body);
  }

  @Delete("remarks/:remarkId")
  @PublicRoute("author-or-admin check is enforced in the service")
  remove(@Param("remarkId", ParseUUIDPipe) remarkId: string) {
    return this.remarks.remove(remarkId);
  }
}
