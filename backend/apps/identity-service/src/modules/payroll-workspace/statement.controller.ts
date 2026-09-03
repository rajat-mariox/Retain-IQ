import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { StatementService } from "./statement.service.js";

/**
 * Payout-statement endpoints (§18). Generation is admin-gated; employees read only
 * their own statements while admins with payroll.statement.employee.read read others
 * (scoped in the service).
 */
@Controller()
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PayrollStatementController {
  constructor(private readonly statements: StatementService) {}

  /** Generate payslips for every PAID record in a batch (auto-runs on payment too). */
  @Post("payroll/batches/:id/statements")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollStatementGenerate)
  generate(@Param("id", ParseUUIDPipe) id: string) {
    return this.statements.generateForBatch(id);
  }

  /** Publish (release) the batch's payslips to employees — notifies each employee. */
  @Post("payroll/batches/:id/statements/publish")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollStatementGenerate)
  publish(@Param("id", ParseUUIDPipe) id: string) {
    return this.statements.publishForBatch(id);
  }

  /** An employee's statements (admin view). */
  @Get("payroll/employees/:id/statements")
  @RequirePermissions(permissions.payrollStatementEmployeeRead)
  forEmployee(@Param("id", ParseUUIDPipe) id: string) {
    return this.statements.employeeStatements(id);
  }

  /** The caller's own statements. */
  @Get("me/payroll/statements")
  @RequirePermissions(permissions.payrollStatementOwnRead)
  mine() {
    return this.statements.myStatements();
  }
}
