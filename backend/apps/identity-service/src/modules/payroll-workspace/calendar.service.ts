import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditService } from "../../common/audit/audit.service.js";

/** Parse a "YYYY-MM-DD" calendar date into a UTC-midnight Date (a @db.Date column). */
function parseDate(value: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
  return d;
}

export type PayFrequencyInput = "MONTHLY" | "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "DAILY" | "CUSTOM";

export interface CreateCalendarInput {
  name: string;
  frequency?: PayFrequencyInput;
  countryCode?: string | null;
  currencyCode?: string;
  cutoffDay?: number | null;
  payDay?: number | null;
  legalEntityId?: string | null;
  active?: boolean;
}

export interface UpdateCalendarInput {
  name?: string;
  frequency?: PayFrequencyInput;
  countryCode?: string | null;
  currencyCode?: string;
  cutoffDay?: number | null;
  payDay?: number | null;
  active?: boolean;
}

export interface CreatePeriodInput {
  calendarId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD (inclusive)
  payDate?: string | null; // YYYY-MM-DD
  cutoffAt?: string | null; // ISO datetime
  taxYear?: number | null;
}

/**
 * Pay calendars and their periods (§9, §32). A calendar carries the run cadence
 * (frequency/country/currency) plus config-driven cutoff/pay day offsets; each
 * PayrollPeriod is one concrete run window that batches attach to. Tenant-isolated
 * — every read and write is filtered by the caller's orgId; an orgId is never
 * taken from the request body.
 */
@Injectable()
export class PayrollCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- Calendars ----

  async listCalendars(opts?: { active?: boolean }) {
    const { orgId } = requireTenantContext();
    const rows = await this.prisma.payrollCalendar.findMany({
      where: { orgId, ...(opts?.active === undefined ? {} : { active: opts.active }) },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { periods: true } } },
    });
    return rows.map((c) => this.serializeCalendar(c, c._count.periods));
  }

  async getCalendar(id: string) {
    const { orgId } = requireTenantContext();
    const cal = await this.prisma.payrollCalendar.findFirst({
      where: { orgId, id },
      include: { periods: { orderBy: { periodStart: "desc" }, take: 100 } },
    });
    if (!cal) throw new NotFoundException("Pay calendar not found.");
    return {
      ...this.serializeCalendar(cal, cal.periods.length),
      periods: cal.periods.map((p) => this.serializePeriod(p)),
    };
  }

  async createCalendar(input: CreateCalendarInput) {
    const { orgId, userId } = requireTenantContext();
    const created = await this.prisma.payrollCalendar.create({
      data: {
        orgId,
        name: input.name.trim(),
        frequency: input.frequency ?? "MONTHLY",
        countryCode: input.countryCode?.trim() || null,
        currencyCode: (input.currencyCode ?? "USD").trim().toUpperCase(),
        cutoffDay: input.cutoffDay ?? null,
        payDay: input.payDay ?? null,
        legalEntityId: input.legalEntityId ?? null,
        active: input.active ?? true,
        createdBy: userId,
      },
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      resourceType: "PayrollCalendar",
      resourceId: created.id,
      action: "payroll.calendar.create",
      after: created,
    });
    return this.serializeCalendar(created, 0);
  }

  async updateCalendar(id: string, input: UpdateCalendarInput) {
    const { orgId, userId } = requireTenantContext();
    const existing = await this.prisma.payrollCalendar.findFirst({ where: { orgId, id } });
    if (!existing) throw new NotFoundException("Pay calendar not found.");

    const updated = await this.prisma.payrollCalendar.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
        ...(input.countryCode !== undefined ? { countryCode: input.countryCode?.trim() || null } : {}),
        ...(input.currencyCode !== undefined ? { currencyCode: input.currencyCode.trim().toUpperCase() } : {}),
        ...(input.cutoffDay !== undefined ? { cutoffDay: input.cutoffDay } : {}),
        ...(input.payDay !== undefined ? { payDay: input.payDay } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      resourceType: "PayrollCalendar",
      resourceId: updated.id,
      action: "payroll.calendar.update",
      before: existing,
      after: updated,
    });
    return this.serializeCalendar(updated, undefined);
  }

  // ---- Periods ----

  async listPeriods(opts?: { calendarId?: string; status?: string }) {
    const { orgId } = requireTenantContext();
    const rows = await this.prisma.payrollPeriod.findMany({
      where: {
        orgId,
        ...(opts?.calendarId ? { calendarId: opts.calendarId } : {}),
        ...(opts?.status ? { status: opts.status as never } : {}),
      },
      orderBy: { periodStart: "desc" },
      take: 200,
    });
    return rows.map((p) => this.serializePeriod(p));
  }

  async createPeriod(input: CreatePeriodInput) {
    const { orgId, userId } = requireTenantContext();
    const calendar = await this.prisma.payrollCalendar.findFirst({ where: { orgId, id: input.calendarId } });
    if (!calendar) throw new NotFoundException("Pay calendar not found.");

    const periodStart = parseDate(input.periodStart);
    const periodEnd = parseDate(input.periodEnd);
    if (periodEnd < periodStart) throw new BadRequestException("periodEnd must be on or after periodStart.");

    const duplicate = await this.prisma.payrollPeriod.findFirst({
      where: { calendarId: calendar.id, periodStart, periodEnd },
    });
    if (duplicate) throw new BadRequestException("A period with this window already exists on this calendar.");

    const created = await this.prisma.payrollPeriod.create({
      data: {
        orgId,
        calendarId: calendar.id,
        periodStart,
        periodEnd,
        payDate: input.payDate ? parseDate(input.payDate) : null,
        cutoffAt: input.cutoffAt ? new Date(input.cutoffAt) : null,
        taxYear: input.taxYear ?? periodStart.getUTCFullYear(),
        status: "OPEN",
      },
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      resourceType: "PayrollPeriod",
      resourceId: created.id,
      action: "payroll.period.create",
      after: created,
    });
    return this.serializePeriod(created);
  }

  /** Re-open a period for input collection. */
  openPeriod(id: string) {
    return this.setPeriodStatus(id, "OPEN", "payroll.period.open");
  }

  /** Close a period so no further batches accrue against it. */
  closePeriod(id: string) {
    return this.setPeriodStatus(id, "CLOSED", "payroll.period.close");
  }

  private async setPeriodStatus(id: string, status: "OPEN" | "INPUT_CUTOFF" | "PROCESSING" | "CLOSED", action: string) {
    const { orgId, userId } = requireTenantContext();
    const existing = await this.prisma.payrollPeriod.findFirst({ where: { orgId, id } });
    if (!existing) throw new NotFoundException("Pay period not found.");
    if (existing.status === status) return this.serializePeriod(existing);

    const updated = await this.prisma.payrollPeriod.update({ where: { id: existing.id }, data: { status } });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      resourceType: "PayrollPeriod",
      resourceId: updated.id,
      action,
      before: { status: existing.status },
      after: { status: updated.status },
    });
    return this.serializePeriod(updated);
  }

  // ---- Serializers ----

  private serializeCalendar(
    c: {
      id: string;
      orgId: string;
      legalEntityId: string | null;
      name: string;
      frequency: string;
      countryCode: string | null;
      currencyCode: string;
      cutoffDay: number | null;
      payDay: number | null;
      active: boolean;
      createdAt: Date;
      updatedAt: Date;
    },
    periodCount: number | undefined,
  ) {
    return {
      id: c.id,
      name: c.name,
      legalEntityId: c.legalEntityId,
      frequency: c.frequency,
      countryCode: c.countryCode,
      currencyCode: c.currencyCode,
      cutoffDay: c.cutoffDay,
      payDay: c.payDay,
      active: c.active,
      ...(periodCount === undefined ? {} : { periodCount }),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private serializePeriod(p: {
    id: string;
    calendarId: string;
    periodStart: Date;
    periodEnd: Date;
    payDate: Date | null;
    cutoffAt: Date | null;
    taxYear: number | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: p.id,
      calendarId: p.calendarId,
      periodStart: p.periodStart.toISOString().slice(0, 10),
      periodEnd: p.periodEnd.toISOString().slice(0, 10),
      payDate: p.payDate ? p.payDate.toISOString().slice(0, 10) : null,
      cutoffAt: p.cutoffAt ? p.cutoffAt.toISOString() : null,
      taxYear: p.taxYear,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
