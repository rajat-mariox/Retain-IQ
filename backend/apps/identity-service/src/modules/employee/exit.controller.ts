import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ExitService } from "./exit.service.js";
import { AlumniService } from "./alumni.service.js";

const REASONS = ["RESIGNATION", "TERMINATION", "RETIREMENT", "CONTRACT_END", "LAYOFF", "OTHER"] as const;

const initiateSchema = z.object({
  reason: z.enum(REASONS),
  reasonNote: z.string().max(1000).optional(),
  noticeStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lastWorkingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const addTaskSchema = z.object({ title: z.string().min(1).max(200), category: z.string().max(40).optional(), assignee: z.string().max(20).optional() });
const taskStatusSchema = z.object({ status: z.enum(["PENDING", "DONE", "SKIPPED"]), note: z.string().max(500).optional() });
const completeSchema = z.object({
  lastWorkingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  exitInterviewNote: z.string().max(2000).optional(),
  rehireEligible: z.boolean().optional(),
  rehireRating: z.coerce.number().int().min(1).max(5).optional(),
});
const rehireSchema = z.object({ rehireEligible: z.boolean().optional(), rehireRating: z.coerce.number().int().min(1).max(5).nullable().optional() }).refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

/**
 * Structured exit process + alumni directory, under the employee resource. Reads
 * need employee.read, writes employee.write; the services additionally ABAC-scope
 * the subject employee.
 */
@Controller("employees")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ExitController {
  constructor(
    private readonly exits: ExitService,
    private readonly alumni: AlumniService,
  ) {}

  @Post(":employeeId/exit-process")
  @RequirePermissions(permissions.employeeWrite)
  initiate(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(initiateSchema)) body: z.infer<typeof initiateSchema>) {
    return this.exits.initiate(employeeId, body);
  }

  @Get(":employeeId/exits")
  @RequirePermissions(permissions.employeeRead)
  listExits(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.exits.listForEmployee(employeeId);
  }

  @Get("exits/:exitId")
  @RequirePermissions(permissions.employeeRead)
  getExit(@Param("exitId", ParseUUIDPipe) exitId: string) {
    return this.exits.get(exitId);
  }

  @Post("exits/:exitId/tasks")
  @RequirePermissions(permissions.employeeWrite)
  addTask(@Param("exitId", ParseUUIDPipe) exitId: string, @Body(new ZodValidationPipe(addTaskSchema)) body: z.infer<typeof addTaskSchema>) {
    return this.exits.addTask(exitId, body);
  }

  @Patch("offboarding-tasks/:taskId")
  @RequirePermissions(permissions.employeeWrite)
  setTaskStatus(@Param("taskId", ParseUUIDPipe) taskId: string, @Body(new ZodValidationPipe(taskStatusSchema)) body: z.infer<typeof taskStatusSchema>) {
    return this.exits.setTaskStatus(taskId, body.status, body.note);
  }

  @Post("exits/:exitId/complete")
  @RequirePermissions(permissions.employeeWrite)
  complete(@Param("exitId", ParseUUIDPipe) exitId: string, @Body(new ZodValidationPipe(completeSchema)) body: z.infer<typeof completeSchema>) {
    return this.exits.complete(exitId, body);
  }

  @Post("exits/:exitId/cancel")
  @RequirePermissions(permissions.employeeWrite)
  cancel(@Param("exitId", ParseUUIDPipe) exitId: string) {
    return this.exits.cancel(exitId);
  }

  // ---- Alumni ----
  @Get("alumni")
  @RequirePermissions(permissions.employeeRead)
  listAlumni(@Query("q") q?: string, @Query("department") department?: string, @Query("rehireEligible") rehireEligible?: string) {
    return this.alumni.list({ q, department, rehireEligible: rehireEligible === undefined ? undefined : rehireEligible === "1" || rehireEligible === "true" });
  }

  @Patch("alumni/:alumniId/rehire")
  @RequirePermissions(permissions.employeeWrite)
  setRehire(@Param("alumniId", ParseUUIDPipe) alumniId: string, @Body(new ZodValidationPipe(rehireSchema)) body: z.infer<typeof rehireSchema>) {
    return this.alumni.setRehire(alumniId, body);
  }
}
