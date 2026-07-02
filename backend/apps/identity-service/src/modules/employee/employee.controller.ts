import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { createEmployeeSchema, offsetPaginationQuerySchema, type CreateEmployeeInput } from "@retainiq/contracts";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { EmployeeService } from "./employee.service.js";

const listQuerySchema = offsetPaginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  lifecycleStage: z.enum(["ONBOARDING", "PROBATION", "CONFIRMED", "EXITED"]).optional(),
  departmentId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD", "EXITED", "SUSPENDED"]).optional(),
});

const updateEmployeeSchema = z
  .object({
    designationId: z.string().uuid().nullable(),
    departmentId: z.string().uuid().nullable(),
    teamId: z.string().uuid().nullable(),
    shiftId: z.string().uuid().nullable(),
    managerId: z.string().uuid().nullable(),
    title: z.string().max(120).nullable(),
    status: z.enum(["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD", "EXITED", "SUSPENDED"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

const transitionSchema = z
  .object({
    action: z.enum(["start_probation", "confirm", "exit"]),
    probationEndsAt: z.string().datetime().optional(),
    exitedAt: z.string().datetime().optional(),
  });

@Controller("employees")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Get()
  @RequirePermissions(permissions.employeeRead)
  listEmployees(@Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.employeeService.listEmployees(query);
  }

  /** Headcount per lifecycle stage — Onboarding / Probation / Confirmed / Exit. */
  @Get("lifecycle-summary")
  @RequirePermissions(permissions.employeeRead)
  lifecycleSummary() {
    return this.employeeService.lifecycleSummary();
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
  getEmployee(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.employeeService.getEmployee(employeeId);
  }

  /** Assign designation / department / team / manager / title / status. */
  @Patch(":employeeId")
  @RequirePermissions(permissions.employeeWrite)
  updateEmployee(
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) body: z.infer<typeof updateEmployeeSchema>,
  ) {
    return this.employeeService.updateEmployee(employeeId, body);
  }

  /** Lifecycle transition: start_probation → confirm → exit. */
  @Post(":employeeId/lifecycle")
  @RequirePermissions(permissions.employeeWrite)
  transition(
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(transitionSchema)) body: z.infer<typeof transitionSchema>,
  ) {
    return this.employeeService.transition(employeeId, body);
  }
}
