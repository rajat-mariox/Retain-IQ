import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { allPermissions, employeePermissions, managerPermissions } from "@retainiq/authz";
import type {
  AccessTokenClaims,
  AuthTokens,
  ChangePasswordInput,
  LoginInput,
  LoginResult,
  MembershipSummary,
  RegisterOrgInput,
} from "@retainiq/contracts";
import { AuditService } from "../../common/audit/audit.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { hashPassword, verifyPassword } from "../../common/crypto/password.util.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { TokenService } from "./token.service.js";

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Bootstraps a new organization with an Owner role (all permissions), the
   * founding user, an employee record, and an active membership — all in one
   * transaction — then issues the first token pair.
   */
  async register(input: RegisterOrgInput): Promise<AuthTokens> {
    const email = input.email.toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException("An account with this email already exists.");
    }

    const passwordHash = await hashPassword(input.password);
    const slug = await this.generateUniqueSlug(input.orgName);

    const { claims, orgId, userId } = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: input.orgName, slug },
      });

      const role = await tx.role.create({
        data: {
          orgId: org.id,
          name: "Owner",
          description: "Full administrative access.",
          permissions: allPermissions,
          isSystem: true,
        },
      });

      // Seed the rest of the role hierarchy so admins can assign Manager/Employee.
      await tx.role.createMany({
        data: [
          { orgId: org.id, name: "Manager", description: "Manage team, projects and attendance.", permissions: managerPermissions, isSystem: true },
          { orgId: org.id, name: "Employee", description: "Standard employee access.", permissions: employeePermissions, isSystem: true },
        ],
        skipDuplicates: true,
      });

      const user = await tx.user.create({
        data: { email, passwordHash },
      });

      const employee = await tx.employee.create({
        data: {
          orgId: org.id,
          email,
          firstName: input.firstName,
          lastName: input.lastName,
          createdBy: user.id,
        },
      });

      const membership = await tx.organizationMembership.create({
        data: {
          orgId: org.id,
          userId: user.id,
          employeeId: employee.id,
          roleId: role.id,
          status: "ACTIVE",
        },
      });

      await this.outbox.enqueue(tx, {
        eventType: "org.registered",
        aggregateType: "organization",
        aggregateId: org.id,
        orgId: org.id,
        actorUserId: user.id,
        payload: { orgId: org.id, orgName: org.name, ownerUserId: user.id, ownerEmail: email },
      });

      // Project the owner membership to downstream read models (notifications
      // resolves recipients from its local copy — no cross-service DB reads).
      await this.outbox.enqueue(tx, {
        eventType: "org.member.upserted",
        aggregateType: "organizationMembership",
        aggregateId: membership.id,
        orgId: org.id,
        actorUserId: user.id,
        payload: { orgId: org.id, userId: user.id, roleName: role.name, status: membership.status },
      });

      const claims: AccessTokenClaims = {
        sub: user.id,
        orgId: org.id,
        membershipId: membership.id,
        role: role.name,
        permissionsVersion: role.version,
      };

      return { claims, orgId: org.id, userId: user.id };
    });

    const tokens = await this.tokenService.issue(claims);
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "auth.org.registered",
      resourceType: "organization",
      resourceId: orgId,
    });
    return tokens;
  }

  /**
   * Authenticates a user. If they belong to exactly one active org (or selected
   * one via `orgId`), issues tokens. If they belong to several and none was
   * chosen, returns the membership list so the client can pick.
   */
  async login(input: LoginInput): Promise<LoginResult> {
    const email = input.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Verify even when the user is missing/disabled to keep timing uniform.
    const valid = await verifyPassword(input.password, user?.passwordHash ?? "");
    if (!user || !valid || user.status !== "ACTIVE") {
      throw new UnauthorizedException("Invalid email or password.");
    }

    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE",
        // Suspended/deleted orgs cannot be logged into (platform-admin gate).
        org: { status: "ACTIVE" },
        ...(input.orgId ? { orgId: input.orgId } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        orgId: true,
        org: { select: { name: true, slug: true } },
        role: { select: { name: true, version: true } },
      },
    });

    if (memberships.length === 0) {
      throw new UnauthorizedException(
        input.orgId ? "No active membership in the selected organization." : "No active organization membership.",
      );
    }

    if (memberships.length > 1) {
      const summaries: MembershipSummary[] = memberships.map((m) => ({
        membershipId: m.id,
        orgId: m.orgId,
        orgName: m.org.name,
        orgSlug: m.org.slug,
        role: m.role.name,
      }));
      return { requiresOrgSelection: true, memberships: summaries };
    }

    const membership = memberships[0]!;
    const claims: AccessTokenClaims = {
      sub: user.id,
      orgId: membership.orgId,
      membershipId: membership.id,
      role: membership.role.name,
      permissionsVersion: membership.role.version,
    };

    const tokens = await this.tokenService.issue(claims);
    await this.audit.record({
      orgId: claims.orgId,
      actorUserId: user.id,
      action: "auth.login.succeeded",
      resourceType: "user",
      resourceId: user.id,
    });
    return tokens;
  }

  /** Rotates a refresh token, re-reading fresh role/permissions from the DB. */
  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const consumed = await this.tokenService.verifyAndConsume(rawRefreshToken);
    if (!consumed.membershipId || !consumed.orgId) {
      throw new UnauthorizedException("Refresh session is not bound to a tenant.");
    }

    const claims = await this.resolveClaimsForMembership(consumed.membershipId);
    return this.tokenService.issue(claims);
  }

  /** Single-session logout: revokes the refresh session and denylists its access token. */
  async logout(rawRefreshToken: string): Promise<void> {
    const revoked = await this.tokenService.revoke(rawRefreshToken);
    if (revoked?.orgId) {
      await this.audit.record({
        orgId: revoked.orgId,
        actorUserId: revoked.userId,
        action: "auth.logout",
        resourceType: "session",
        resourceId: revoked.userId,
      });
    }
  }

  /** Logout everywhere: revokes all of the user's active sessions and access tokens. */
  async logoutAll(userId: string, orgId: string): Promise<void> {
    const count = await this.tokenService.revokeAllForUser(userId);
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "auth.logout.all",
      resourceType: "session",
      resourceId: userId,
      metadata: { sessionsRevoked: count },
    });
  }

  /** Changes the caller's password and clears the first-login flag. */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException("Account not found.");
    }
    const valid = await verifyPassword(input.currentPassword, user.passwordHash ?? "");
    if (!valid) {
      throw new BadRequestException("Current password is incorrect.");
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
  }

  /** Returns the current principal's identity, membership, and permissions. */
  async me(userId: string, membershipId: string) {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, userId, status: "ACTIVE" },
      select: {
        id: true,
        status: true,
        user: { select: { id: true, email: true, mfaEnabled: true, mustChangePassword: true } },
        org: { select: { id: true, name: true, slug: true } },
        role: { select: { name: true, permissions: true, version: true } },
        employee: { select: { id: true, firstName: true, lastName: true, department: true, title: true } },
      },
    });

    if (!membership) {
      throw new UnauthorizedException("Active membership not found.");
    }

    return membership;
  }

  private async resolveClaimsForMembership(membershipId: string): Promise<AccessTokenClaims> {
    const membership = await this.prisma.organizationMembership.findFirst({
      // Also stops refresh from extending a session once the org is suspended/deleted.
      where: { id: membershipId, status: "ACTIVE", org: { status: "ACTIVE" } },
      select: {
        id: true,
        orgId: true,
        userId: true,
        role: { select: { name: true, version: true } },
      },
    });

    if (!membership) {
      throw new UnauthorizedException("Membership is no longer active.");
    }

    return {
      sub: membership.userId,
      orgId: membership.orgId,
      membershipId: membership.id,
      role: membership.role.name,
      permissionsVersion: membership.role.version,
    };
  }

  private async generateUniqueSlug(orgName: string): Promise<string> {
    const base =
      orgName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "org";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`;
      const taken = await this.prisma.organization.findUnique({ where: { slug: candidate } });
      if (!taken) {
        return candidate;
      }
    }

    return `${base}-${randomBytes(6).toString("hex")}`;
  }
}
