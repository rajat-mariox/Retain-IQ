import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

function parseDate(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid date.");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class LeaveService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve the caller's employee record via their active membership. */
  private async callerEmployeeId(): Promise<string> {
    const ctx = requireTenantContext();
    const m = await this.prisma.organizationMembership.findUnique({ where: { id: ctx.membershipId }, select: { employeeId: true } });
    if (!m?.employeeId) throw new BadRequestException("Your account is not linked to an employee record.");
    return m.employeeId;
  }

  // ---- Leave types ----

  async listTypes() {
    const ctx = requireTenantContext();
    return this.prisma.leaveType.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ status: "asc" }, { name: "asc" }] });
  }

  async createType(input: { name: string; code: string; annualQuota?: number; paid?: boolean; color?: string | null }) {
    const ctx = requireTenantContext();
    try {
      return await this.prisma.leaveType.create({
        data: { orgId: ctx.orgId, name: input.name.trim(), code: input.code.trim().toUpperCase(), annualQuota: input.annualQuota ?? 0, paid: input.paid ?? true, color: input.color ?? null },
      });
    } catch (e) {
      if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") throw new ConflictException("A leave type with this code already exists.");
      throw e;
    }
  }

  async updateType(id: string, input: { name?: string; annualQuota?: number; paid?: boolean; color?: string | null; status?: string }) {
    const ctx = requireTenantContext();
    const found = await this.prisma.leaveType.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!found) throw new NotFoundException("Leave type not found.");
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.annualQuota !== undefined) data.annualQuota = input.annualQuota;
    if (input.paid !== undefined) data.paid = input.paid;
    if (input.color !== undefined) data.color = input.color;
    if (input.status !== undefined) data.status = input.status;
    return this.prisma.leaveType.update({ where: { id: found.id }, data });
  }

  // ---- Balances ----

  /** Per-type allocated / used / pending / remaining for an employee in a year. */
  async balances(employeeId?: string, year?: number) {
    const ctx = requireTenantContext();
    const empId = employeeId ?? (await this.callerEmployeeId());
    const y = year ?? new Date().getUTCFullYear();
    const start = new Date(Date.UTC(y, 0, 1));
    const end = new Date(Date.UTC(y + 1, 0, 1));

    const [types, requests] = await Promise.all([
      this.prisma.leaveType.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE" }, orderBy: { name: "asc" } }),
      this.prisma.leaveRequest.findMany({
        where: { orgId: ctx.orgId, employeeId: empId, status: { in: ["APPROVED", "PENDING"] }, startDate: { gte: start, lt: end } },
        select: { leaveTypeId: true, days: true, status: true },
      }),
    ]);

    const used = new Map<string, number>();
    const pending = new Map<string, number>();
    for (const r of requests) {
      const map = r.status === "APPROVED" ? used : pending;
      map.set(r.leaveTypeId, (map.get(r.leaveTypeId) ?? 0) + r.days);
    }

    return {
      year: y,
      employeeId: empId,
      balances: types.map((t) => {
        const u = used.get(t.id) ?? 0;
        const p = pending.get(t.id) ?? 0;
        return {
          leaveTypeId: t.id,
          name: t.name,
          code: t.code,
          color: t.color,
          paid: t.paid,
          allocated: t.annualQuota,
          used: u,
          pending: p,
          remaining: t.annualQuota > 0 ? Math.max(0, t.annualQuota - u - p) : null, // null = uncapped
        };
      }),
    };
  }

  // ---- Requests ----

  /** Working days between two dates for an employee (excludes weekly-offs & holidays). */
  private async computeLeaveDays(orgId: string, employeeId: string, start: Date, end: Date): Promise<number> {
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { departmentId: true, shiftRef: { select: { workingDays: true, status: true } } } });
    let workingDays = emp?.shiftRef && emp.shiftRef.status === "ACTIVE" ? emp.shiftRef.workingDays : null;
    if (!workingDays || workingDays.length === 0) {
      const def = await this.prisma.shift.findFirst({ where: { orgId, isDefault: true, status: "ACTIVE" }, select: { workingDays: true } });
      workingDays = def?.workingDays?.length ? def.workingDays : DEFAULT_WORKING_DAYS;
    }
    const wd = new Set(workingDays);
    const holidays = await this.prisma.holiday.findMany({
      where: { orgId, date: { gte: start, lte: end }, OR: [{ type: { not: "DEPARTMENT" } }, { departmentId: emp?.departmentId ?? undefined }] },
      select: { date: true },
    });
    const holidaySet = new Set(holidays.map((h) => iso(h.date)));
    let days = 0;
    for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (wd.has(d.getUTCDay()) && !holidaySet.has(iso(d))) days += 1;
    }
    return days;
  }

  async createRequest(input: { leaveTypeId: string; startDate: string; endDate: string; reason?: string }) {
    const ctx = requireTenantContext();
    const employeeId = await this.callerEmployeeId();
    const start = parseDate(input.startDate);
    const end = parseDate(input.endDate);
    if (end < start) throw new BadRequestException("End date must be on or after the start date.");

    const type = await this.prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, orgId: ctx.orgId, status: "ACTIVE" } });
    if (!type) throw new NotFoundException("Leave type not found.");

    // Reject overlaps with existing active requests.
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { orgId: ctx.orgId, employeeId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: end }, endDate: { gte: start } },
      select: { id: true },
    });
    if (overlap) throw new ConflictException("You already have a leave request overlapping these dates.");

    const days = await this.computeLeaveDays(ctx.orgId, employeeId, start, end);
    if (days <= 0) throw new BadRequestException("The selected range has no working days to take leave on.");

    return this.prisma.leaveRequest.create({
      data: { orgId: ctx.orgId, employeeId, leaveTypeId: type.id, startDate: start, endDate: end, days, reason: input.reason?.trim() || null },
    });
  }

  private serialize(r: {
    id: string;
    employeeId: string;
    startDate: Date;
    endDate: Date;
    days: number;
    reason: string | null;
    status: string;
    decidedAt: Date | null;
    decisionNote: string | null;
    createdAt: Date;
    leaveType: { id: string; name: string; code: string; color: string | null };
    employee: { firstName: string; lastName: string } | null;
  }) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeName: r.employee ? `${r.employee.firstName} ${r.employee.lastName}`.trim() : null,
      leaveType: r.leaveType,
      startDate: iso(r.startDate),
      endDate: iso(r.endDate),
      days: r.days,
      reason: r.reason,
      status: r.status,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** scope="mine" → caller's requests; scope="all" → org (needs attendance.read at controller). */
  async listRequests(query: { scope?: "mine" | "all"; status?: string; employeeId?: string }) {
    const ctx = requireTenantContext();
    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (query.scope !== "all") where.employeeId = await this.callerEmployeeId();
    else if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;

    const rows = await this.prisma.leaveRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      include: { leaveType: { select: { id: true, name: true, code: true, color: true } }, employee: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((r) => this.serialize(r));
  }

  async decide(id: string, approve: boolean, note?: string) {
    const ctx = requireTenantContext();
    const req = await this.prisma.leaveRequest.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!req) throw new NotFoundException("Leave request not found.");
    if (req.status !== "PENDING") throw new ConflictException("This request has already been decided.");
    return this.prisma.leaveRequest.update({
      where: { id: req.id },
      data: { status: approve ? "APPROVED" : "REJECTED", decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: note?.trim() || null },
    });
  }

  async cancel(id: string) {
    const ctx = requireTenantContext();
    const employeeId = await this.callerEmployeeId();
    const req = await this.prisma.leaveRequest.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!req) throw new NotFoundException("Leave request not found.");
    if (req.employeeId !== employeeId) throw new ForbiddenException("You can only cancel your own leave requests.");
    if (req.status === "REJECTED" || req.status === "CANCELLED") throw new ConflictException("This request cannot be cancelled.");
    return this.prisma.leaveRequest.update({ where: { id: req.id }, data: { status: "CANCELLED" } });
  }
}
