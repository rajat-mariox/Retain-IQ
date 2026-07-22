import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { offsetPaginationQuerySchema, type OffsetPaginationQuery } from "@retainiq/contracts";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import {
  addTaskCommentSchema,
  createGoalSchema,
  createMilestoneSchema,
  createProjectSchema,
  createTaskSchema,
  updateGoalSchema,
  updateMilestoneSchema,
  updateProjectSchema,
  updateProjectSettingsSchema,
  updateTaskSchema,
  type AddTaskCommentInput,
  type CreateGoalInput,
  type CreateMilestoneInput,
  type CreateProjectInput,
  type CreateTaskInput,
  type UpdateGoalInput,
  type UpdateMilestoneInput,
  type UpdateProjectInput,
  type UpdateProjectSettingsInput,
  type UpdateTaskInput,
} from "./dto.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ProjectsService } from "./projects.service.js";

@Controller()
@RequireFeature("projects")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // Reads are open to any member; writes require project.write (Owner/Manager).

  /** Portfolio KPIs + progress overview. Declared before :id so it isn't parsed as an id. */
  @Get("projects/dashboard")
  dashboard() {
    return this.projects.dashboard();
  }

  /** Active employees for owner/assignee pickers (read-open). */
  @Get("projects/people")
  people() {
    return this.projects.listPeople();
  }

  /** Teams for the project team picker (read-open — avoids the employee.read gate). */
  @Get("projects/teams")
  teams() {
    return this.projects.listTeams();
  }

  // ---- Phase 2: overviews (read-open) ----
  @Get("projects/teams-overview")
  teamsOverview() {
    return this.projects.teamsOverview();
  }

  @Get("projects/departments-overview")
  departmentsOverview() {
    return this.projects.departmentsOverview();
  }

  // ---- Settings / Admin ----
  @Get("projects/settings")
  getSettings() {
    return this.projects.getSettings();
  }

  @Patch("projects/settings")
  @RequirePermissions(permissions.projectWrite)
  updateSettings(@Body(new ZodValidationPipe(updateProjectSettingsSchema)) body: UpdateProjectSettingsInput) {
    return this.projects.updateSettings(body);
  }

  // ---- Phase 4: reports & manager view (read-open) ----
  @Get("projects/reports")
  reports() {
    return this.projects.reports();
  }

  @Get("projects/manager-overview")
  managerOverview() {
    return this.projects.managerOverview();
  }

  // ---- Phase 3: Goals (org- or project-scoped) ----
  @Get("goals")
  listGoals(@Query("projectId") projectId?: string) {
    return this.projects.listGoals(projectId);
  }

  @Post("goals")
  @RequirePermissions(permissions.projectWrite)
  createGoal(@Body(new ZodValidationPipe(createGoalSchema)) body: CreateGoalInput) {
    return this.projects.createGoal(body);
  }

  @Patch("goals/:id")
  @RequirePermissions(permissions.projectWrite)
  updateGoal(@Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(updateGoalSchema)) body: UpdateGoalInput) {
    return this.projects.updateGoal(id, body);
  }

  @Delete("goals/:id")
  @RequirePermissions(permissions.projectWrite)
  deleteGoal(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.projects.deleteGoal(id);
  }

  @Get("projects")
  listProjects(
    @Query(new ZodValidationPipe(offsetPaginationQuerySchema)) query: OffsetPaginationQuery,
    @Query("status") status?: string,
    @Query("q") q?: string,
  ) {
    return this.projects.listProjects({ ...query, status, q });
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

  @Patch("projects/:id")
  @RequirePermissions(permissions.projectWrite)
  updateProject(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProjectInput,
  ) {
    return this.projects.updateProject(id, body);
  }

  @Delete("projects/:id")
  @RequirePermissions(permissions.projectWrite)
  deleteProject(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.projects.deleteProject(id);
  }

  @Post("projects/:id/tasks")
  @RequirePermissions(permissions.projectWrite)
  createTask(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput,
  ) {
    return this.projects.createTask(id, body);
  }

  // Self-scoped: the caller's own assigned tasks across all projects. Open to any
  // member (no permission gate) since it only ever returns the caller's own work.
  // Declared before tasks/:id so "mine" isn't parsed as an id.
  @Get("tasks/mine")
  myTasks() {
    return this.projects.myTasks();
  }

  // Task detail + discussion. No permission gate: getTask() itself decides
  // visibility (manages the project, sees the project, or is the assignee).
  @Get("tasks/:id")
  getTask(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.projects.getTask(id);
  }

  @Post("tasks/:id/comments")
  addTaskComment(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(addTaskCommentSchema)) body: AddTaskCommentInput,
  ) {
    return this.projects.addTaskComment(id, body.body);
  }

  // No @RequirePermissions here: project.write grants a full edit, but an
  // assignee may also move their OWN task between statuses. updateTask() does
  // that authorization since it depends on the task and the fields being changed.
  @Patch("tasks/:id")
  updateTask(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskInput,
  ) {
    return this.projects.updateTask(id, body);
  }

  @Delete("tasks/:id")
  @RequirePermissions(permissions.projectWrite)
  deleteTask(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.projects.deleteTask(id);
  }

  // ---- Phase 3: Milestones (project sub-resource) ----
  @Post("projects/:id/milestones")
  @RequirePermissions(permissions.projectWrite)
  createMilestone(@Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(createMilestoneSchema)) body: CreateMilestoneInput) {
    return this.projects.createMilestone(id, body);
  }

  @Patch("milestones/:id")
  @RequirePermissions(permissions.projectWrite)
  updateMilestone(@Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(updateMilestoneSchema)) body: UpdateMilestoneInput) {
    return this.projects.updateMilestone(id, body);
  }

  @Delete("milestones/:id")
  @RequirePermissions(permissions.projectWrite)
  deleteMilestone(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.projects.deleteMilestone(id);
  }

  // GET /teams is owned by OrgStructureController (teams are org structure,
  // not a project sub-resource) and returns a superset (dept + member counts).
}
