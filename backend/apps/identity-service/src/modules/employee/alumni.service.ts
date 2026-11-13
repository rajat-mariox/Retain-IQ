import { Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

/**
 * Alumni directory of former employees. A read/search surface over the alumni
 * projection so authorized recruiters can find rehire-eligible people. Org-scoped;
 * gated by employee.read at the route. Rehire eligibility is editable by
 * employee.write holders (HR).
 */
@Injectable()
export class AlumniService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: { q?: string; department?: string; rehireEligible?: boolean }) {
    const ctx = requireTenantContext();
    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (query.department) where.lastDepartment = query.department;
    if (query.rehireEligible !== undefined) where.rehireEligible = query.rehireEligible;
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { fullName: { contains: q, mode: "insensitive" } },
        { workEmail: { contains: q, mode: "insensitive" } },
        { lastDesignation: { contains: q, mode: "insensitive" } },
      ];
    }
    const rows = await this.prisma.employeeAlumni.findMany({ where, orderBy: { exitDate: "desc" }, take: 200 });
    return rows.map((a) => ({
      id: a.id, employeeId: a.employeeId, fullName: a.fullName, workEmail: a.workEmail, personalEmail: a.personalEmail,
      joiningDate: a.joiningDate ? a.joiningDate.toISOString().slice(0, 10) : null,
      exitDate: a.exitDate ? a.exitDate.toISOString().slice(0, 10) : null,
      lastDesignation: a.lastDesignation, lastDepartment: a.lastDepartment, exitReason: a.exitReason,
      rehireEligible: a.rehireEligible, rehireRating: a.rehireRating,
    }));
  }

  async setRehire(alumniId: string, input: { rehireEligible?: boolean; rehireRating?: number | null }) {
    const ctx = requireTenantContext();
    const a = await this.prisma.employeeAlumni.findFirst({ where: { id: alumniId, orgId: ctx.orgId } });
    if (!a) throw new NotFoundException("Alumni record not found.");
    return this.prisma.employeeAlumni.update({
      where: { id: a.id },
      data: { ...(input.rehireEligible !== undefined ? { rehireEligible: input.rehireEligible } : {}), ...(input.rehireRating !== undefined ? { rehireRating: input.rehireRating } : {}) },
      select: { id: true, rehireEligible: true, rehireRating: true },
    });
  }
}
