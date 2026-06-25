import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { InsightsService } from "./insights.service.js";

@Controller("insights")
@UseGuards(AuthGuard, TenantGuard)
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** The caller's own time/productivity (Time Tracking). */
  @Get("me")
  me() {
    return this.insights.me();
  }

  /** Org-wide workforce analytics (AI Analytics — derived). */
  @Get("team")
  team() {
    return this.insights.team();
  }
}
