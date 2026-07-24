import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { createEmployeeSchema, offsetPaginationQuerySchema, type CreateEmployeeInput } from "@retainiq/contracts";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { EmployeeService } from "./employee.service.js";
import { EmployeeDocumentsService } from "./employee-documents.service.js";

const listQuerySchema = offsetPaginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  lifecycleStage: z.enum(["ONBOARDING", "PROBATION", "CONFIRMED", "EXITED"]).optional(),
  departmentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD", "EXITED", "SUSPENDED"]).optional(),
});

const updateEmployeeSchema = z
  .object({
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    email: z.string().email().nullable(), // work email (sign-in)
    personalEmail: z.string().email().nullable(),
    employeeCode: z.string().max(64).nullable(),
    designationId: z.string().uuid().nullable(),
    departmentId: z.string().uuid().nullable(),
    teamId: z.string().uuid().nullable(),
    shiftId: z.string().uuid().nullable(),
    managerId: z.string().uuid().nullable(),
    title: z.string().max(120).nullable(),
    status: z.enum(["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD", "EXITED", "SUSPENDED"]),
    joinedAt: z.string().datetime().nullable(),
    phone: z.string().max(40).nullable(),
    dateOfBirth: z.string().datetime().nullable(),
    gender: z.string().max(20).nullable(),
    location: z.string().max(120).nullable(),
    employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]).nullable(),
    address: z.string().max(500).nullable(),
    emergencyContactName: z.string().max(120).nullable(),
    emergencyContactPhone: z.string().max(40).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

const transitionSchema = z.object({
  action: z.enum(["start_probation", "confirm", "exit"]),
  probationEndsAt: z.string().datetime().optional(),
  exitedAt: z.string().datetime().optional(),
});

const eventSchema = z.object({
  type: z.enum(["NOTE", "PROMOTION", "TRANSFER", "TITLE_CHANGE", "STATUS_CHANGE", "LIFECYCLE", "AWARD"]).optional(),
  title: z.string().min(1).max(200),
  detail: z.string().max(1000).optional(),
  effectiveDate: z.string().datetime().optional(),
});

const documentUploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  category: z.enum(["OFFER_LETTER", "CONTRACT", "ID_PROOF", "COMPLIANCE", "OTHER"]).default("OTHER"),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.coerce.number().int().positive().max(50 * 1024 * 1024),
});

@Controller("employees")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class EmployeeController {
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly documents: EmployeeDocumentsService,
  ) {}

  @Get()
  @RequirePermissions(permissions.employeeRead)
  listEmployees(@Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.employeeService.listEmployees(query);
  }

  @Get("lifecycle-summary")
  @RequirePermissions(permissions.employeeRead)
  lifecycleSummary() {
    return this.employeeService.lifecycleSummary();
  }

  /** Reporting tree (org chart) from managerId. */
  @Get("org-chart")
  @RequirePermissions(permissions.employeeRead)
  orgChart() {
    return this.employeeService.orgChart();
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

  @Patch(":employeeId")
  @RequirePermissions(permissions.employeeWrite)
  updateEmployee(
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) body: z.infer<typeof updateEmployeeSchema>,
  ) {
    return this.employeeService.updateEmployee(employeeId, body);
  }

  @Post(":employeeId/lifecycle")
  @RequirePermissions(permissions.employeeWrite)
  transition(
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(transitionSchema)) body: z.infer<typeof transitionSchema>,
  ) {
    return this.employeeService.transition(employeeId, body);
  }

  // ---- Employment history ----
  @Get(":employeeId/history")
  @RequirePermissions(permissions.employeeRead)
  history(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.employeeService.history(employeeId);
  }

  @Post(":employeeId/history")
  @RequirePermissions(permissions.employeeWrite)
  addEvent(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(eventSchema)) body: z.infer<typeof eventSchema>) {
    return this.employeeService.addEvent(employeeId, body);
  }

  // ---- Employee documents ----
  @Get(":employeeId/documents")
  @RequirePermissions(permissions.employeeRead)
  listDocuments(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.documents.list(employeeId);
  }

  @Post(":employeeId/documents")
  @RequirePermissions(permissions.employeeWrite)
  uploadDocument(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(documentUploadSchema)) body: z.infer<typeof documentUploadSchema>) {
    return this.documents.createUpload(employeeId, body);
  }

  @Delete("documents/:documentId")
  @RequirePermissions(permissions.employeeWrite)
  deleteDocument(@Param("documentId", ParseUUIDPipe) documentId: string) {
    return this.documents.delete(documentId);
  }
}
