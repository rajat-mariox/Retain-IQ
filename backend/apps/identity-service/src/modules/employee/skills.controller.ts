import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { SkillsService } from "./skills.service.js";
import { CertificationsService } from "./certifications.service.js";

const PROFICIENCY = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"] as const;

const catalogCreateSchema = z.object({ name: z.string().min(1).max(80), category: z.string().max(60).nullable().optional(), description: z.string().max(500).nullable().optional() });
const catalogUpdateSchema = catalogCreateSchema.partial().extend({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() }).refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

const addSkillSchema = z
  .object({
    skillId: z.string().uuid().optional(),
    skillName: z.string().max(80).optional(),
    category: z.string().max(60).optional(),
    proficiency: z.enum(PROFICIENCY).optional(),
    yearsOfExp: z.coerce.number().min(0).max(60).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.skillId || v.skillName, { message: "Provide skillId or skillName." });
const updateSkillSchema = z.object({ proficiency: z.enum(PROFICIENCY).optional(), yearsOfExp: z.coerce.number().min(0).max(60).nullable().optional(), note: z.string().max(500).nullable().optional() });
const verifySchema = z.object({ approve: z.boolean() });

const certAddSchema = z.object({
  name: z.string().min(1).max(160),
  issuer: z.string().max(120).optional(),
  credentialId: z.string().max(120).optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const certUpdateSchema = z
  .object({
    name: z.string().min(1).max(160),
    issuer: z.string().max(120).nullable(),
    credentialId: z.string().max(120).nullable(),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });
const certUploadSchema = z.object({ fileName: z.string().min(1).max(200), contentType: z.string().min(1).max(120) });

/**
 * Skills & certifications live under the employee resource. Reads need
 * employee.read, writes employee.write; the services additionally scope every
 * employee-keyed row through the ABAC engine, so a scoped manager only ever
 * sees/edits people in their reach.
 */
@Controller("employees")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class SkillsController {
  constructor(
    private readonly skills: SkillsService,
    private readonly certs: CertificationsService,
  ) {}

  // ---- Skill catalog (org taxonomy) ----
  @Get("skills/catalog")
  @RequirePermissions(permissions.employeeRead)
  listCatalog(@Query("archived") archived?: string) {
    return this.skills.listCatalog(archived === "1" || archived === "true");
  }

  @Post("skills/catalog")
  @RequirePermissions(permissions.employeeWrite)
  createSkill(@Body(new ZodValidationPipe(catalogCreateSchema)) body: z.infer<typeof catalogCreateSchema>) {
    return this.skills.createSkill(body);
  }

  @Patch("skills/catalog/:id")
  @RequirePermissions(permissions.employeeWrite)
  updateSkill(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(catalogUpdateSchema)) body: z.infer<typeof catalogUpdateSchema>) {
    return this.skills.updateSkill(id, body);
  }

  // ---- Employee skills ----
  @Get(":employeeId/skills")
  @RequirePermissions(permissions.employeeRead)
  listSkills(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.skills.listForEmployee(employeeId);
  }

  @Post(":employeeId/skills")
  @RequirePermissions(permissions.employeeWrite)
  addSkill(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(addSkillSchema)) body: z.infer<typeof addSkillSchema>) {
    return this.skills.addForEmployee(employeeId, body);
  }

  @Patch("skills/:employeeSkillId")
  @RequirePermissions(permissions.employeeWrite)
  updateEmployeeSkill(@Param("employeeSkillId", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateSkillSchema)) body: z.infer<typeof updateSkillSchema>) {
    return this.skills.updateEmployeeSkill(id, body);
  }

  @Post("skills/:employeeSkillId/verify")
  @RequirePermissions(permissions.employeeWrite)
  verifySkill(@Param("employeeSkillId", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(verifySchema)) body: z.infer<typeof verifySchema>) {
    return this.skills.verifyEmployeeSkill(id, body.approve);
  }

  @Post("skills/:employeeSkillId/endorse")
  @RequirePermissions(permissions.employeeRead)
  endorseSkill(@Param("employeeSkillId", ParseUUIDPipe) id: string) {
    return this.skills.endorseEmployeeSkill(id);
  }

  @Delete("skills/:employeeSkillId")
  @RequirePermissions(permissions.employeeWrite)
  removeSkill(@Param("employeeSkillId", ParseUUIDPipe) id: string) {
    return this.skills.removeEmployeeSkill(id);
  }

  // ---- Certifications ----
  @Get(":employeeId/certifications")
  @RequirePermissions(permissions.employeeRead)
  listCerts(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.certs.listForEmployee(employeeId);
  }

  @Post(":employeeId/certifications")
  @RequirePermissions(permissions.employeeWrite)
  addCert(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(certAddSchema)) body: z.infer<typeof certAddSchema>) {
    return this.certs.addForEmployee(employeeId, body);
  }

  @Patch("certifications/:certId")
  @RequirePermissions(permissions.employeeWrite)
  updateCert(@Param("certId", ParseUUIDPipe) certId: string, @Body(new ZodValidationPipe(certUpdateSchema)) body: z.infer<typeof certUpdateSchema>) {
    return this.certs.update(certId, body);
  }

  @Post("certifications/:certId/verify")
  @RequirePermissions(permissions.employeeWrite)
  verifyCert(@Param("certId", ParseUUIDPipe) certId: string, @Body(new ZodValidationPipe(verifySchema)) body: z.infer<typeof verifySchema>) {
    return this.certs.verify(certId, body.approve);
  }

  @Post("certifications/:certId/document")
  @RequirePermissions(permissions.employeeWrite)
  uploadCertDoc(@Param("certId", ParseUUIDPipe) certId: string, @Body(new ZodValidationPipe(certUploadSchema)) body: z.infer<typeof certUploadSchema>) {
    return this.certs.createUpload(certId, body);
  }

  @Delete("certifications/:certId")
  @RequirePermissions(permissions.employeeWrite)
  removeCert(@Param("certId", ParseUUIDPipe) certId: string) {
    return this.certs.remove(certId);
  }
}
