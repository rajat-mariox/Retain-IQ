import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "dept";
}

function isUnique(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002";
}

interface CreateDeptInput { name: string; description?: string }
interface UpdateDeptInput { name?: string; description?: string; leadEmployeeId?: string | null; status?: string }
interface CreateTeamInput { name: string; departmentId?: string | null; description?: string }
interface UpdateTeamInput { name?: string; departmentId?: string | null; description?: string; leadEmployeeId?: string | null }

/**
 * Org structure (Phase 1): departments + teams + employee assignment. The flat
 * spine the scoped RBAC/ABAC (Phase 2/3) hangs off — departments hold teams hold
 * employees, each employee has an optional department, team and manager.
 */
@Injectable()
export class OrgStructureService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Departments ----

  async listDepartments() {
    const ctx = requireTenantContext();
    const [rows, empCounts, teamCounts] = await Promise.all([
      this.prisma.department.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" } }),
      this.prisma.employee.groupBy({ by: ["departmentId"], where: { orgId: ctx.orgId, status: "ACTIVE", departmentId: { not: null } }, _count: { _all: true } }),
      this.prisma.team.groupBy({ by: ["departmentId"], where: { orgId: ctx.orgId, departmentId: { not: null } }, _count: { _all: true } }),
    ]);
    const emp = new Map(empCounts.map((c) => [c.departmentId, c._count._all]));
    const team = new Map(teamCounts.map((c) => [c.departmentId, c._count._all]));
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      slug: d.slug,
      description: d.description,
      leadEmployeeId: d.leadEmployeeId,
      status: d.status,
      employeeCount: emp.get(d.id) ?? 0,
      teamCount: team.get(d.id) ?? 0,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  async createDepartment(input: CreateDeptInput) {
    const ctx = requireTenantContext();
    try {
      return await this.prisma.department.create({
        data: { orgId: ctx.orgId, name: input.name.trim(), slug: slugify(input.name), description: input.description?.trim() || null },
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException("A department with this name already exists.");
      throw e;
    }
  }

  async updateDepartment(id: string, input: UpdateDeptInput) {
    const dept = await this.ensureDepartment(id);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      data.name = input.name.trim();
      data.slug = slugify(input.name);
    }
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.leadEmployeeId !== undefined) data.leadEmployeeId = input.leadEmployeeId;
    if (input.status !== undefined) data.status = input.status;
    try {
      return await this.prisma.department.update({ where: { id: dept.id }, data });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException("A department with this name already exists.");
      throw e;
    }
  }

  /** Archive (soft): keeps history + employee links; just flags inactive. */
  async archiveDepartment(id: string) {
    const dept = await this.ensureDepartment(id);
    return this.prisma.department.update({ where: { id: dept.id }, data: { status: "ARCHIVED" } });
  }

  /** Move employees into this department (org-scoped; ignores foreign ids). */
  async assignEmployees(departmentId: string, employeeIds: string[]) {
    const ctx = requireTenantContext();
    await this.ensureDepartment(departmentId);
    const res = await this.prisma.employee.updateMany({
      where: { orgId: ctx.orgId, id: { in: employeeIds } },
      data: { departmentId },
    });
    return { assigned: res.count };
  }

  private async ensureDepartment(id: string) {
    const ctx = requireTenantContext();
    const dept = await this.prisma.department.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!dept) throw new NotFoundException("Department not found.");
    return dept;
  }

  // ---- Teams ----

  async listTeams() {
    const ctx = requireTenantContext();
    const [rows, memberCounts] = await Promise.all([
      this.prisma.team.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" }, include: { department: { select: { id: true, name: true } } } }),
      this.prisma.employee.groupBy({ by: ["teamId"], where: { orgId: ctx.orgId, status: "ACTIVE", teamId: { not: null } }, _count: { _all: true } }),
    ]);
    const members = new Map(memberCounts.map((c) => [c.teamId, c._count._all]));
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      departmentId: t.departmentId,
      departmentName: t.department?.name ?? null,
      leadEmployeeId: t.leadEmployeeId,
      memberCount: members.get(t.id) ?? 0,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async createTeam(input: CreateTeamInput) {
    const ctx = requireTenantContext();
    if (input.departmentId) await this.ensureDepartment(input.departmentId);
    return this.prisma.team.create({
      data: { orgId: ctx.orgId, name: input.name.trim(), departmentId: input.departmentId ?? null, description: input.description?.trim() || null },
    });
  }

  async updateTeam(id: string, input: UpdateTeamInput) {
    const team = await this.ensureTeam(id);
    if (input.departmentId) await this.ensureDepartment(input.departmentId);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.departmentId !== undefined) data.departmentId = input.departmentId;
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.leadEmployeeId !== undefined) data.leadEmployeeId = input.leadEmployeeId;
    return this.prisma.team.update({ where: { id: team.id }, data });
  }

  async deleteTeam(id: string) {
    const ctx = requireTenantContext();
    const team = await this.ensureTeam(id);
    // Detach members, then remove the team.
    await this.prisma.employee.updateMany({ where: { orgId: ctx.orgId, teamId: team.id }, data: { teamId: null } });
    await this.prisma.team.delete({ where: { id: team.id } });
    return { id: team.id, deleted: true };
  }

  async assignTeamMembers(teamId: string, employeeIds: string[]) {
    const ctx = requireTenantContext();
    await this.ensureTeam(teamId);
    const res = await this.prisma.employee.updateMany({ where: { orgId: ctx.orgId, id: { in: employeeIds } }, data: { teamId } });
    return { assigned: res.count };
  }

  private async ensureTeam(id: string) {
    const ctx = requireTenantContext();
    const team = await this.prisma.team.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!team) throw new NotFoundException("Team not found.");
    return team;
  }

  // ---- Requisitions (open positions) ----

  async listRequisitions() {
    const ctx = requireTenantContext();
    const rows = await this.prisma.requisition.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, include: { org: false } });
    const deptIds = [...new Set(rows.map((r) => r.departmentId).filter((x): x is string => Boolean(x)))];
    const depts = deptIds.length ? await this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }) : [];
    const nameById = new Map(depts.map((d) => [d.id, d.name]));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      departmentId: r.departmentId,
      departmentName: r.departmentId ? (nameById.get(r.departmentId) ?? null) : null,
      openings: r.openings,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createRequisition(input: { title: string; departmentId?: string | null; openings?: number }) {
    const ctx = requireTenantContext();
    if (input.departmentId) await this.ensureDepartment(input.departmentId);
    return this.prisma.requisition.create({
      data: { orgId: ctx.orgId, title: input.title.trim(), departmentId: input.departmentId ?? null, openings: input.openings ?? 1 },
    });
  }

  async updateRequisition(id: string, input: { title?: string; openings?: number; status?: string; departmentId?: string | null }) {
    const ctx = requireTenantContext();
    const req = await this.prisma.requisition.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!req) throw new NotFoundException("Requisition not found.");
    if (input.departmentId) await this.ensureDepartment(input.departmentId);
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.openings !== undefined) data.openings = input.openings;
    if (input.status !== undefined) data.status = input.status;
    if (input.departmentId !== undefined) data.departmentId = input.departmentId;
    return this.prisma.requisition.update({ where: { id: req.id }, data });
  }

  // ---- Designations (job titles) ----

  async listDesignations() {
    const ctx = requireTenantContext();
    const rows = await this.prisma.designation.findMany({
      where: { orgId: ctx.orgId },
      orderBy: [{ status: "asc" }, { title: "asc" }],
      select: { id: true, title: true, level: true, status: true, departmentId: true, department: { select: { name: true } }, _count: { select: { employees: true } } },
    });
    return rows.map((d) => ({
      id: d.id,
      title: d.title,
      level: d.level,
      status: d.status,
      departmentId: d.departmentId,
      departmentName: d.department?.name ?? null,
      employeeCount: d._count.employees,
    }));
  }

  async createDesignation(input: { title: string; level?: string | null; departmentId?: string | null }) {
    const ctx = requireTenantContext();
    if (input.departmentId) await this.ensureDepartment(input.departmentId);
    return this.prisma.designation.create({
      data: { orgId: ctx.orgId, title: input.title.trim(), level: input.level?.trim() || null, departmentId: input.departmentId ?? null },
    });
  }

  async updateDesignation(id: string, input: { title?: string; level?: string | null; departmentId?: string | null; status?: string }) {
    const ctx = requireTenantContext();
    const found = await this.prisma.designation.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!found) throw new NotFoundException("Designation not found.");
    if (input.departmentId) await this.ensureDepartment(input.departmentId);
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.level !== undefined) data.level = input.level?.trim() || null;
    if (input.departmentId !== undefined) data.departmentId = input.departmentId;
    if (input.status !== undefined) data.status = input.status;
    return this.prisma.designation.update({ where: { id: found.id }, data });
  }

  async archiveDesignation(id: string) {
    const ctx = requireTenantContext();
    const found = await this.prisma.designation.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!found) throw new NotFoundException("Designation not found.");
    return this.prisma.designation.update({ where: { id: found.id }, data: { status: "ARCHIVED" } });
  }

  // ---- Shifts (work schedules) ----

  async listShifts() {
    const ctx = requireTenantContext();
    const rows = await this.prisma.shift.findMany({
      where: { orgId: ctx.orgId },
      orderBy: [{ status: "asc" }, { isDefault: "desc" }, { startMinute: "asc" }],
      select: { id: true, name: true, startMinute: true, endMinute: true, graceMinutes: true, workingDays: true, isDefault: true, status: true, _count: { select: { employees: true } } },
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      graceMinutes: s.graceMinutes,
      workingDays: s.workingDays,
      isDefault: s.isDefault,
      status: s.status,
      employeeCount: s._count.employees,
    }));
  }

  async createShift(input: { name: string; startMinute: number; endMinute: number; graceMinutes?: number; workingDays?: number[]; isDefault?: boolean }) {
    const ctx = requireTenantContext();
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.shift.updateMany({ where: { orgId: ctx.orgId, isDefault: true }, data: { isDefault: false } });
      return tx.shift.create({
        data: {
          orgId: ctx.orgId,
          name: input.name.trim(),
          startMinute: input.startMinute,
          endMinute: input.endMinute,
          graceMinutes: input.graceMinutes ?? 10,
          ...(input.workingDays ? { workingDays: input.workingDays } : {}),
          isDefault: input.isDefault ?? false,
        },
      });
    });
  }

  async updateShift(id: string, input: { name?: string; startMinute?: number; endMinute?: number; graceMinutes?: number; workingDays?: number[]; isDefault?: boolean; status?: string }) {
    const ctx = requireTenantContext();
    const found = await this.prisma.shift.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!found) throw new NotFoundException("Shift not found.");
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.shift.updateMany({ where: { orgId: ctx.orgId, isDefault: true, NOT: { id: found.id } }, data: { isDefault: false } });
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name.trim();
      if (input.startMinute !== undefined) data.startMinute = input.startMinute;
      if (input.endMinute !== undefined) data.endMinute = input.endMinute;
      if (input.graceMinutes !== undefined) data.graceMinutes = input.graceMinutes;
      if (input.workingDays !== undefined) data.workingDays = input.workingDays;
      if (input.isDefault !== undefined) data.isDefault = input.isDefault;
      if (input.status !== undefined) data.status = input.status;
      return tx.shift.update({ where: { id: found.id }, data });
    });
  }

  async archiveShift(id: string) {
    const ctx = requireTenantContext();
    const found = await this.prisma.shift.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!found) throw new NotFoundException("Shift not found.");
    if (found.isDefault) throw new ConflictException("Set another shift as default before archiving this one.");
    return this.prisma.shift.update({ where: { id: found.id }, data: { status: "ARCHIVED", isDefault: false } });
  }
}
