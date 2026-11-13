import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { toCsv, toXlsx, exportMeta } from "../../common/reports/report-export.js";
import { ReportsService } from "./reports.service.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeSchema = z.object({ from: date.optional(), to: date.optional() });
const exportSchema = z.object({
  kind: z.enum(["payroll", "timesheets", "billable", "invoices"]),
  from: date.optional(),
  to: date.optional(),
  cycleId: z.string().uuid().optional(),
  format: z.enum(["csv", "xlsx"]).optional(),
});

/** Payroll dashboard, reports and CSV exports. Read-only — payroll.read. */
@Controller("payroll")
@RequireFeature("payroll")
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

  /**
   * Sends a downloadable report file — CSV (default) or a native Excel workbook
   * (?format=xlsx). Streamed as an attachment so the browser downloads it.
   */
  @Get("export")
  @RequirePermissions(permissions.payrollRead)
  async export(@Query(new ZodValidationPipe(exportSchema)) query: z.infer<typeof exportSchema>, @Res() res: FastifyReply) {
    const table = await this.reports.exportTable(query.kind, query);
    const format = query.format ?? "csv";
    const meta = exportMeta(table.baseName, format);
    if (format === "xlsx") {
      const buf = toXlsx(query.kind, table);
      await res.header("Content-Type", meta.contentType).header("Content-Disposition", `attachment; filename="${meta.filename}"`).send(buf);
    } else {
      // The BOM makes Excel read the UTF-8 correctly instead of mangling accents.
      await res.header("Content-Type", meta.contentType).header("Content-Disposition", `attachment; filename="${meta.filename}"`).send(String.fromCharCode(0xfeff) + toCsv(table));
    }
  }
}
