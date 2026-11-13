import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, UseGuards } from "@nestjs/common";
import { missingPermissions, permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PermissionBundleService } from "../../common/security/permission-bundle.service.js";
import { REPORT_KINDS, type ReportKind, PayrollReportsService } from "./reports.service.js";

const isReportKind = (v: string): v is ReportKind => (REPORT_KINDS as readonly string[]).includes(v);

/** Payroll reports (§31). Read the JSON table, or ?format=csv to export (needs the export permission). */
@Controller("payroll")
@RequireFeature("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PayrollReportsController {
  constructor(
    private readonly reports: PayrollReportsService,
    private readonly bundles: PermissionBundleService,
  ) {}

  @Get("reports/:kind")
  @RequirePermissions(permissions.payrollReportRead)
  async report(
    @Param("kind") kindRaw: string,
    @Query("format") format?: string,
    @Query("periodId") periodId?: string,
    @Query("batchId") batchId?: string,
    @Query("employeeId") employeeId?: string,
  ) {
    if (!isReportKind(kindRaw)) throw new BadRequestException(`Unknown report: ${kindRaw}. Valid: ${REPORT_KINDS.join(", ")}.`);
    const report = await this.reports.build(kindRaw, { periodId, batchId, employeeId });

    if (format === "csv") {
      // Exporting is a stronger action than reading — gate it on the export permission.
      const { orgId, userId } = requireTenantContext();
      const bundle = await this.bundles.resolve(orgId, userId);
      if (!bundle || missingPermissions(bundle.permissions, [permissions.payrollReportExport]).length > 0) {
        throw new ForbiddenException(`Missing required permission(s): ${permissions.payrollReportExport}.`);
      }
      return this.reports.csv(report);
    }
    return report;
  }
}
