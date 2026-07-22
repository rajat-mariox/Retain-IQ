import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ClientsService } from "./clients.service.js";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(20).nullable().optional(),
  contactEmail: z.string().email().max(200).nullable().optional(),
});
const updateSchema = z
  .object({
    name: z.string().min(1).max(120),
    code: z.string().max(20).nullable(),
    contactEmail: z.string().email().max(200).nullable(),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });

/**
 * Clients live behind the projects feature flag: a client only means anything
 * once there's project work to attribute to it.
 */
@Controller("clients")
@RequireFeature("projects")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermissions(permissions.projectRead)
  list(@Query("includeArchived") includeArchived?: string) {
    return this.clients.list({ includeArchived: includeArchived === "true" });
  }

  @Post()
  @RequirePermissions(permissions.projectWrite)
  create(@Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.clients.create(body);
  }

  @Patch(":id")
  @RequirePermissions(permissions.projectWrite)
  update(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    return this.clients.update(id, body);
  }

  @Delete(":id")
  @RequirePermissions(permissions.projectWrite)
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.clients.remove(id);
  }
}
