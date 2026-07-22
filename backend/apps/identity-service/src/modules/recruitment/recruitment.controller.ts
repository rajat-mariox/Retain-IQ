import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { RecruitmentService } from "./recruitment.service.js";

const empType = z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]);
const createReqSchema = z.object({
  title: z.string().min(1).max(160),
  departmentId: z.string().uuid().nullable().optional(),
  designationId: z.string().uuid().nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  employmentType: empType.nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  openings: z.coerce.number().int().min(1).max(1000).optional(),
});
const updateReqSchema = z
  .object({
    title: z.string().min(1).max(160),
    departmentId: z.string().uuid().nullable(),
    designationId: z.string().uuid().nullable(),
    location: z.string().max(120).nullable(),
    employmentType: empType.nullable(),
    description: z.string().max(4000).nullable(),
    openings: z.coerce.number().int().min(1).max(1000),
    status: z.enum(["OPEN", "ON_HOLD", "FILLED", "CLOSED"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });

const createCandidateSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  source: z.string().max(60).optional(),
  requisitionId: z.string().uuid().optional(),
});
const createApplicationSchema = z.object({ candidateId: z.string().uuid(), requisitionId: z.string().uuid() });
const updateApplicationSchema = z
  .object({
    stage: z.enum(["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "REJECTED"]),
    rating: z.coerce.number().int().min(1).max(5).nullable(),
    notes: z.string().max(2000).nullable(),
    rejectedReason: z.string().max(500).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
const addInterviewSchema = z.object({ round: z.string().min(1).max(60), scheduledAt: z.string().datetime().optional(), interviewer: z.string().max(120).optional(), mode: z.enum(["Onsite", "Video", "Phone"]).optional() });
const updateInterviewSchema = z
  .object({ outcome: z.enum(["PENDING", "PASS", "FAIL", "HOLD"]), rating: z.coerce.number().int().min(1).max(5).nullable(), feedback: z.string().max(2000).nullable(), scheduledAt: z.string().datetime().nullable(), interviewer: z.string().max(120).nullable(), round: z.string().min(1).max(60), mode: z.enum(["Onsite", "Video", "Phone"]).nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
const addOfferSchema = z.object({ title: z.string().max(160).optional(), salary: z.string().max(60).optional(), joiningDate: z.string().datetime().optional(), note: z.string().max(1000).optional() });
const updateOfferSchema = z
  .object({ status: z.enum(["DRAFT", "SENT", "ACCEPTED", "DECLINED", "WITHDRAWN"]), salary: z.string().max(60).nullable(), joiningDate: z.string().datetime().nullable(), title: z.string().max(160).nullable(), note: z.string().max(1000).nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
const hireSchema = z.object({ employeeCode: z.string().max(64).optional(), joinedAt: z.string().datetime().optional(), departmentId: z.string().uuid().optional(), designationId: z.string().uuid().optional(), teamId: z.string().uuid().optional() });

@Controller("recruitment")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class RecruitmentController {
  constructor(private readonly rec: RecruitmentService) {}

  @Get("requisitions")
  @RequirePermissions(permissions.employeeRead)
  requisitions() {
    return this.rec.listRequisitions();
  }
  @Post("requisitions")
  @RequirePermissions(permissions.employeeWrite)
  createRequisition(@Body(new ZodValidationPipe(createReqSchema)) body: z.infer<typeof createReqSchema>) {
    return this.rec.createRequisition(body);
  }
  @Patch("requisitions/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateRequisition(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateReqSchema)) body: z.infer<typeof updateReqSchema>) {
    return this.rec.updateRequisition(id, body);
  }

  @Get("pipeline")
  @RequirePermissions(permissions.employeeRead)
  pipeline(@Query("requisitionId") requisitionId?: string) {
    return this.rec.pipeline(requisitionId);
  }

  @Get("candidates")
  @RequirePermissions(permissions.employeeRead)
  candidates(@Query("q") q?: string) {
    return this.rec.listCandidates(q);
  }
  @Post("candidates")
  @RequirePermissions(permissions.employeeWrite)
  createCandidate(@Body(new ZodValidationPipe(createCandidateSchema)) body: z.infer<typeof createCandidateSchema>) {
    return this.rec.createCandidate(body);
  }

  @Get("applications/:id")
  @RequirePermissions(permissions.employeeRead)
  application(@Param("id", ParseUUIDPipe) id: string) {
    return this.rec.getApplication(id);
  }
  @Post("applications")
  @RequirePermissions(permissions.employeeWrite)
  createApplication(@Body(new ZodValidationPipe(createApplicationSchema)) body: z.infer<typeof createApplicationSchema>) {
    return this.rec.createApplication(body);
  }
  @Patch("applications/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateApplication(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateApplicationSchema)) body: z.infer<typeof updateApplicationSchema>) {
    return this.rec.updateApplication(id, body);
  }
  @Post("applications/:id/interviews")
  @RequirePermissions(permissions.employeeWrite)
  addInterview(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(addInterviewSchema)) body: z.infer<typeof addInterviewSchema>) {
    return this.rec.addInterview(id, body);
  }
  @Post("applications/:id/offers")
  @RequirePermissions(permissions.employeeWrite)
  addOffer(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(addOfferSchema)) body: z.infer<typeof addOfferSchema>) {
    return this.rec.addOffer(id, body);
  }
  @Post("applications/:id/hire")
  @RequirePermissions(permissions.employeeWrite)
  hire(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(hireSchema)) body: z.infer<typeof hireSchema>) {
    return this.rec.hire(id, body);
  }

  @Patch("interviews/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateInterview(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateInterviewSchema)) body: z.infer<typeof updateInterviewSchema>) {
    return this.rec.updateInterview(id, body);
  }
  @Patch("offers/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateOffer(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateOfferSchema)) body: z.infer<typeof updateOfferSchema>) {
    return this.rec.updateOffer(id, body);
  }
}
