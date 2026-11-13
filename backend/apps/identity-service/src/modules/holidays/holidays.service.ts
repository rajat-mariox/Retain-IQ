import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

function parseDate(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid date.");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class HolidaysService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(h: { id: string; name: string; date: Date; type: string; departmentId: string | null; department?: { name: string } | null }) {
    return { id: h.id, name: h.name, date: iso(h.date), type: h.type, departmentId: h.departmentId, departmentName: h.department?.name ?? null };
  }

  /** List holidays. Defaults to the current calendar year; `upcoming` limits to future dates. */
  async list(query: { year?: number; upcoming?: boolean }) {
    const ctx = requireTenantContext();
    const now = new Date();
    let where: Record<string, unknown> = { orgId: ctx.orgId };
    if (query.upcoming) {
      where = { orgId: ctx.orgId, date: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) } };
    } else {
      const y = query.year ?? now.getUTCFullYear();
      where = { orgId: ctx.orgId, date: { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) } };
    }
    const rows = await this.prisma.holiday.findMany({
      where,
      orderBy: { date: "asc" },
      take: query.upcoming ? 10 : 400,
      include: { department: { select: { name: true } } },
    });
    return rows.map((h) => this.serialize(h));
  }

  async create(input: { name: string; date: string; type?: string; departmentId?: string | null }) {
    const ctx = requireTenantContext();
    if (input.departmentId) {
      const dept = await this.prisma.department.findFirst({ where: { id: input.departmentId, orgId: ctx.orgId }, select: { id: true } });
      if (!dept) throw new NotFoundException("Department not found.");
    }
    const h = await this.prisma.holiday.create({
      data: { orgId: ctx.orgId, name: input.name.trim(), date: parseDate(input.date), type: input.type ?? "COMPANY", departmentId: input.departmentId ?? null },
      include: { department: { select: { name: true } } },
    });
    return this.serialize(h);
  }

  async update(id: string, input: { name?: string; date?: string; type?: string; departmentId?: string | null }) {
    const ctx = requireTenantContext();
    const found = await this.prisma.holiday.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!found) throw new NotFoundException("Holiday not found.");
    if (input.departmentId) {
      const dept = await this.prisma.department.findFirst({ where: { id: input.departmentId, orgId: ctx.orgId }, select: { id: true } });
      if (!dept) throw new NotFoundException("Department not found.");
    }
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.date !== undefined) data.date = parseDate(input.date);
    if (input.type !== undefined) data.type = input.type;
    if (input.departmentId !== undefined) data.departmentId = input.departmentId;
    const h = await this.prisma.holiday.update({ where: { id: found.id }, data, include: { department: { select: { name: true } } } });
    return this.serialize(h);
  }

  async remove(id: string) {
    const ctx = requireTenantContext();
    const found = await this.prisma.holiday.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!found) throw new NotFoundException("Holiday not found.");
    await this.prisma.holiday.delete({ where: { id: found.id } });
    return { id: found.id, deleted: true };
  }
}
