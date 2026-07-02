import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { OrgStructureService } from "./org-structure.service.js";

const createDeptSchema = z.object({ name: z.string().min(1).max(80), description: z.string().max(280).optional() });
const updateDeptSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().max(280),
    leadEmployeeId: z.string().uuid().nullable(),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
const assignSchema = z.object({ employeeIds: z.array(z.string().uuid()).min(1).max(1000) });

const createReqSchema = z.object({
  title: z.string().min(1).max(120),
  departmentId: z.string().uuid().nullable().optional(),
  openings: z.coerce.number().int().min(1).max(1000).optional(),
});
const updateReqSchema = z
  .object({
    title: z.string().min(1).max(120),
    openings: z.coerce.number().int().min(1).max(1000),
    status: z.enum(["OPEN", "ON_HOLD", "FILLED", "CLOSED"]),
    departmentId: z.string().uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });

const createDesignationSchema = z.object({
  title: z.string().min(1).max(120),
  level: z.string().max(40).nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
});
const updateDesignationSchema = z
  .object({
    title: z.string().min(1).max(120),
    level: z.string().max(40).nullable(),
    departmentId: z.string().uuid().nullable(),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });

const minute = z.coerce.number().int().min(0).max(1439);
const workingDays = z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7);
const createShiftSchema = z.object({
  name: z.string().min(1).max(80),
  startMinute: minute,
  endMinute: minute,
  graceMinutes: z.coerce.number().int().min(0).max(240).optional(),
  workingDays: workingDays.optional(),
  isDefault: z.boolean().optional(),
});
const updateShiftSchema = z
  .object({
    name: z.string().min(1).max(80),
    startMinute: minute,
    endMinute: minute,
    graceMinutes: z.coerce.number().int().min(0).max(240),
    workingDays,
    isDefault: z.boolean(),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });

const createTeamSchema = z.object({
  name: z.string().min(1).max(80),
  departmentId: z.string().uuid().nullable().optional(),
  description: z.string().max(280).optional(),
});
const updateTeamSchema = z
  .object({
    name: z.string().min(1).max(80),
    departmentId: z.string().uuid().nullable(),
    description: z.string().max(280),
    leadEmployeeId: z.string().uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });

/**
 * Org structure management (departments + teams). Tenant-scoped. Writes need
 * `employee.write` (Owner/Manager today); a dedicated `department.manage`
 * permission + scope arrives with the RBAC phase.
 */
@Controller()
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class OrgStructureController {
  constructor(private readonly svc: OrgStructureService) {}

  @Get("departments")
  @RequirePermissions(permissions.employeeRead)
  listDepartments() {
    return this.svc.listDepartments();
  }

  @Post("departments")
  @RequirePermissions(permissions.employeeWrite)
  createDepartment(@Body(new ZodValidationPipe(createDeptSchema)) body: z.infer<typeof createDeptSchema>) {
    return this.svc.createDepartment(body);
  }

  @Patch("departments/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateDepartment(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDeptSchema)) body: z.infer<typeof updateDeptSchema>,
  ) {
    return this.svc.updateDepartment(id, body);
  }

  @Delete("departments/:id")
  @RequirePermissions(permissions.employeeWrite)
  archiveDepartment(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.archiveDepartment(id);
  }

  @Post("departments/:id/employees")
  @RequirePermissions(permissions.employeeWrite)
  assignEmployees(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assignSchema)) body: z.infer<typeof assignSchema>,
  ) {
    return this.svc.assignEmployees(id, body.employeeIds);
  }

  @Get("teams")
  @RequirePermissions(permissions.employeeRead)
  listTeams() {
    return this.svc.listTeams();
  }

  @Post("teams")
  @RequirePermissions(permissions.employeeWrite)
  createTeam(@Body(new ZodValidationPipe(createTeamSchema)) body: z.infer<typeof createTeamSchema>) {
    return this.svc.createTeam(body);
  }

  @Patch("teams/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateTeam(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTeamSchema)) body: z.infer<typeof updateTeamSchema>,
  ) {
    return this.svc.updateTeam(id, body);
  }

  @Delete("teams/:id")
  @RequirePermissions(permissions.employeeWrite)
  deleteTeam(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.deleteTeam(id);
  }

  @Post("teams/:id/members")
  @RequirePermissions(permissions.employeeWrite)
  assignTeamMembers(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assignSchema)) body: z.infer<typeof assignSchema>,
  ) {
    return this.svc.assignTeamMembers(id, body.employeeIds);
  }

  @Get("requisitions")
  @RequirePermissions(permissions.employeeRead)
  listRequisitions() {
    return this.svc.listRequisitions();
  }

  @Post("requisitions")
  @RequirePermissions(permissions.employeeWrite)
  createRequisition(@Body(new ZodValidationPipe(createReqSchema)) body: z.infer<typeof createReqSchema>) {
    return this.svc.createRequisition(body);
  }

  @Patch("requisitions/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateRequisition(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateReqSchema)) body: z.infer<typeof updateReqSchema>,
  ) {
    return this.svc.updateRequisition(id, body);
  }

  @Get("designations")
  @RequirePermissions(permissions.employeeRead)
  listDesignations() {
    return this.svc.listDesignations();
  }

  @Post("designations")
  @RequirePermissions(permissions.employeeWrite)
  createDesignation(@Body(new ZodValidationPipe(createDesignationSchema)) body: z.infer<typeof createDesignationSchema>) {
    return this.svc.createDesignation(body);
  }

  @Patch("designations/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateDesignation(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDesignationSchema)) body: z.infer<typeof updateDesignationSchema>,
  ) {
    return this.svc.updateDesignation(id, body);
  }

  @Delete("designations/:id")
  @RequirePermissions(permissions.employeeWrite)
  archiveDesignation(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.archiveDesignation(id);
  }

  @Get("shifts")
  @RequirePermissions(permissions.employeeRead)
  listShifts() {
    return this.svc.listShifts();
  }

  @Post("shifts")
  @RequirePermissions(permissions.employeeWrite)
  createShift(@Body(new ZodValidationPipe(createShiftSchema)) body: z.infer<typeof createShiftSchema>) {
    return this.svc.createShift(body);
  }

  @Patch("shifts/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateShift(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateShiftSchema)) body: z.infer<typeof updateShiftSchema>,
  ) {
    return this.svc.updateShift(id, body);
  }

  @Delete("shifts/:id")
  @RequirePermissions(permissions.employeeWrite)
  archiveShift(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.archiveShift(id);
  }
}
