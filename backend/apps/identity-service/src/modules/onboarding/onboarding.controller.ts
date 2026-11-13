import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { OnboardingService } from "./onboarding.service.js";

const category = z.enum(["TASK", "DOCUMENT", "POLICY", "ACCESS", "TRAINING"]);
const assignee = z.enum(["EMPLOYEE", "HR", "MANAGER", "IT"]);

const createTemplateSchema = z.object({ name: z.string().min(1).max(120), seedDefault: z.boolean().optional() });
const updateTemplateSchema = z.object({ name: z.string().min(1).max(120).optional(), isDefault: z.boolean().optional() }).refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
const itemSchema = z.object({ title: z.string().min(1).max(200), description: z.string().max(1000).optional(), category, assignee, required: z.boolean().optional(), order: z.coerce.number().int().min(0).optional() });
const updateItemSchema = itemSchema.partial().refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
const startSchema = z.object({ templateId: z.string().uuid().optional() });
const taskStatusSchema = z.object({ status: z.enum(["PENDING", "DONE", "SKIPPED"]), note: z.string().max(1000).nullable().optional() });
const addTaskSchema = z.object({ title: z.string().min(1).max(200), description: z.string().max(1000).optional(), category, assignee, required: z.boolean().optional() });

@Controller("onboarding")
@RequireFeature("recruitment")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  // Templates
  @Get("templates")
  @RequirePermissions(permissions.employeeRead)
  listTemplates() {
    return this.svc.listTemplates();
  }
  @Post("templates")
  @RequirePermissions(permissions.employeeWrite)
  createTemplate(@Body(new ZodValidationPipe(createTemplateSchema)) body: z.infer<typeof createTemplateSchema>) {
    return this.svc.createTemplate(body);
  }
  @Get("templates/:id")
  @RequirePermissions(permissions.employeeRead)
  getTemplate(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.getTemplate(id);
  }
  @Patch("templates/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateTemplate(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateTemplateSchema)) body: z.infer<typeof updateTemplateSchema>) {
    return this.svc.updateTemplate(id, body);
  }
  @Delete("templates/:id")
  @RequirePermissions(permissions.employeeWrite)
  deleteTemplate(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.deleteTemplate(id);
  }
  @Post("templates/:id/items")
  @RequirePermissions(permissions.employeeWrite)
  addItem(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(itemSchema)) body: z.infer<typeof itemSchema>) {
    return this.svc.addItem(id, body);
  }
  @Patch("items/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateItem(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateItemSchema)) body: z.infer<typeof updateItemSchema>) {
    return this.svc.updateItem(id, body);
  }
  @Delete("items/:id")
  @RequirePermissions(permissions.employeeWrite)
  deleteItem(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.deleteItem(id);
  }

  // Journeys
  @Get("overview")
  @RequirePermissions(permissions.employeeRead)
  overview() {
    return this.svc.overview();
  }
  @Get("employees/:employeeId")
  @RequirePermissions(permissions.employeeRead)
  getJourney(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.svc.getJourney(employeeId);
  }
  @Post("employees/:employeeId/start")
  @RequirePermissions(permissions.employeeWrite)
  start(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>) {
    return this.svc.startJourney(employeeId, body.templateId);
  }
  @Post("journeys/:journeyId/tasks")
  @RequirePermissions(permissions.employeeWrite)
  addTask(@Param("journeyId", ParseUUIDPipe) journeyId: string, @Body(new ZodValidationPipe(addTaskSchema)) body: z.infer<typeof addTaskSchema>) {
    return this.svc.addTask(journeyId, body);
  }
  @Patch("tasks/:taskId")
  @RequirePermissions(permissions.employeeWrite)
  setTaskStatus(@Param("taskId", ParseUUIDPipe) taskId: string, @Body(new ZodValidationPipe(taskStatusSchema)) body: z.infer<typeof taskStatusSchema>) {
    return this.svc.setTaskStatus(taskId, body);
  }
  @Delete("tasks/:taskId")
  @RequirePermissions(permissions.employeeWrite)
  deleteTask(@Param("taskId", ParseUUIDPipe) taskId: string) {
    return this.svc.deleteTask(taskId);
  }
}
