import { Controller, Get, Header, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ReportsService } from "./reports.service.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeSchema = z.object({ from: date.optional(), to: date.optional() });
const exportSchema = z.object({
  kind: z.enum(["payroll", "timesheets", "billable", "invoices"]),
  from: date.optional(),
  to: date.optional(),
  cycleId: z.string().uuid().optional(),
});

/** Payroll dashboard, reports and CSV exports. Read-only — payroll.read. */
@Controller("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("dashboard")
  @RequirePermissions(permissions.payrollRead)
  dashboard() {
    return this.reports.dashboard();
  }

  @Get("reports")
  @RequirePermissions(permissions.payrollRead)
  payrollReport(@Query(new ZodValidationPipe(rangeSchema)) query: z.infer<typeof rangeSchema>) {
    return this.reports.payrollReport(query);
  }

  /** Sends a CSV attachment rather than JSON — the browser downloads it. */
  @Get("export")
  @RequirePermissions(permissions.payrollRead)
  @Header("Content-Type", "text/csv; charset=utf-8")
  async exportCsv(@Query(new ZodValidationPipe(exportSchema)) query: z.infer<typeof exportSchema>, @Res() res: FastifyReply) {
    const { filename, body } = await this.reports.exportCsv(query.kind, query);
    // The BOM makes Excel read the UTF-8 correctly instead of mangling accents.
    await res.header("Content-Disposition", `attachment; filename="${filename}"`).send(`﻿${body}`);
  }
}
