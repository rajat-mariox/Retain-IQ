import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";

type Proficiency = "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "EXPERT";

/**
 * Skills: an org-owned skill catalog plus per-employee skill edges (proficiency,
 * verification, endorsements). Employee scoping reuses the same ABAC gate the
 * documents service uses — a department/team-scoped manager can only touch skills
 * for employees in their reach; org-tier callers see everyone. Reads need
 * employee.read, writes employee.write.
 */
@Injectable()
export class SkillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
  ) {}

  /** Existence + ABAC scope for an employee. NotFound (not Forbidden) never leaks existence. */
  private async assertEmployee(orgId: string, employeeId: string, permission: string) {
    const ctx = requireTenantContext();
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true } });
    if (!e) throw new NotFoundException("Employee not found.");
    const scope = await this.accessScope.resolveScope(orgId, ctx.userId, permission);
    if (scope.tier === "org") return;
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    if (visible !== null && !visible.includes(employeeId)) throw new NotFoundException("Employee not found.");
  }

  // ---- Catalog (org taxonomy) ---------------------------------------------

  async listCatalog(includeArchived = false) {
    const ctx = requireTenantContext();
    const rows = await this.prisma.skillCatalog.findMany({
      where: { orgId: ctx.orgId, ...(includeArchived ? {} : { status: "ACTIVE" }) },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: { _count: { select: { employeeSkills: true } } },
    });
    return rows.map((s) => ({ id: s.id, name: s.name, category: s.category, description: s.description, status: s.status, holders: s._count.employeeSkills }));
  }

  async createSkill(input: { name: string; category?: string | null; description?: string | null }) {
    const ctx = requireTenantContext();
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Skill name is required.");
    try {
      return await this.prisma.skillCatalog.create({
        data: { orgId: ctx.orgId, name, category: input.category?.trim() || null, description: input.description?.trim() || null, createdBy: ctx.userId },
        select: { id: true, name: true, category: true },
      });
    } catch {
      throw new ConflictException("A skill with that name already exists.");
    }
  }

  async updateSkill(id: string, input: { name?: string; category?: string | null; description?: string | null; status?: string }) {
    const ctx = requireTenantContext();
    const found = await this.prisma.skillCatalog.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!found) throw new NotFoundException("Skill not found.");
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.category !== undefined) data.category = input.category?.trim() || null;
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.status !== undefined && ["ACTIVE", "ARCHIVED"].includes(input.status)) data.status = input.status;
    return this.prisma.skillCatalog.update({ where: { id: found.id }, data, select: { id: true, name: true, status: true } });
  }

  // ---- Employee skills -----------------------------------------------------

  async listForEmployee(employeeId: string) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId, permissions.employeeRead);
    const rows = await this.prisma.employeeSkill.findMany({
      where: { orgId: ctx.orgId, employeeId },
      orderBy: [{ verification: "asc" }, { proficiency: "desc" }],
      include: { skill: { select: { name: true, category: true } } },
    });
    return rows.map((r) => ({
      id: r.id, skillId: r.skillId, name: r.skill.name, category: r.skill.category,
      proficiency: r.proficiency, yearsOfExp: r.yearsOfExp, verification: r.verification,
      verifiedAt: r.verifiedAt?.toISOString() ?? null, endorsements: r.endorsements,
      lastAssessedAt: r.lastAssessedAt?.toISOString() ?? null, note: r.note,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Attach a skill to an employee. If skillId is absent but a name is given, the
   *  catalog entry is created/reused first, so managers can add on the fly. */
  async addForEmployee(employeeId: string, input: { skillId?: string; skillName?: string; category?: string; proficiency?: Proficiency; yearsOfExp?: number; note?: string }) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId, permissions.employeeWrite);

    let skillId = input.skillId;
    if (!skillId) {
      const name = input.skillName?.trim();
      if (!name) throw new BadRequestException("Provide a skill to add.");
      const existing = await this.prisma.skillCatalog.findFirst({ where: { orgId: ctx.orgId, name }, select: { id: true } });
      skillId = existing?.id ?? (await this.prisma.skillCatalog.create({ data: { orgId: ctx.orgId, name, category: input.category?.trim() || null, createdBy: ctx.userId }, select: { id: true } })).id;
    } else {
      const s = await this.prisma.skillCatalog.findFirst({ where: { id: skillId, orgId: ctx.orgId }, select: { id: true } });
      if (!s) throw new NotFoundException("Skill not found.");
    }

    try {
      const row = await this.prisma.employeeSkill.create({
        data: {
          orgId: ctx.orgId, employeeId, skillId,
          proficiency: input.proficiency ?? "INTERMEDIATE",
          yearsOfExp: input.yearsOfExp ?? null,
          note: input.note?.trim() || null,
          createdBy: ctx.userId,
        },
        select: { id: true },
      });
      return { id: row.id };
    } catch {
      throw new ConflictException("That skill is already on this employee.");
    }
  }

  async updateEmployeeSkill(employeeSkillId: string, input: { proficiency?: Proficiency; yearsOfExp?: number | null; note?: string | null }) {
    const ctx = requireTenantContext();
    const row = await this.prisma.employeeSkill.findFirst({ where: { id: employeeSkillId, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Skill entry not found.");
    await this.assertEmployee(ctx.orgId, row.employeeId, permissions.employeeWrite);
    const data: Record<string, unknown> = { lastAssessedAt: new Date() };
    if (input.proficiency) data.proficiency = input.proficiency;
    if (input.yearsOfExp !== undefined) data.yearsOfExp = input.yearsOfExp;
    if (input.note !== undefined) data.note = input.note?.trim() || null;
    return this.prisma.employeeSkill.update({ where: { id: row.id }, data, select: { id: true } });
  }

  /** Verify or reject a self-declared skill (a manager/HR sign-off). */
  async verifyEmployeeSkill(employeeSkillId: string, approve: boolean) {
    const ctx = requireTenantContext();
    const row = await this.prisma.employeeSkill.findFirst({ where: { id: employeeSkillId, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Skill entry not found.");
    await this.assertEmployee(ctx.orgId, row.employeeId, permissions.employeeWrite);
    return this.prisma.employeeSkill.update({
      where: { id: row.id },
      data: { verification: approve ? "VERIFIED" : "REJECTED", verifiedBy: ctx.userId, verifiedAt: new Date() },
      select: { id: true, verification: true },
    });
  }

  async endorseEmployeeSkill(employeeSkillId: string) {
    const ctx = requireTenantContext();
    const row = await this.prisma.employeeSkill.findFirst({ where: { id: employeeSkillId, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Skill entry not found.");
    await this.assertEmployee(ctx.orgId, row.employeeId, permissions.employeeRead);
    return this.prisma.employeeSkill.update({ where: { id: row.id }, data: { endorsements: { increment: 1 } }, select: { id: true, endorsements: true } });
  }

  async removeEmployeeSkill(employeeSkillId: string) {
    const ctx = requireTenantContext();
    const row = await this.prisma.employeeSkill.findFirst({ where: { id: employeeSkillId, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Skill entry not found.");
    await this.assertEmployee(ctx.orgId, row.employeeId, permissions.employeeWrite);
    await this.prisma.employeeSkill.delete({ where: { id: row.id } });
    return { ok: true };
  }
}
