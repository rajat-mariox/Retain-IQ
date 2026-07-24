import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { offsetPaginationQuerySchema, type OffsetPaginationQuery } from "@retainiq/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { AdminService } from "./admin.service.js";
import { PlatformSettingsService } from "../../common/settings/platform-settings.service.js";
import { PlatformAuthGuard } from "./platform-auth.guard.js";

/** Attendance rules the platform sets per tenant. All fields optional on PATCH. */
const attendancePolicySchema = z
  .object({
    allowMultipleSessions: z.boolean(),
    allowReEntry: z.boolean(),
    maxSessionsPerDay: z.coerce.number().int().min(1).max(20),
    maxBreaksPerDay: z.coerce.number().int().min(0).max(50),
    maxBreakMinutesPerDay: z.coerce.number().int().min(0).max(1440),
    maxSingleBreakMinutes: z.coerce.number().int().min(0).max(1440),
    paidBreakMinutesPerDay: z.coerce.number().int().min(0).max(1440),
    allowCheckOutOnBreak: z.boolean(),
    graceMinutes: z.coerce.number().int().min(0).max(240),
    autoCheckOutAtShiftEnd: z.boolean(),
    autoCheckOutAfterMinutes: z.coerce.number().int().min(0).max(1440),
    overtimeAfterMinutes: z.coerce.number().int().min(0).max(1440),
    minHoursForPresent: z.coerce.number().int().min(0).max(1440),
    workModel: z.enum(["WFO", "WFH", "HYBRID"]),
    allowedLocations: z.array(z.enum(["OFFICE", "HOME", "CLIENT_SITE", "REMOTE"])).min(1),
    requireLocation: z.boolean(),
    allowManualCorrection: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
type AttendancePolicyInput = z.infer<typeof attendancePolicySchema>;

const createOrgSchema = z.object({
  orgName: z.string().min(2).max(120),
  ownerEmail: z.string().email(),
  ownerFirstName: z.string().min(1).max(80),
  ownerLastName: z.string().min(1).max(80),
  planId: z.string().min(1).max(40),
  seats: z.coerce.number().int().min(1).max(100000).optional(),
  /** Attendance rules chosen while creating the tenant. */
  attendancePolicy: attendancePolicySchema.optional(),
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

const updateSettingsSchema = z
  .object({
    branding: z
      .object({
        platformName: z.string().min(1).max(60),
        primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected #RRGGBB"),
        supportEmail: z.string().email(),
        logoUrl: z.string().max(500),
      })
      .partial()
      .optional(),
    notification: z
      .object({
        enabled: z.boolean(),
        message: z.string().max(500),
        level: z.enum(["info", "warning", "critical"]),
      })
      .partial()
      .optional(),
    featureFlags: z.record(z.boolean()).optional(),
    maintenance: z
      .object({ enabled: z.boolean(), message: z.string().max(500) })
      .partial()
      .optional(),
  })
  .refine((v) => v.branding || v.notification || v.featureFlags || v.maintenance, {
    message: "Provide at least one settings section to update.",
  });
type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

const auditQuerySchema = offsetPaginationQuerySchema.extend({
  category: z.enum(["all", "login", "subscription", "plan", "organization"]).default("all"),
});
type AuditQuery = z.infer<typeof auditQuerySchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const activityQuerySchema = offsetPaginationQuerySchema.extend({
  orgId: z.string().uuid().optional(),
  type: z.string().max(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
type ActivityQuery = z.infer<typeof activityQuerySchema>;

// `enabled: null` clears the override so the org inherits the global flag again.
const setOrgFeatureSchema = z.object({
  feature: z.string().min(1).max(60),
  enabled: z.boolean().nullable(),
  reason: z.string().max(300).optional(),
});
type SetOrgFeatureInput = z.infer<typeof setOrgFeatureSchema>;

/** Cross-org reporting reads for the super-admin dashboard. Platform-guarded. */
@Controller("platform/admin")
@UseGuards(PlatformAuthGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly settings: PlatformSettingsService,
  ) {}

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

  // ---- Org attendance policy (platform-owned) ----

  /**
   * Attendance rules for one org. Owned here rather than by the org owner: the
   * platform decides whether a tenant may run multiple sessions, re-enter after
   * check-out, and so on. Set at creation, editable at any time.
   */
  @Get("organizations/:id/attendance-policy")
  orgAttendancePolicy(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.admin.getAttendancePolicy(id);
  }

  @Patch("organizations/:id/attendance-policy")
  setOrgAttendancePolicy(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(attendancePolicySchema)) body: AttendancePolicyInput,
  ) {
    return this.admin.setAttendancePolicy(id, body);
  }

  // ---- Org-level feature flags ----

  /** Every feature resolved for this org: global default, override, effective state. */
  @Get("organizations/:id/features")
  orgFeatures(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.admin.orgFeatures(id);
  }

  /** Enable/disable a feature for one org, or pass enabled:null to inherit global. */
  @Patch("organizations/:id/features")
  setOrgFeature(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(setOrgFeatureSchema)) body: SetOrgFeatureInput,
  ) {
    return this.admin.setOrgFeature(id, body);
  }

  /** One feature across every org — the "who has AI Assistant?" view. */
  @Get("features/:feature/organizations")
  featureMatrix(@Param("feature") feature: string) {
    return this.admin.featureMatrix(feature);
  }

  /** Platform growth: orgs/users over time, seat utilization, storage cost curve. */
  @Get("growth")
  growth() {
    return this.admin.growth();
  }

  @Get("usage")
  usage() {
    return this.admin.usage();
  }

  @Get("billing")
  billing() {
    return this.admin.getBilling();
  }

  @Get("subscriptions")
  subscriptions() {
    return this.admin.subscriptions();
  }

  @Get("activity")
  activity(@Query(new ZodValidationPipe(activityQuerySchema)) query: ActivityQuery) {
    return this.admin.activity(query);
  }

  /** Distinct types + orgs present in the feed — populates the filter dropdowns. */
  @Get("activity/filters")
  activityFilters() {
    return this.admin.activityFilters();
  }

  @Get("audit")
  audit(@Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery) {
    return this.admin.auditLogs(query);
  }

  @Get("health")
  systemHealth() {
    return this.admin.systemHealth();
  }

  @Get("usage-analytics")
  usageAnalytics() {
    return this.admin.usageAnalytics();
  }

  @Get("customer-success")
  customerSuccess(@Query(new ZodValidationPipe(offsetPaginationQuerySchema)) query: OffsetPaginationQuery) {
    return this.admin.customerSuccess(query);
  }

  @Get("settings")
  getSettings() {
    return this.settings.getSettings();
  }

  @Patch("settings")
  updateSettings(@Body(new ZodValidationPipe(updateSettingsSchema)) body: UpdateSettingsInput) {
    return this.admin.updateSettings(body);
  }
}
