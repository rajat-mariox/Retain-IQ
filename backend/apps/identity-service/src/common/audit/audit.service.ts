import { Injectable, Logger } from "@nestjs/common";
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
  private readonly logger = new Logger(AuditService.name);

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
    } catch (err) {
      // Non-fatal to the primary operation, but NOT silent — a dropped audit event
      // is an integrity signal that must be visible in logs (and alertable).
      this.logger.error(`Failed to write audit event ${input.action} on ${input.resourceType}:${input.resourceId ?? "-"}: ${String(err)}`);
    }
  }

  /**
   * Read an org's audit trail for a specific resource (e.g. one employee),
   * newest first. Org-scoped; the caller must already be authorized (audit.read
   * + resource in scope) by the calling controller/service.
   */
  async listForResource(orgId: string, resourceType: string, resourceId: string, limit = 100) {
    const rows = await this.prisma.auditEvent.findMany({
      where: { orgId, resourceType, resourceId },
      orderBy: { occurredAt: "desc" },
      take: Math.min(500, Math.max(1, limit)),
      select: { id: true, action: true, actorUserId: true, ipAddress: true, before: true, after: true, metadata: true, occurredAt: true },
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorUserId: r.actorUserId,
      ipAddress: r.ipAddress,
      before: r.before,
      after: r.after,
      metadata: r.metadata,
      occurredAt: r.occurredAt.toISOString(),
    }));
  }
}
