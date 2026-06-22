import { Injectable, NotFoundException } from "@nestjs/common";
import type { RequestContext } from "@retainiq/contracts";
import { PrismaService } from "../../common/database/prisma.service.js";

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the profile of the caller's current organization. */
  async getCurrentOrg(context: RequestContext) {
    const org = await this.prisma.organization.findFirst({
      where: { id: context.orgId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        region: true,
        timezone: true,
        createdAt: true,
      },
    });

    if (!org) {
      throw new NotFoundException("Organization not found.");
    }

    return org;
  }
}
