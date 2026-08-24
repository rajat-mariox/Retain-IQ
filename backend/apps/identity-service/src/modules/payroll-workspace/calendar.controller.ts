import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PayrollCalendarService } from "./calendar.service.js";

const frequencyEnum = z.enum(["MONTHLY", "WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "DAILY", "CUSTOM"]);
const periodStatusEnum = z.enum(["OPEN", "INPUT_CUTOFF", "PROCESSING", "CLOSED"]);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const createCalendarSchema = z.object({
  name: z.string().min(1).max(120),
  frequency: frequencyEnum.optional(),
  countryCode: z.string().max(2).nullable().optional(),
  currencyCode: z.string().length(3).optional(),
  cutoffDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  payDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  legalEntityId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
});

const updateCalendarSchema = z
  .object({
    name: z.string().min(1).max(120),
    frequency: frequencyEnum,
    countryCode: z.string().max(2).nullable(),
    currencyCode: z.string().length(3),
    cutoffDay: z.coerce.number().int().min(1).max(31).nullable(),
    payDay: z.coerce.number().int().min(1).max(31).nullable(),
    active: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

const createPeriodSchema = z
  .object({
    calendarId: z.string().uuid(),
    periodStart: dateOnly,
    periodEnd: dateOnly,
    payDate: dateOnly.nullable().optional(),
    cutoffAt: z.string().datetime().nullable().optional(),
    taxYear: z.coerce.number().int().min(2000).max(2100).nullable().optional(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: "periodEnd must be on or after periodStart.", path: ["periodEnd"] });

@Controller("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PayrollCalendarController {
  constructor(private readonly calendars: PayrollCalendarService) {}

  @Get("calendars")
  @RequirePermissions(permissions.payrollBatchRead)
  listCalendars(@Query("active") active?: string) {
    const flag = active === undefined ? undefined : active === "true";
    return this.calendars.listCalendars({ active: flag });
  }

  @Get("calendars/:id")
  @RequirePermissions(permissions.payrollBatchRead)
  getCalendar(@Param("id", ParseUUIDPipe) id: string) {
    return this.calendars.getCalendar(id);
  }

  @Post("calendars")
  @RequirePermissions(permissions.payrollBatchCreate)
  createCalendar(@Body(new ZodValidationPipe(createCalendarSchema)) body: z.infer<typeof createCalendarSchema>) {
    return this.calendars.createCalendar(body);
  }

  @Patch("calendars/:id")
  @RequirePermissions(permissions.payrollBatchCreate)
  updateCalendar(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCalendarSchema)) body: z.infer<typeof updateCalendarSchema>,
  ) {
    return this.calendars.updateCalendar(id, body);
  }

  @Get("periods")
  @RequirePermissions(permissions.payrollBatchRead)
  listPeriods(@Query("calendarId") calendarId?: string, @Query("status") status?: string) {
    const parsed = periodStatusEnum.safeParse(status);
    return this.calendars.listPeriods({ calendarId, status: parsed.success ? parsed.data : undefined });
  }

  @Post("periods")
  @RequirePermissions(permissions.payrollBatchCreate)
  createPeriod(@Body(new ZodValidationPipe(createPeriodSchema)) body: z.infer<typeof createPeriodSchema>) {
    return this.calendars.createPeriod(body);
  }

  @Post("periods/:id/open")
  @RequirePermissions(permissions.payrollBatchCreate)
  openPeriod(@Param("id", ParseUUIDPipe) id: string) {
    return this.calendars.openPeriod(id);
  }

  @Post("periods/:id/close")
  @RequirePermissions(permissions.payrollBatchCreate)
  closePeriod(@Param("id", ParseUUIDPipe) id: string) {
    return this.calendars.closePeriod(id);
  }
}
