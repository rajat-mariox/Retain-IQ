import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";
import { allPermissions, permissions, type Permission } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { PermissionBundleService } from "../../common/security/permission-bundle.service.js";
import { ensureSystemRoles } from "../../common/security/roles.util.js";

type ScopeType = "ORG" | "DEPARTMENT" | "TEAM" | "SELF";

interface CreateGrantInput {
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId?: string | null;
}

interface RoleInput {
  name: string;
  description?: string | null;
  permissions: string[];
}

const KNOWN_PERMISSIONS = new Set<string>(allPermissions);

/**
 * Every permission described the way a non-technical admin would read it,
 * grouped by area. `key` is the real permission string sent back to the API;
 * `label`/`hint` are what the UI shows. Kept here so the wording lives with the
 * permissions themselves and stays in one place.
 */
const PERMISSION_CATALOG: {
  group: string;
  items: { key: string; label: string; hint: string }[];
}[] = [
  {
    group: "People",
    items: [
      { key: permissions.employeeRead, label: "See the team directory", hint: "View the list of people and their details." },
      { key: permissions.employeeWrite, label: "Add & edit people", hint: "Add new members and change employee details." },
    ],
  },
  {
    group: "Attendance & Time",
    items: [
      { key: permissions.attendanceRead, label: "See attendance", hint: "View who's checked in, hours and the roster." },
      { key: permissions.attendanceApprove, label: "Approve attendance fixes & overtime", hint: "Decide on correction requests and sign off overtime." },
    ],
  },
  {
    group: "Projects",
    items: [
      { key: permissions.projectRead, label: "See projects", hint: "View projects, tasks and boards." },
      { key: permissions.projectWrite, label: "Manage projects", hint: "Create and edit projects, tasks and teams." },
    ],
  },
  {
    group: "Monitoring & Screenshots",
    items: [
      { key: permissions.screenshotsRead, label: "See screenshots", hint: "View captured screenshots." },
      { key: permissions.screenshotsDownload, label: "Download screenshots", hint: "Save screenshots to your device." },
      { key: permissions.screenshotsDelete, label: "Delete screenshots", hint: "Remove captured screenshots." },
      { key: permissions.aiRiskRead, label: "See AI risk insights", hint: "View burnout and engagement signals." },
    ],
  },
  {
    group: "Payroll",
    items: [
      { key: permissions.payrollRead, label: "See payroll & salaries", hint: "View pay runs and what people are paid." },
      { key: permissions.payrollApprove, label: "Run & approve payroll", hint: "Start pay runs and approve them." },
    ],
  },
  {
    group: "Company Administration",
    items: [
      { key: permissions.billingManage, label: "Manage billing & subscription", hint: "Change the plan and payment details." },
      { key: permissions.securityManage, label: "Manage roles & access", hint: "Create roles and decide who can do what." },
      { key: permissions.auditRead, label: "See the audit log", hint: "View the record of who did what, for compliance." },
    ],
  },
];

/**
 * A custom role must include at least one real permission, and every permission
 * must be one the platform actually defines — you can pick from the known set,
 * you can't invent new access. Returns the cleaned, de-duplicated list.
 */
function validatePermissions(input: string[]): Permission[] {
  const cleaned = [...new Set(input)];
  if (cleaned.length === 0) throw new BadRequestException("Pick at least one thing this role can do.");
  const unknown = cleaned.filter((p) => !KNOWN_PERMISSIONS.has(p));
  if (unknown.length > 0) throw new BadRequestException(`These access options aren't recognised: ${unknown.join(", ")}.`);
  return cleaned as Permission[];
}

/**
 * Multi-grant RBAC management: roles catalog + per-user role grants (role @ scope).
 * Effective permissions are the union of a user's active grants (resolved by
 * PermissionBundleService); changing a grant busts that user's cached bundle.
 */
@Injectable()
export class RbacService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bundles: PermissionBundleService,
  ) {}

  /**
   * Re-sync every org's built-in Owner/Manager/Employee roles to the current
   * definitions on boot. ensureSystemRoles upserts by (orgId, name) and rewrites
   * the permission set, so a change to what a built-in role includes (e.g.
   * removing payroll from Manager) propagates to organizations that already
   * exist, not just newly-created ones. Cached bundles then refresh within their
   * 60s TTL. Idempotent and safe to run every start-up.
   */
  async onModuleInit(): Promise<void> {
    const orgs = await this.prisma.organization.findMany({ select: { id: true } });
    for (const org of orgs) {
      await this.prisma.$transaction((tx) => ensureSystemRoles(tx, org.id));
    }
  }

  /**
   * The catalog of things a role can be allowed to do, in plain language and
   * grouped by area, so an admin building a role picks from readable options
   * ("See who's in the company") rather than raw permission strings
   * ("employee.read"). Groups drive the section headings in the UI.
   */
  listPermissionCatalog() {
    return PERMISSION_CATALOG;
  }

  async listRoles() {
    const ctx = requireTenantContext();
    const roles = await this.prisma.role.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] });
    // Count how many people hold each role, so the UI can warn before deleting a
    // role that's in use (and disable delete when it is).
    const counts = await this.prisma.roleAssignment.groupBy({
      by: ["roleId"],
      where: { orgId: ctx.orgId, status: "ACTIVE" },
      _count: { _all: true },
    });
    const inUse = new Map(counts.map((c) => [c.roleId, c._count._all]));
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions,
      permissionCount: r.permissions.length,
      assignedCount: inUse.get(r.id) ?? 0,
    }));
  }

  /**
   * Create a custom role for this org — a named set of the permissions the
   * platform defines. Built-in roles are seeded separately; these are the ones
   * an admin authors (e.g. "Finance", "HR").
   */
  async createRole(input: RoleInput) {
    const ctx = requireTenantContext();
    const name = input.name.trim();
    if (name.length < 2) throw new BadRequestException("Give the role a name (at least 2 characters).");
    const perms = validatePermissions(input.permissions);

    const clash = await this.prisma.role.findFirst({ where: { orgId: ctx.orgId, name } });
    if (clash) throw new ConflictException("A role with that name already exists.");

    const role = await this.prisma.role.create({
      data: { orgId: ctx.orgId, name, description: input.description?.trim() || null, permissions: perms, isSystem: false },
    });
    return { id: role.id, name: role.name, description: role.description, isSystem: role.isSystem, permissions: role.permissions };
  }

  /**
   * Edit a custom role's name / description / permissions. Built-in roles are
   * locked — they're re-synced from code on boot, so an edit here wouldn't
   * stick and could confuse. Bumps version and clears the cached bundle of
   * everyone holding the role, so the change takes effect at once.
   */
  async updateRole(id: string, input: Partial<RoleInput>) {
    const ctx = requireTenantContext();
    const role = await this.prisma.role.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!role) throw new NotFoundException("Role not found.");
    if (role.isSystem) throw new ForbiddenException("The built-in Owner, Manager and Employee roles can't be edited.");

    const data: { name?: string; description?: string | null; permissions?: Permission[]; version?: number } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 2) throw new BadRequestException("Give the role a name (at least 2 characters).");
      const clash = await this.prisma.role.findFirst({ where: { orgId: ctx.orgId, name, id: { not: id } } });
      if (clash) throw new ConflictException("A role with that name already exists.");
      data.name = name;
    }
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.permissions !== undefined) {
      data.permissions = validatePermissions(input.permissions);
      data.version = role.version + 1; // signal that effective access changed
    }

    const updated = await this.prisma.role.update({ where: { id: role.id }, data });
    if (input.permissions !== undefined) await this.bundles.invalidateRole(ctx.orgId, role.id);
    return { id: updated.id, name: updated.name, description: updated.description, isSystem: updated.isSystem, permissions: updated.permissions };
  }

  /**
   * Delete a custom role. Blocked for built-in roles, and blocked while anyone
   * still holds it — deleting a role out from under people would silently strip
   * their access. The caller must reassign those people first.
   */
  async deleteRole(id: string) {
    const ctx = requireTenantContext();
    const role = await this.prisma.role.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!role) throw new NotFoundException("Role not found.");
    if (role.isSystem) throw new ForbiddenException("The built-in Owner, Manager and Employee roles can't be deleted.");

    const [grantCount, memberCount] = await Promise.all([
      this.prisma.roleAssignment.count({ where: { orgId: ctx.orgId, roleId: id, status: "ACTIVE" } }),
      this.prisma.organizationMembership.count({ where: { orgId: ctx.orgId, roleId: id, status: "ACTIVE" } }),
    ]);
    const total = grantCount + memberCount;
    if (total > 0) {
      throw new ConflictException(`This role is still assigned to ${total} ${total === 1 ? "person" : "people"}. Move them to another role before deleting it.`);
    }

    // No one holds the role now, but past grants that were REVOKED are still on
    // record and reference it, which would block the delete on a foreign key.
    // Those rows are only history, so clear them alongside the role.
    await this.prisma.$transaction([
      this.prisma.roleAssignment.deleteMany({ where: { orgId: ctx.orgId, roleId: id } }),
      this.prisma.role.delete({ where: { id: role.id } }),
    ]);
    return { id: role.id, deleted: true };
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

    // A prior grant for this exact (user, role, scope) may still be on file —
    // ACTIVE (a real duplicate) or REVOKED (revoked earlier). The unique index
    // spans (orgId, userId, roleId, scopeType, scopeId) and ignores status, so a
    // plain create would collide with a leftover REVOKED row. Look the row up and
    // decide: reject a live duplicate, reactivate a revoked one.
    const prior = await this.prisma.roleAssignment.findFirst({
      where: { orgId: ctx.orgId, userId: input.userId, roleId: input.roleId, scopeType: input.scopeType, scopeId },
    });
    if (prior?.status === "ACTIVE") {
      throw new ConflictException("This role is already granted at that scope.");
    }

    const grant = prior
      ? await this.prisma.roleAssignment.update({
          where: { id: prior.id },
          data: { status: "ACTIVE", createdBy: ctx.userId },
        })
      : await this.prisma.roleAssignment.create({
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
