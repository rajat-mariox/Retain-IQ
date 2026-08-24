import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { PermissionBundleService } from "../../common/security/permission-bundle.service.js";
import { OrgRolesService } from "../../common/org-roles/org-roles.service.js";

/** Parse a "YYYY-MM-DD" calendar date into a UTC-midnight Date (a @db.Date column). */
function parseDate(value: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
  return d;
}

/** The day before a @db.Date, in UTC — used to close a prior version's effectiveTo. */
function dayBefore(d: Date): Date {
  return new Date(d.getTime() - 24 * 60 * 60 * 1000);
}

export type PayFrequencyInput = "MONTHLY" | "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "DAILY" | "CUSTOM";
export type PaymentBasisInput = "FIXED" | "HOURLY" | "DAILY";

export interface SetProfileInput {
  employeeId: string;
  baseAmount: number;
  effectiveFrom: string; // YYYY-MM-DD
  currencyCode?: string;
  payFrequency?: PayFrequencyInput;
  paymentBasis?: PaymentBasisInput;
  legalEntityId?: string | null;
  payrollEntityId?: string | null;
  workCountry?: string | null;
  payrollCountry?: string | null;
  taxResidencyCountry?: string | null;
  calendarId?: string | null;
  taxRegime?: string | null;
  prorationPolicy?: string;
  overtimePolicyMode?: string;
  compOffPolicy?: unknown;
  bankRef?: string | null;
  joinDate?: string | null;
  exitDate?: string | null;
}

/** A masked sensitive value: the number/string is present only when the caller may unmask it. */
interface Sensitive<T> {
  value: T | null;
  masked: boolean; // true = caller may read the field but not the raw value
  visible: boolean; // false = caller lacks the field-level read permission entirely
}

interface FieldPerms {
  compensation: boolean;
  bank: boolean;
  tax: boolean;
  unmask: boolean; // salaryViewSensitive
}

/**
 * Versioned, effective-dated employee payroll profile (§7). Compensation is never
 * overwritten: setProfile() opens a NEW PayrollProfileVersion and closes the prior
 * one's effectiveTo, so financial history stays reproducible. resolveProfile()
 * returns the version in force on a given date. Compensation/bank/tax fields are
 * sensitive (§28): a serializer omits them unless the caller holds the matching
 * field-level read permission, and masks the raw value unless the caller also holds
 * salaryViewSensitive. Tenant-isolated on orgId; reads are scoped via ABAC.
 */
@Injectable()
export class PayrollProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly audit: AuditService,
    private readonly permissionBundle: PermissionBundleService,
    private readonly orgRoles: OrgRolesService,
  ) {}

  /**
   * Create the next effective-dated version of an employee's payroll profile.
   * Creating the profile's first version needs payrollProfileCreate (gated on the
   * controller); revising an existing profile additionally needs
   * payrollProfileUpdate, enforced here against the caller's live permission bundle.
   */
  async setProfile(input: SetProfileInput) {
    const { orgId, userId } = requireTenantContext();

    const employee = await this.prisma.employee.findFirst({ where: { orgId, id: input.employeeId }, select: { id: true } });
    if (!employee) throw new NotFoundException("Employee not found.");

    // The Owner runs the org but is not payroll staff — they must never carry a
    // compensation profile ([[Owner role principle]]). Enforced here so a
    // hand-crafted request can't slip an Owner into payroll past the UI.
    if (await this.orgRoles.isOwnerEmployee(orgId, input.employeeId)) {
      throw new BadRequestException("The Owner is not payroll staff and cannot be given a payroll profile.");
    }

    const effectiveFrom = parseDate(input.effectiveFrom);
    if (!Number.isFinite(input.baseAmount) || input.baseAmount < 0) {
      throw new BadRequestException("baseAmount must be a non-negative number.");
    }

    const existingProfile = await this.prisma.payrollProfile.findUnique({
      where: { orgId_employeeId: { orgId, employeeId: input.employeeId } },
      select: { id: true },
    });

    if (existingProfile) {
      // The controller gates POST on payrollProfileCreate; revising an existing
      // profile additionally requires the update permission.
      const bundle = await this.permissionBundle.resolve(orgId, userId);
      if (!bundle?.permissions.includes(permissions.payrollProfileUpdate)) {
        throw new ForbiddenException("Revising an existing payroll profile requires payroll.profile.update.");
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const profile =
        (await tx.payrollProfile.findUnique({ where: { orgId_employeeId: { orgId, employeeId: input.employeeId } } })) ??
        (await tx.payrollProfile.create({ data: { orgId, employeeId: input.employeeId } }));

      const latest = await tx.payrollProfileVersion.findFirst({
        where: { orgId, profileId: profile.id },
        orderBy: { version: "desc" },
      });
      const nextVersion = (latest?.version ?? 0) + 1;

      // Close the currently-open version so windows never overlap.
      if (latest && latest.effectiveTo === null) {
        const close = dayBefore(effectiveFrom);
        await tx.payrollProfileVersion.update({
          where: { id: latest.id },
          data: { effectiveTo: close < latest.effectiveFrom ? latest.effectiveFrom : close },
        });
      }

      const version = await tx.payrollProfileVersion.create({
        data: {
          orgId,
          profileId: profile.id,
          version: nextVersion,
          legalEntityId: input.legalEntityId ?? null,
          payrollEntityId: input.payrollEntityId ?? null,
          workCountry: input.workCountry ?? null,
          payrollCountry: input.payrollCountry ?? null,
          taxResidencyCountry: input.taxResidencyCountry ?? null,
          currencyCode: (input.currencyCode ?? "USD").trim().toUpperCase(),
          payFrequency: input.payFrequency ?? "MONTHLY",
          paymentBasis: input.paymentBasis ?? "FIXED",
          baseAmount: new Prisma.Decimal(input.baseAmount),
          calendarId: input.calendarId ?? null,
          taxRegime: input.taxRegime ?? null,
          prorationPolicy: input.prorationPolicy ?? "CALENDAR_DAYS",
          overtimePolicyMode: input.overtimePolicyMode ?? "NOT_APPLICABLE",
          compOffPolicy: input.compOffPolicy == null ? Prisma.JsonNull : (input.compOffPolicy as Prisma.InputJsonValue),
          bankRef: input.bankRef ?? null,
          effectiveFrom,
          joinDate: input.joinDate ? parseDate(input.joinDate) : null,
          exitDate: input.exitDate ? parseDate(input.exitDate) : null,
          createdBy: userId,
        },
      });
      return { profile, version };
    });

    // Audit records the change but never the raw compensation value in cleartext.
    await this.audit.record({
      orgId,
      actorUserId: userId,
      resourceType: "PayrollProfileVersion",
      resourceId: result.version.id,
      action: existingProfile ? "payroll.profile.revise" : "payroll.profile.create",
      after: {
        profileId: result.profile.id,
        employeeId: input.employeeId,
        version: result.version.version,
        effectiveFrom: input.effectiveFrom,
        currencyCode: result.version.currencyCode,
      },
      metadata: { compensationChanged: true },
    });

    const perms = await this.fieldPerms(orgId, userId);
    return this.serializeVersion(result.version, perms);
  }

  /** The version in force on a date (defaults to today) for one employee. */
  async resolveProfile(employeeId: string, on?: string) {
    const { orgId, userId } = requireTenantContext();
    await this.assertEmployeeInReach(orgId, userId, employeeId);

    const onDate = on ? parseDate(on) : parseDate(new Date().toISOString().slice(0, 10));
    const profile = await this.prisma.payrollProfile.findUnique({
      where: { orgId_employeeId: { orgId, employeeId } },
      select: { id: true, status: true },
    });
    if (!profile) throw new NotFoundException("Payroll profile not found for this employee.");

    const version = await this.prisma.payrollProfileVersion.findFirst({
      where: {
        orgId,
        profileId: profile.id,
        effectiveFrom: { lte: onDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
      },
      orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
    });
    if (!version) throw new NotFoundException("No payroll profile version is effective on that date.");

    const perms = await this.fieldPerms(orgId, userId);
    return { employeeId, status: profile.status, on: onDate.toISOString().slice(0, 10), version: this.serializeVersion(version, perms) };
  }

  /** All versions for an employee, newest first (§7 salary history). */
  async salaryHistory(employeeId: string) {
    const { orgId, userId } = requireTenantContext();
    await this.assertEmployeeInReach(orgId, userId, employeeId);

    const profile = await this.prisma.payrollProfile.findUnique({
      where: { orgId_employeeId: { orgId, employeeId } },
      select: { id: true, status: true },
    });
    if (!profile) throw new NotFoundException("Payroll profile not found for this employee.");

    const versions = await this.prisma.payrollProfileVersion.findMany({
      where: { orgId, profileId: profile.id },
      orderBy: { version: "desc" },
    });
    const perms = await this.fieldPerms(orgId, userId);
    return { employeeId, status: profile.status, versions: versions.map((v) => this.serializeVersion(v, perms)) };
  }

  /** Profiles for every employee the caller can reach (ABAC-scoped), current version each. */
  async list() {
    const { orgId, userId } = requireTenantContext();
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollProfileRead);
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);

    const profiles = await this.prisma.payrollProfile.findMany({
      where: { orgId, ...(visible === null ? {} : { employeeId: { in: visible.length > 0 ? visible : ["00000000-0000-0000-0000-000000000000"] } }) },
      orderBy: { createdAt: "desc" },
    });

    const today = parseDate(new Date().toISOString().slice(0, 10));
    const perms = await this.fieldPerms(orgId, userId);

    const rows = await Promise.all(
      profiles.map(async (p) => {
        const current = await this.prisma.payrollProfileVersion.findFirst({
          where: {
            orgId,
            profileId: p.id,
            effectiveFrom: { lte: today },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
          },
          orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
        });
        return {
          employeeId: p.employeeId,
          status: p.status,
          current: current ? this.serializeVersion(current, perms) : null,
        };
      }),
    );
    return rows;
  }

  /**
   * The people payroll can act on, for the workspace's employee pickers: everyone
   * within the caller's ABAC reach, minus the Owner (not payroll staff). Names
   * only — no compensation — so it needs just payrollRead. Returning it from the
   * backend keeps the Owner off every picker without the client having to know who
   * the Owner is.
   */
  async directory() {
    const { orgId, userId } = requireTenantContext();
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollProfileRead);
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    const ownerIds = await this.orgRoles.ownerEmployeeIds(orgId);

    // Combine reach (in) and Owner-exclusion (notIn) into a single id filter —
    // spreading two separate `id` keys would silently drop the first.
    const idFilter: Prisma.StringFilter = {};
    if (visible !== null) idFilter.in = visible.length > 0 ? visible : ["00000000-0000-0000-0000-000000000000"];
    if (ownerIds.length > 0) idFilter.notIn = ownerIds;

    const employees = await this.prisma.employee.findMany({
      where: { orgId, ...(Object.keys(idFilter).length > 0 ? { id: idFilter } : {}) },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true, title: true, status: true, departmentRef: { select: { name: true } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });

    return employees.map((e) => ({
      id: e.id,
      name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || e.employeeCode || e.email || e.id.slice(0, 8),
      title: e.title,
      department: e.departmentRef?.name ?? null,
      status: e.status,
    }));
  }

  // ---- Access + field-level authz helpers ----

  private async assertEmployeeInReach(orgId: string, userId: string, employeeId: string) {
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollProfileRead);
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    if (visible !== null && !visible.includes(employeeId)) {
      throw new ForbiddenException("You can only view payroll profiles for people within your reach.");
    }
  }

  private async fieldPerms(orgId: string, userId: string): Promise<FieldPerms> {
    const bundle = await this.permissionBundle.resolve(orgId, userId);
    const has = (p: string) => bundle?.permissions.includes(p as never) ?? false;
    return {
      compensation: has(permissions.payrollProfileCompensationRead),
      bank: has(permissions.payrollProfileBankRead),
      tax: has(permissions.payrollProfileTaxRead),
      unmask: has(permissions.salaryViewSensitive),
    };
  }

  /** Wrap a sensitive value with its visibility/mask state for this caller. */
  private sensitive<T>(value: T | null, canRead: boolean, canUnmask: boolean): Sensitive<T> {
    if (!canRead) return { value: null, masked: false, visible: false };
    if (!canUnmask) return { value: null, masked: true, visible: true };
    return { value, masked: false, visible: true };
  }

  private serializeVersion(
    v: {
      id: string;
      profileId: string;
      version: number;
      legalEntityId: string | null;
      payrollEntityId: string | null;
      workCountry: string | null;
      payrollCountry: string | null;
      taxResidencyCountry: string | null;
      currencyCode: string;
      payFrequency: string;
      paymentBasis: string;
      baseAmount: Prisma.Decimal;
      calendarId: string | null;
      taxRegime: string | null;
      prorationPolicy: string;
      overtimePolicyMode: string;
      compOffPolicy: Prisma.JsonValue;
      bankRef: string | null;
      effectiveFrom: Date;
      effectiveTo: Date | null;
      joinDate: Date | null;
      exitDate: Date | null;
      createdAt: Date;
    },
    perms: FieldPerms,
  ) {
    return {
      id: v.id,
      profileId: v.profileId,
      version: v.version,
      legalEntityId: v.legalEntityId,
      payrollEntityId: v.payrollEntityId,
      workCountry: v.workCountry,
      payrollCountry: v.payrollCountry,
      currencyCode: v.currencyCode,
      payFrequency: v.payFrequency,
      paymentBasis: v.paymentBasis,
      // Sensitive: compensation, bank, tax residency/regime.
      baseAmount: this.sensitive(Number(v.baseAmount), perms.compensation, perms.unmask),
      bankRef: this.sensitive(v.bankRef, perms.bank, perms.unmask),
      taxRegime: this.sensitive(v.taxRegime, perms.tax, perms.unmask),
      taxResidencyCountry: this.sensitive(v.taxResidencyCountry, perms.tax, perms.unmask),
      calendarId: v.calendarId,
      prorationPolicy: v.prorationPolicy,
      overtimePolicyMode: v.overtimePolicyMode,
      compOffPolicy: v.compOffPolicy,
      effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: v.effectiveTo ? v.effectiveTo.toISOString().slice(0, 10) : null,
      joinDate: v.joinDate ? v.joinDate.toISOString().slice(0, 10) : null,
      exitDate: v.exitDate ? v.exitDate.toISOString().slice(0, 10) : null,
      createdAt: v.createdAt.toISOString(),
    };
  }
}
