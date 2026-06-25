import { Controller, Get, UseGuards } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
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
  listMembers() {
    return this.tenantService.listMembers(requireTenantContext());
  }
}
