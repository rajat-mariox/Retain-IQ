import { Injectable, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import { loadConfig } from "@retainiq/config";
import { hashPassword, verifyPassword } from "../../common/crypto/password.util.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { logger } from "../../common/observability/observability.js";
import { PlatformTokenService } from "./platform-token.service.js";
import type { PlatformLoginInput, PlatformProfile, PlatformTokens } from "./dto.js";

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

  async me(adminId: string): Promise<PlatformProfile> {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin || admin.status !== "ACTIVE") {
      throw new UnauthorizedException("Account not found.");
    }
    return toProfile(admin);
  }
}
