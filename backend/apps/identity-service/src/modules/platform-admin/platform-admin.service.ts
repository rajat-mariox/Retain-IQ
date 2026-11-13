import { BadRequestException, Injectable, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { loadConfig } from "@retainiq/config";
import { hashPassword, verifyPassword } from "../../common/crypto/password.util.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { logger } from "../../common/observability/observability.js";
import { PlatformTokenService } from "./platform-token.service.js";
import type {
  PlatformForgotPasswordInput,
  PlatformLoginInput,
  PlatformProfile,
  PlatformResetPasswordInput,
  PlatformTokens,
} from "./dto.js";

const config = loadConfig();

interface PlatformAdminRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  lastLoginAt: Date | null;
}

function toProfile(admin: PlatformAdminRow): PlatformProfile {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    lastLoginAt: admin.lastLoginAt ? admin.lastLoginAt.toISOString() : null,
  };
}

@Injectable()
export class PlatformAdminService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: PlatformTokenService,
  ) {}

  /** Seed the first super admin from env on boot, if configured and absent. */
  async onModuleInit(): Promise<void> {
    if (!config.PLATFORM_ADMIN_EMAIL || !config.PLATFORM_ADMIN_PASSWORD) {
      return;
    }
    const email = config.PLATFORM_ADMIN_EMAIL.toLowerCase();
    const existing = await this.prisma.platformAdmin.findUnique({ where: { email } });
    if (existing) {
      return;
    }
    const passwordHash = await hashPassword(config.PLATFORM_ADMIN_PASSWORD);
    await this.prisma.platformAdmin.create({
      data: { email, passwordHash, name: "Platform Owner", role: "SUPER_ADMIN" },
    });
    logger.info({ email }, "Seeded platform super-admin from PLATFORM_ADMIN_* env");
  }

  async login(input: PlatformLoginInput): Promise<PlatformTokens & { admin: PlatformProfile }> {
    const email = input.email.toLowerCase();
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email } });

    // Verify even when missing to keep timing uniform against enumeration.
    const valid = await verifyPassword(input.password, admin?.passwordHash ?? "");
    if (!admin || !valid || admin.status !== "ACTIVE") {
      throw new UnauthorizedException("Invalid email or password.");
    }

    await this.prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const tokens = await this.tokens.issue({ id: admin.id, role: admin.role, name: admin.name });
    return { ...tokens, admin: toProfile(admin) };
  }

  async refresh(rawRefreshToken: string): Promise<PlatformTokens> {
    return this.tokens.rotate(rawRefreshToken);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokens.revoke(rawRefreshToken);
  }

  /**
   * Start a super-admin password reset.
   *
   * The response is IDENTICAL whether or not the admin exists — same shape, same
   * message, no token. Returning a real token for a known email and an empty one
   * otherwise let anyone probe which addresses hold platform access, and handed
   * them the reset itself.
   *
   * config.RESET_TOKEN_IN_RESPONSE returns the token inline for local development
   * only (no mail sender is wired up yet); it defaults to off.
   */
  async requestPasswordReset(input: PlatformForgotPasswordInput): Promise<{ resetToken: string; expiresAt: string; message: string }> {
    const email = input.email.toLowerCase();
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email } });
    const opaque = {
      resetToken: "",
      expiresAt: "",
      message: "If an account exists for that email, a reset link has been sent.",
    };

    if (!admin || admin.status !== "ACTIVE") {
      return opaque;
    }

    const resetToken = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const passwordResetTokenHash = await hashPassword(resetToken);

    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: {
        passwordResetTokenHash,
        passwordResetTokenExpiresAt: expiresAt,
      },
    });

    // Dev only. Otherwise this returns the same opaque body as an unknown email,
    // so the response can't be used to enumerate platform admins.
    if (!config.RESET_TOKEN_IN_RESPONSE) return opaque;
    return {
      resetToken,
      expiresAt: expiresAt.toISOString(),
      message: "Development mode: the reset token is returned here instead of being emailed.",
    };
  }

  /**
   * Complete a super-admin password reset. Every failure — unknown email, no
   * reset pending, expired, wrong token — answers with the SAME message, so the
   * response never reveals which addresses hold platform access.
   */
  async resetPassword(input: PlatformResetPasswordInput): Promise<void> {
    const email = input.email.toLowerCase();
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email } });
    const rejected = () => new BadRequestException("That reset link is invalid or has expired. Request a new one.");

    if (!admin || !admin.passwordResetTokenHash || !admin.passwordResetTokenExpiresAt) {
      throw rejected();
    }

    if (admin.passwordResetTokenExpiresAt <= new Date()) {
      throw rejected();
    }

    const valid = await verifyPassword(input.token, admin.passwordResetTokenHash);
    if (!valid) {
      throw rejected();
    }

    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetTokenExpiresAt: null,
      },
    });
  }

  async me(adminId: string): Promise<PlatformProfile> {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin || admin.status !== "ACTIVE") {
      throw new UnauthorizedException("Account not found.");
    }
    return toProfile(admin);
  }
}
