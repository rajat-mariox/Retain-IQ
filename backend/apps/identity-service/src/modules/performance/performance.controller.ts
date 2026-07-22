import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PerformanceService } from "./performance.service.js";

const createCycleSchema = z.object({ name: z.string().min(1).max(120), periodStart: z.string().datetime().optional(), periodEnd: z.string().datetime().optional() });
const updateCycleSchema = z
  .object({ name: z.string().min(1).max(120), status: z.enum(["DRAFT", "ACTIVE", "CLOSED"]), periodStart: z.string().datetime().nullable(), periodEnd: z.string().datetime().nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
const generateSchema = z.object({ employeeIds: z.array(z.string().uuid()).optional() });
const createReviewSchema = z.object({ employeeId: z.string().uuid() });
const updateReviewSchema = z
  .object({
    selfAssessment: z.string().max(4000).nullable(),
    strengths: z.string().max(4000).nullable(),
    improvements: z.string().max(4000).nullable(),
    managerComment: z.string().max(4000).nullable(),
    overallRating: z.coerce.number().int().min(1).max(5).nullable(),
    status: z.enum(["PENDING", "SELF_REVIEW", "IN_REVIEW", "SUBMITTED", "ACKNOWLEDGED"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
const ratingsSchema = z.object({ ratings: z.array(z.object({ competency: z.string().min(1).max(80), score: z.coerce.number().int().min(1).max(5), comment: z.string().max(1000).nullable().optional() })).max(30) });
const achievementSchema = z.object({ title: z.string().min(1).max(160), description: z.string().max(1000).optional(), category: z.string().max(40).optional(), awardedOn: z.string().datetime().optional() });

@Controller("performance")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PerformanceController {
  constructor(private readonly svc: PerformanceService) {}

  // Cycles
  @Get("cycles")
  @RequirePermissions(permissions.employeeRead)
  listCycles() {
    return this.svc.listCycles();
  }
  @Post("cycles")
  @RequirePermissions(permissions.employeeWrite)
  createCycle(@Body(new ZodValidationPipe(createCycleSchema)) body: z.infer<typeof createCycleSchema>) {
    return this.svc.createCycle(body);
  }
  @Patch("cycles/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateCycle(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateCycleSchema)) body: z.infer<typeof updateCycleSchema>) {
    return this.svc.updateCycle(id, body);
  }
  @Delete("cycles/:id")
  @RequirePermissions(permissions.employeeWrite)
  deleteCycle(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.deleteCycle(id);
  }
  @Post("cycles/:id/generate")
  @RequirePermissions(permissions.employeeWrite)
  generate(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(generateSchema)) body: z.infer<typeof generateSchema>) {
    return this.svc.generateReviews(id, body);
  }
  @Get("cycles/:id/reviews")
  @RequirePermissions(permissions.employeeRead)
  listReviews(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.listReviews(id);
  }
  @Post("cycles/:id/reviews")
  @RequirePermissions(permissions.employeeWrite)
  createReview(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(createReviewSchema)) body: z.infer<typeof createReviewSchema>) {
    return this.svc.createReview(id, body.employeeId);
  }

  // Reviews
  @Get("reviews/:id")
  @RequirePermissions(permissions.employeeRead)
  getReview(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.getReview(id);
  }
  @Patch("reviews/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateReview(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateReviewSchema)) body: z.infer<typeof updateReviewSchema>) {
    return this.svc.updateReview(id, body);
  }
  @Patch("reviews/:id/ratings")
  @RequirePermissions(permissions.employeeWrite)
  setRatings(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ratingsSchema)) body: z.infer<typeof ratingsSchema>) {
    return this.svc.setRatings(id, body.ratings);
  }

  // Achievements + per-employee history
  @Get("employees/:employeeId")
  @RequirePermissions(permissions.employeeRead)
  employeeHistory(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.svc.employeeHistory(employeeId);
  }
  @Get("employees/:employeeId/achievements")
  @RequirePermissions(permissions.employeeRead)
  listAchievements(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.svc.listAchievements(employeeId);
  }
  @Post("employees/:employeeId/achievements")
  @RequirePermissions(permissions.employeeWrite)
  addAchievement(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(achievementSchema)) body: z.infer<typeof achievementSchema>) {
    return this.svc.addAchievement(employeeId, body);
  }
  @Delete("achievements/:id")
  @RequirePermissions(permissions.employeeWrite)
  deleteAchievement(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.deleteAchievement(id);
  }
}
