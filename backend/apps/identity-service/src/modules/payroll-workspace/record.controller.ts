import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { PayrollBatchService } from "./batch.service.js";

/**
 * Read a single payroll record with its explainable component breakdown (§8/§26).
 * Tenant-guarded and permission-gated; the service additionally scopes the read to
 * the caller's employee reach (a manager sees only their people; an employee sees
 * their own record).
 */
@Controller("payroll/records")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PayrollRecordController {
  constructor(private readonly batches: PayrollBatchService) {}

  @Get(":id")
  @RequirePermissions(permissions.payrollRecordRead)
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.batches.getRecord(id);
  }
}
