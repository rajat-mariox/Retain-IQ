import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { PermissionBundleService } from "../../common/security/permission-bundle.service.js";

type Visibility = "MANAGER_ONLY" | "HR_ONLY" | "HR_AND_MANAGER" | "EMPLOYEE_VISIBLE" | "ADMIN_ONLY";

/** The viewer's relationship to the employee a remark is about. */
interface Relationship {
  isAuthorOf: (createdBy: string | null) => boolean;
  isManager: boolean; // the employee's own manager (or an org-tier employee.write holder)
  isHR: boolean; // holds payroll perms (HR/people-ops proxy)
  isAdmin: boolean; // Owner / org-wide employee.write
  isSelf: boolean; // the caller IS this employee
}

/**
 * Manager/HR remarks with first-class visibility. A remark is only ever returned
 * to a viewer whose relationship to the employee satisfies its visibility level —
 * the filtering happens on the server, so a private remark never leaves the API.
 * Creating requires employee.write within the caller's ABAC reach.
 */
@Injectable()
export class RemarkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly bundles: PermissionBundleService,
  ) {}

  private async assertWritable(orgId: string, employeeId: string) {
    const ctx = requireTenantContext();
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true } });
    if (!e) throw new NotFoundException("Employee not found.");
    const scope = await this.accessScope.resolveScope(orgId, ctx.userId, permissions.employeeWrite);
    if (scope.tier === "org") return;
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    if (visible !== null && !visible.includes(employeeId)) throw new NotFoundException("Employee not found.");
  }

  /** Resolve the caller's relationship to the subject employee, once per request. */
  private async relationshipTo(orgId: string, userId: string, employeeId: string): Promise<Relationship> {
    const [bundle, membership, employee] = await Promise.all([
      this.bundles.resolve(orgId, userId),
      this.prisma.organizationMembership.findFirst({ where: { orgId, userId, status: "ACTIVE" }, select: { employeeId: true } }),
      this.prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } }),
    ]);
    const held = new Set(bundle?.permissions ?? []);
    const isHR = held.has(permissions.payrollApprove) || held.has(permissions.payrollRead);
    // Admin = org-wide employee.write (Owner or an org-tier grant).
    const writeScope = await this.accessScope.resolveScope(orgId, userId, permissions.employeeWrite);
    const isAdmin = requireTenantContext().role === "Owner" || writeScope.tier === "org";
    const callerEmployeeId = membership?.employeeId ?? null;
    const isManager = isAdmin || (callerEmployeeId !== null && employee?.managerId === callerEmployeeId);
    const isSelf = callerEmployeeId !== null && callerEmployeeId === employeeId;
    return { isAuthorOf: (createdBy) => createdBy !== null && createdBy === userId, isManager, isHR, isAdmin, isSelf };
  }

  /** Whether a viewer with this relationship may see a remark of this visibility. */
  private canView(v: Visibility, rel: Relationship, createdBy: string | null): boolean {
    if (rel.isAdmin || rel.isAuthorOf(createdBy)) return true; // owner/admin & author always
    switch (v) {
      case "MANAGER_ONLY": return rel.isManager;
      case "HR_ONLY": return rel.isHR;
      case "HR_AND_MANAGER": return rel.isHR || rel.isManager;
      case "EMPLOYEE_VISIBLE": return rel.isManager || rel.isHR || rel.isSelf;
      case "ADMIN_ONLY": return false; // only admin/author, handled above
    }
  }

  async create(employeeId: string, input: { content: string; visibility?: Visibility; reason?: string }) {
    const ctx = requireTenantContext();
    await this.assertWritable(ctx.orgId, employeeId);
    const content = input.content.trim();
    if (!content) throw new BadRequestException("A remark can't be empty.");
    const author = await this.prisma.organizationMembership.findFirst({ where: { orgId: ctx.orgId, userId: ctx.userId }, select: { user: { select: { email: true } } } });
    const row = await this.prisma.employeeRemark.create({
      data: {
        orgId: ctx.orgId, employeeId, content,
        visibility: input.visibility ?? "MANAGER_ONLY",
        reason: input.reason?.trim() || null,
        createdBy: ctx.userId,
        createdByName: author?.user?.email ?? null,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  /** List the remarks the caller is authorized to see for this employee. */
  async listForEmployee(employeeId: string) {
    const ctx = requireTenantContext();
    // Must at least be able to read the employee.
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId: ctx.orgId }, select: { id: true } });
    if (!e) throw new NotFoundException("Employee not found.");
    const readScope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, permissions.employeeRead);
    if (readScope.tier !== "org") {
      const visible = await this.accessScope.visibleEmployeeIds(ctx.orgId, readScope);
      const rel0 = await this.relationshipTo(ctx.orgId, ctx.userId, employeeId);
      // A self-viewer (the employee) may still fetch their own EMPLOYEE_VISIBLE remarks
      // even without employee.read scope on themselves.
      if (visible !== null && !visible.includes(employeeId) && !rel0.isSelf) throw new NotFoundException("Employee not found.");
    }

    const rel = await this.relationshipTo(ctx.orgId, ctx.userId, employeeId);
    const rows = await this.prisma.employeeRemark.findMany({ where: { orgId: ctx.orgId, employeeId }, orderBy: { createdAt: "desc" } });
    return rows
      .filter((r) => this.canView(r.visibility as Visibility, rel, r.createdBy))
      .map((r) => ({
        id: r.id, visibility: r.visibility, reason: r.reason, content: r.content,
        createdByName: r.createdByName, createdBy: r.createdBy,
        canDelete: rel.isAdmin || (r.createdBy !== null && r.createdBy === ctx.userId),
        createdAt: r.createdAt.toISOString(),
      }));
  }

  async remove(remarkId: string) {
    const ctx = requireTenantContext();
    const r = await this.prisma.employeeRemark.findFirst({ where: { id: remarkId, orgId: ctx.orgId } });
    if (!r) throw new NotFoundException("Remark not found.");
    const rel = await this.relationshipTo(ctx.orgId, ctx.userId, r.employeeId);
    if (!(rel.isAdmin || rel.isAuthorOf(r.createdBy))) throw new ForbiddenException("You can only delete your own remarks.");
    await this.prisma.employeeRemark.delete({ where: { id: r.id } });
    return { ok: true };
  }
}
