import { Injectable } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

/**
 * An organization's own activity feed: the record of things that happened in
 * this org — members invited, features turned on or off, the org created. It
 * reads the same PlatformEvent log the super-admin console uses, but scoped to
 * the caller's org, so a tenant sees only their own history and never anyone
 * else's.
 */
@Injectable()
export class OrgActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: { page: number; pageSize: number; type?: string }) {
    const ctx = requireTenantContext();
    const where = { orgId: ctx.orgId, ...(query.type ? { type: query.type } : {}) };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.platformEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { id: true, type: true, summary: true, createdAt: true },
      }),
      this.prisma.platformEvent.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        summary: r.summary,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Distinct event types present for this org, for the filter dropdown. */
  async types() {
    const ctx = requireTenantContext();
    const rows = await this.prisma.platformEvent.findMany({
      where: { orgId: ctx.orgId },
      distinct: ["type"],
      select: { type: true },
      orderBy: { type: "asc" },
    });
    return rows.map((r) => r.type);
  }
}
