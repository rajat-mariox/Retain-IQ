import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { offsetPaginationQuerySchema, type OffsetPaginationQuery } from "@retainiq/contracts";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { TenantService } from "./tenant.service.js";

@Controller("org")
@UseGuards(AuthGuard, TenantGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  getCurrentOrg() {
    return this.tenantService.getCurrentOrg(requireTenantContext());
  }

  @Get("members")
  listMembers(@Query(new ZodValidationPipe(offsetPaginationQuerySchema)) query: OffsetPaginationQuery) {
    return this.tenantService.listMembers(requireTenantContext(), query);
  }
}
