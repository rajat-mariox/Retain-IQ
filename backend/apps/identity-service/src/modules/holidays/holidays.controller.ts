import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { PublicRoute } from "../../common/decorators/public-route.decorator.js";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { HolidaysService } from "./holidays.service.js";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["COMPANY", "REGIONAL", "DEPARTMENT"]).optional(),
  departmentId: z.string().uuid().nullable().optional(),
});
const updateSchema = z
  .object({ name: z.string().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), type: z.enum(["COMPANY", "REGIONAL", "DEPARTMENT"]), departmentId: z.string().uuid().nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });

@Controller("holidays")
@RequireFeature("attendance")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  /** Holiday calendar — visible to all members. */
  @Get()
  @PublicRoute("the org holiday calendar, visible to all members")
  list(@Query("year") year?: string, @Query("upcoming") upcoming?: string) {
    return this.holidays.list({ year: year ? Number(year) : undefined, upcoming: upcoming === "true" });
  }

  @Post()
  @RequirePermissions(permissions.attendanceApprove)
  create(@Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.holidays.create(body);
  }

  @Patch(":id")
  @RequirePermissions(permissions.attendanceApprove)
  update(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    return this.holidays.update(id, body);
  }

  @Delete(":id")
  @RequirePermissions(permissions.attendanceApprove)
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.holidays.remove(id);
  }
}
