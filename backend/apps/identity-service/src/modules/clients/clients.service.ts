import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

/**
 * Clients — the companies an org delivers billable project work for. A project
 * points at a client, and time entries inherit the client through the project,
 * so this is the single place the relationship is set.
 */
@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Clients with their project counts and (optionally) archived ones. */
  async list(query: { includeArchived?: boolean } = {}) {
    const ctx = requireTenantContext();
    const rows = await this.prisma.client.findMany({
      where: { orgId: ctx.orgId, ...(query.includeArchived ? {} : { status: "ACTIVE" }) },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: { _count: { select: { projects: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      contactEmail: c.contactEmail,
      status: c.status,
      projectCount: c._count.projects,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  async create(input: { name: string; code?: string | null; contactEmail?: string | null }) {
    const ctx = requireTenantContext();
    try {
      const c = await this.prisma.client.create({
        data: {
          orgId: ctx.orgId,
          name: input.name.trim(),
          code: input.code?.trim() || null,
          contactEmail: input.contactEmail?.trim() || null,
        },
      });
      return { id: c.id, name: c.name, code: c.code, contactEmail: c.contactEmail, status: c.status, projectCount: 0, createdAt: c.createdAt.toISOString() };
    } catch (e) {
      if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
        throw new ConflictException("A client with this name already exists.");
      }
      throw e;
    }
  }

  async update(id: string, input: { name?: string; code?: string | null; contactEmail?: string | null; status?: "ACTIVE" | "ARCHIVED" }) {
    const ctx = requireTenantContext();
    const found = await this.prisma.client.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!found) throw new NotFoundException("Client not found.");

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.code !== undefined) data.code = input.code?.trim() || null;
    if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail?.trim() || null;
    if (input.status !== undefined) data.status = input.status;

    try {
      const c = await this.prisma.client.update({ where: { id: found.id }, data, include: { _count: { select: { projects: true } } } });
      return { id: c.id, name: c.name, code: c.code, contactEmail: c.contactEmail, status: c.status, projectCount: c._count.projects, createdAt: c.createdAt.toISOString() };
    } catch (e) {
      if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
        throw new ConflictException("A client with this name already exists.");
      }
      throw e;
    }
  }

  /**
   * Archive rather than delete when a client has projects: their time entries
   * and any issued invoices must keep resolving to a client name.
   */
  async remove(id: string) {
    const ctx = requireTenantContext();
    const found = await this.prisma.client.findFirst({
      where: { id, orgId: ctx.orgId },
      include: { _count: { select: { projects: true } } },
    });
    if (!found) throw new NotFoundException("Client not found.");
    if (found._count.projects > 0) {
      throw new ConflictException(`This client has ${found._count.projects} project(s). Archive it instead, or move the projects first.`);
    }
    await this.prisma.client.delete({ where: { id: found.id } });
    return { id: found.id, deleted: true };
  }
}
