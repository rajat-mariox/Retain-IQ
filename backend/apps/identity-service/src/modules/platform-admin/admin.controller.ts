import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { offsetPaginationQuerySchema, type OffsetPaginationQuery } from "@retainiq/contracts";
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

const updateOrgSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    region: z.string().min(1).max(40).optional(),
    timezone: z.string().min(1).max(60).optional(),
  })
  .refine((v) => v.name !== undefined || v.region !== undefined || v.timezone !== undefined, {
    message: "Provide at least one field to update.",
  });
type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

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
  organizations(@Query(new ZodValidationPipe(offsetPaginationQuerySchema)) query: OffsetPaginationQuery) {
    return this.admin.organizations(query);
  }

  @Post("organizations")
  createOrganization(@Body(new ZodValidationPipe(createOrgSchema)) body: CreateOrgInput) {
    return this.admin.createOrganization(body);
  }

  @Get("organizations/:id")
  organizationDetail(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.admin.organizationDetail(id);
  }

  @Patch("organizations/:id")
  updateOrganization(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateOrgSchema)) body: UpdateOrgInput,
  ) {
    return this.admin.updateOrganization(id, body);
  }

  @Post("organizations/:id/suspend")
  suspendOrganization(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.admin.setOrganizationStatus(id, "SUSPENDED");
  }

  @Post("organizations/:id/activate")
  activateOrganization(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.admin.setOrganizationStatus(id, "ACTIVE");
  }

  @Delete("organizations/:id")
  deleteOrganization(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.admin.setOrganizationStatus(id, "DELETED");
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
