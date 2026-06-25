import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import {
  createProjectSchema,
  createTaskSchema,
  updateTaskSchema,
  type CreateProjectInput,
  type CreateTaskInput,
  type UpdateTaskInput,
} from "./dto.js";
import { ProjectsService } from "./projects.service.js";

@Controller()
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // Reads are open to any member; writes require project.write (Owner/Manager).

  @Get("projects")
  listProjects() {
    return this.projects.listProjects();
  }

  @Post("projects")
  @RequirePermissions(permissions.projectWrite)
  createProject(@Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectInput) {
    return this.projects.createProject(body);
  }

  @Get("projects/:id")
  getProject(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.projects.getProject(id);
  }

  @Post("projects/:id/tasks")
  @RequirePermissions(permissions.projectWrite)
  createTask(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput,
  ) {
    return this.projects.createTask(id, body);
  }

  @Patch("tasks/:id")
  @RequirePermissions(permissions.projectWrite)
  updateTask(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskInput,
  ) {
    return this.projects.updateTask(id, body);
  }

  @Get("teams")
  listTeams() {
    return this.projects.listTeams();
  }
}
