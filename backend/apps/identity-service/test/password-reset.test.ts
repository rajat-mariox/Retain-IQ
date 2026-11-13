import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://identity:identity@localhost:5432/retainiq-identity?schema=public";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";
process.env.PLATFORM_JWT_SECRET ??= "test-platform-secret";

const { IdentityService } = await import("../dist/modules/identity/identity.service.js");

test("requestPasswordReset creates a one-time reset token for an active user", async () => {
  const updated: Record<string, unknown>[] = [];
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        if (where.email === "user@example.com") {
          return { id: "user-1", status: "ACTIVE" };
        }
        return null;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updated.push(data);
        return { id: "user-1", ...data };
      },
    },
  };

  const service = new IdentityService(prisma as never, {} as never, {} as never, {} as never);
  const result = await service.requestPasswordReset({ email: "user@example.com" });

  assert.equal(typeof result.resetToken, "string");
  assert.ok(result.resetToken.length >= 6);
  assert.ok(result.expiresAt);
  assert.equal(updated.length, 1);
});
