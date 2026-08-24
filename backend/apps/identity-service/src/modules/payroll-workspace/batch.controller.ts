import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PayrollBatchService } from "./batch.service.js";

const createBatchSchema = z.object({
  periodId: z.string().uuid(),
  name: z.string().min(1).max(200),
  currencyCode: z.string().length(3).optional(),
  countryCode: z.string().min(2).max(2).optional().nullable(),
  legalEntityId: z.string().uuid().optional().nullable(),
  payrollEntityId: z.string().uuid().optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
});
const addEmployeesSchema = z.object({ employeeIds: z.array(z.string().uuid()).min(1).max(1000) });
const removeEmployeeSchema = z.object({ employeeId: z.string().uuid(), reason: z.string().min(3).max(500) });
const approveSchema = z.object({ comment: z.string().max(500).optional() });
const rejectSchema = z.object({ reason: z.string().min(3).max(500) });

/**
 * Payroll batch lifecycle API (§9). Every route is authenticated, tenant-guarded
 * and permission-gated; the service enforces tenant isolation and separation of
 * duties (a creator cannot approve their own batch).
 */
@Controller("payroll/batches")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PayrollBatchController {
  constructor(private readonly batches: PayrollBatchService) {}

  @Get()
  @RequirePermissions(permissions.payrollBatchRead)
  list(@Query("status") status?: string, @Query("periodId") periodId?: string) {
    return this.batches.list({ status, periodId });
  }

  @Post()
  @RequirePermissions(permissions.payrollBatchCreate)
  create(@Body(new ZodValidationPipe(createBatchSchema)) body: z.infer<typeof createBatchSchema>) {
    return this.batches.create(body);
  }

  @Get(":id")
  @RequirePermissions(permissions.payrollBatchRead)
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.batches.get(id);
  }

  @Get(":id/records")
  @RequirePermissions(permissions.payrollRecordRead)
  records(@Param("id", ParseUUIDPipe) id: string) {
    return this.batches.getRecords(id);
  }

  @Post(":id/employees")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollBatchCreate)
  addEmployees(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(addEmployeesSchema)) body: z.infer<typeof addEmployeesSchema>) {
    return this.batches.addEmployees(id, body.employeeIds);
  }

  @Post(":id/remove-employee")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollBatchCreate)
  removeEmployee(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(removeEmployeeSchema)) body: z.infer<typeof removeEmployeeSchema>) {
    return this.batches.removeEmployee(id, body.employeeId, body.reason);
  }

  @Post(":id/freeze")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollBatchCalculate)
  freeze(@Param("id", ParseUUIDPipe) id: string) {
    return this.batches.freeze(id);
  }

  @Post(":id/calculate")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollBatchCalculate)
  calculate(@Param("id", ParseUUIDPipe) id: string) {
    return this.batches.calculate(id);
  }

  @Post(":id/validate")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollBatchValidate)
  validate(@Param("id", ParseUUIDPipe) id: string) {
    return this.batches.validate(id);
  }

  // submit / approve / reject / hold / release are owned by PayrollApprovalController
  // (the maker-checker approval workflow). This controller keeps the pre-approval
  // lifecycle (create → freeze → calculate → validate) and close.

  @Post(":id/close")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollBatchClose)
  close(@Param("id", ParseUUIDPipe) id: string) {
    return this.batches.close(id);
  }
}
