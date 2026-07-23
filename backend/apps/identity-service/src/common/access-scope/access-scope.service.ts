import { Injectable } from "@nestjs/common";
import type { Prisma } from "@retainiq/database/identity";
import { PrismaService } from "../database/prisma.service.js";

const NIL = "00000000-0000-0000-0000-000000000000"; // matches nothing

export type ScopeTier = "org" | "scoped" | "self";

export interface AccessScope {
  tier: ScopeTier;
  departmentIds: string[];
  teamIds: string[];
  employeeId: string | null; // the caller's own employee record
}

/**
 * The ABAC engine. Turns a user's role grants into the data breadth they may see
 * for a given permission: org-wide / a set of departments+teams / just themselves.
 * Replaces hardcoded role-name checks. Filters are applied at the DB query (no
 * post-filtering) so this scales to 100k+ employees per org.
 *
 * Rule: the WIDEST scope among the user's active grants that include the relevant
 * permission wins. ORG > DEPARTMENT/TEAM (scoped) > SELF. A scoped manager also
 * sees their own record and direct reports (Employee.managerId).
 */
@Injectable()
export class AccessScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveScope(orgId: string, userId: string, permission: string): Promise<AccessScope> {
    const [membership, grants] = await Promise.all([
      this.prisma.organizationMembership.findFirst({ where: { orgId, userId, status: "ACTIVE" }, select: { employeeId: true } }),
      this.prisma.roleAssignment.findMany({
        where: { orgId, userId, status: "ACTIVE" },
        select: { scopeType: true, scopeId: true, role: { select: { permissions: true } } },
      }),
    ]);
    const employeeId = membership?.employeeId ?? null;
    const relevant = grants.filter((g) => (g.role.permissions).includes(permission));

    if (relevant.some((g) => g.scopeType === "ORG")) {
      return { tier: "org", departmentIds: [], teamIds: [], employeeId };
    }
    const departmentIds = [...new Set(relevant.filter((g) => g.scopeType === "DEPARTMENT" && g.scopeId).map((g) => g.scopeId as string))];
    const teamIds = [...new Set(relevant.filter((g) => g.scopeType === "TEAM" && g.scopeId).map((g) => g.scopeId as string))];
    if (departmentIds.length > 0 || teamIds.length > 0) {
      return { tier: "scoped", departmentIds, teamIds, employeeId };
    }
    return { tier: "self", departmentIds: [], teamIds: [], employeeId };
  }

  /** Prisma where-fragment to filter the Employee table by this scope. */
  employeeWhere(scope: AccessScope): Prisma.EmployeeWhereInput {
    if (scope.tier === "org") return {};
    if (scope.tier === "self") return { id: scope.employeeId ?? NIL };
    const or: Prisma.EmployeeWhereInput[] = [];
    if (scope.departmentIds.length > 0) or.push({ departmentId: { in: scope.departmentIds } });
    if (scope.teamIds.length > 0) or.push({ teamId: { in: scope.teamIds } });
    if (scope.employeeId) {
      or.push({ id: scope.employeeId }); // their own record
      or.push({ managerId: scope.employeeId }); // their direct reports
    }
    return or.length > 0 ? { OR: or } : { id: NIL };
  }

  /**
   * Concrete set of employee ids the scope can see — for resources keyed by
   * employeeId (e.g. screenshots). null = unrestricted (org tier).
   */
  async visibleEmployeeIds(orgId: string, scope: AccessScope): Promise<string[] | null> {
    if (scope.tier === "org") return null;
    if (scope.tier === "self") return scope.employeeId ? [scope.employeeId] : [];
    const rows = await this.prisma.employee.findMany({ where: { orgId, ...this.employeeWhere(scope) }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /**
   * The set of team ids a scope reaches: teams granted directly, plus every team
   * under a granted department. Used to scope resources (projects) that hang off
   * a team rather than an employee.
   */
  async reachableTeamIds(orgId: string, scope: AccessScope): Promise<string[]> {
    const ids = new Set(scope.teamIds);
    if (scope.departmentIds.length > 0) {
      const teams = await this.prisma.team.findMany({
        where: { orgId, departmentId: { in: scope.departmentIds } },
        select: { id: true },
      });
      teams.forEach((t) => ids.add(t.id));
    }
    return [...ids];
  }

  /**
   * Prisma where-fragment to filter Projects by this scope. A scoped manager
   * reaches a project when its team is in their departments/teams, or they own
   * it, or one of their reachable employees owns it. org → no filter; self →
   * only projects they personally own (a plain member's manage reach is none).
   */
  async projectWhere(orgId: string, scope: AccessScope): Promise<Prisma.ProjectWhereInput> {
    if (scope.tier === "org") return {};
    if (scope.tier === "self") return { ownerEmployeeId: scope.employeeId ?? NIL };

    const [teamIds, ownerIds] = await Promise.all([
      this.reachableTeamIds(orgId, scope),
      this.visibleEmployeeIds(orgId, scope),
    ]);
    const or: Prisma.ProjectWhereInput[] = [];
    if (teamIds.length > 0) or.push({ teamId: { in: teamIds } });
    if (ownerIds && ownerIds.length > 0) or.push({ ownerEmployeeId: { in: ownerIds } });
    return or.length > 0 ? { OR: or } : { id: NIL };
  }
}
