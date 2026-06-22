import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import {
  createEmployeeSchema,
  cursorPaginationQuerySchema,
  type CreateEmployeeInput,
  type CursorPaginationQuery,
} from "@retainiq/contracts";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { EmployeeService } from "./employee.service.js";

@Controller("employees")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Get()
  @RequirePermissions(permissions.employeeRead)
  listEmployees(
    @Query(new ZodValidationPipe(cursorPaginationQuerySchema)) query: CursorPaginationQuery,
  ) {
    return this.employeeService.listEmployees(query);
  }

  @Post()
  @RequirePermissions(permissions.employeeWrite)
  createEmployee(
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployeeInput,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.employeeService.createEmployee(body, idempotencyKey?.trim() || undefined);
  }

  @Get(":employeeId")
  @RequirePermissions(permissions.employeeRead)
  getEmployee(@Param("employeeId") employeeId: string) {
    return this.employeeService.getEmployee(employeeId);
  }
}
