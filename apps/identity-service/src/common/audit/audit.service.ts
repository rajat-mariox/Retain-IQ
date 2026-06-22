import { Injectable } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.store.js";
import { PrismaService } from "../database/prisma.service.js";

export type AuditInput = {
  orgId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  actorUserId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
};

/**
 * Writes tenant-scoped audit events. Reads ip/userAgent/actor from request
 * context when not supplied. Auditing must never break the primary operation,
 * so failures are swallowed (and should be surfaced via logs/metrics later).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    const ctx = getRequestContext();
    try {
      await this.prisma.auditEvent.create({
        data: {
          orgId: input.orgId,
          actorUserId: input.actorUserId ?? ctx.userId ?? null,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId ?? null,
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
          before: (input.before as object) ?? undefined,
          after: (input.after as object) ?? undefined,
          metadata: (input.metadata as object) ?? undefined,
        },
      });
    } catch {
      // Intentionally non-fatal.
    }
  }
}
