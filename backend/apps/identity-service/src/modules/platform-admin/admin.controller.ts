import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { AdminService } from "./admin.service.js";
import { PlatformAuthGuard } from "./platform-auth.guard.js";

const createOrgSchema = z.object({
  orgName: z.string().min(2).max(120),
  ownerEmail: z.string().email(),
  ownerFirstName: z.string().min(1).max(80),
  ownerLastName: z.string().min(1).max(80),
  planId: z.string().min(1).max(40),
  seats: z.coerce.number().int().min(1).max(100000).optional(),
});
type CreateOrgInput = z.infer<typeof createOrgSchema>;

/** Cross-org reporting reads for the super-admin dashboard. Platform-guarded. */
@Controller("platform/admin")
@UseGuards(PlatformAuthGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  overview() {
    return this.admin.overview();
  }

  @Get("organizations")
  organizations() {
    return this.admin.organizations();
  }

  @Post("organizations")
  createOrganization(@Body(new ZodValidationPipe(createOrgSchema)) body: CreateOrgInput) {
    return this.admin.createOrganization(body);
  }

  @Get("organizations/:id")
  organizationDetail(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.admin.organizationDetail(id);
  }

  @Get("usage")
  usage() {
    return this.admin.usage();
  }

  @Get("billing")
  billing() {
    return this.admin.getBilling();
  }
}
