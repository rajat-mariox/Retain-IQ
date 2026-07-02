import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { PermissionBundleService } from "../../common/security/permission-bundle.service.js";

type ScopeType = "ORG" | "DEPARTMENT" | "TEAM" | "SELF";

interface CreateGrantInput {
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId?: string | null;
}

/**
 * Multi-grant RBAC management: roles catalog + per-user role grants (role @ scope).
 * Effective permissions are the union of a user's active grants (resolved by
 * PermissionBundleService); changing a grant busts that user's cached bundle.
 */
@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bundles: PermissionBundleService,
  ) {}

  async listRoles() {
    const ctx = requireTenantContext();
    const roles = await this.prisma.role.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] });
    return roles.map((r) => ({ id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, permissionCount: r.permissions.length }));
  }

  /** Members with access + their active role grants (scope-labelled). Searchable. */
  async listAccess(query: { page: number; pageSize: number; q?: string }) {
    const ctx = requireTenantContext();
    const q = query.q?.trim();
    const where = {
      orgId: ctx.orgId,
      status: "ACTIVE" as const,
      ...(q
        ? {
            OR: [
              { user: { email: { contains: q, mode: "insensitive" as const } } },
              { employee: { firstName: { contains: q, mode: "insensitive" as const } } },
              { employee: { lastName: { contains: q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };
    const [members, total] = await this.prisma.$transaction([
      this.prisma.organizationMembership.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { userId: true, user: { select: { email: true } }, employee: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.organizationMembership.count({ where }),
    ]);

    const userIds = members.map((m) => m.userId);
    const grants = userIds.length
      ? await this.prisma.roleAssignment.findMany({
          where: { orgId: ctx.orgId, userId: { in: userIds }, status: "ACTIVE" },
          select: { id: true, userId: true, scopeType: true, scopeId: true, role: { select: { id: true, name: true } } },
        })
      : [];

    // Resolve scope labels (department / team names).
    const scopeIds = [...new Set(grants.map((g) => g.scopeId).filter((x): x is string => Boolean(x)))];
    const [depts, teams] = scopeIds.length
      ? await Promise.all([
          this.prisma.department.findMany({ where: { id: { in: scopeIds } }, select: { id: true, name: true } }),
          this.prisma.team.findMany({ where: { id: { in: scopeIds } }, select: { id: true, name: true } }),
        ])
      : [[], []];
    const nameById = new Map<string, string>([...depts, ...teams].map((x) => [x.id, x.name]));
    const scopeLabel = (t: string, id: string | null) =>
      t === "ORG" ? "Organization" : t === "SELF" ? "Self" : id ? (nameById.get(id) ?? "—") : "—";

    const byUser = new Map<string, { id: string; roleId: string; roleName: string; scopeType: string; scopeLabel: string }[]>();
    for (const g of grants) {
      const list = byUser.get(g.userId) ?? [];
      list.push({ id: g.id, roleId: g.role.id, roleName: g.role.name, scopeType: g.scopeType, scopeLabel: scopeLabel(g.scopeType, g.scopeId) });
      byUser.set(g.userId, list);
    }

    const items = members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.employee ? `${m.employee.firstName} ${m.employee.lastName}`.trim() : null,
      grants: byUser.get(m.userId) ?? [],
    }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async createGrant(input: CreateGrantInput) {
    const ctx = requireTenantContext();

    const membership = await this.prisma.organizationMembership.findFirst({
      where: { orgId: ctx.orgId, userId: input.userId, status: "ACTIVE" },
      select: { employeeId: true },
    });
    if (!membership) throw new NotFoundException("That user is not a member of this organization.");

    const role = await this.prisma.role.findFirst({ where: { id: input.roleId, orgId: ctx.orgId } });
    if (!role) throw new NotFoundException("Role not found.");

    // Normalise + validate scope.
    let scopeId: string | null = null;
    if (input.scopeType === "DEPARTMENT" || input.scopeType === "TEAM") {
      if (!input.scopeId) throw new BadRequestException(`A ${input.scopeType.toLowerCase()} must be selected for this scope.`);
      const target =
        input.scopeType === "DEPARTMENT"
          ? await this.prisma.department.findFirst({ where: { id: input.scopeId, orgId: ctx.orgId } })
          : await this.prisma.team.findFirst({ where: { id: input.scopeId, orgId: ctx.orgId } });
      if (!target) throw new NotFoundException(`${input.scopeType === "DEPARTMENT" ? "Department" : "Team"} not found.`);
      scopeId = input.scopeId;
    }

    // Dedupe (the unique index can't catch null scopeId for ORG/SELF).
    const existing = await this.prisma.roleAssignment.findFirst({
      where: { orgId: ctx.orgId, userId: input.userId, roleId: input.roleId, scopeType: input.scopeType, scopeId, status: "ACTIVE" },
    });
    if (existing) throw new ConflictException("This role is already granted at that scope.");

    const grant = await this.prisma.roleAssignment.create({
      data: {
        orgId: ctx.orgId,
        userId: input.userId,
        employeeId: membership.employeeId,
        roleId: input.roleId,
        scopeType: input.scopeType,
        scopeId,
        createdBy: ctx.userId,
      },
    });
    await this.bundles.invalidate(ctx.orgId, input.userId); // effective permissions changed
    return grant;
  }

  async revokeGrant(id: string) {
    const ctx = requireTenantContext();
    const grant = await this.prisma.roleAssignment.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!grant) throw new NotFoundException("Grant not found.");
    await this.prisma.roleAssignment.update({ where: { id: grant.id }, data: { status: "REVOKED" } });
    await this.bundles.invalidate(ctx.orgId, grant.userId);
    return { id: grant.id, revoked: true };
  }
}
