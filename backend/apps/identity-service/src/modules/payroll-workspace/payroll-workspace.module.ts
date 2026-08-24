import { Module } from "@nestjs/common";
import { AccessScopeModule } from "../../common/access-scope/access-scope.module.js";
import { OrgRolesModule } from "../../common/org-roles/org-roles.module.js";
import { ObservationModule } from "../observation/observation.module.js";

// Services
import { PayrollCalendarService } from "./calendar.service.js";
import { PayrollProfileService } from "./profile.service.js";
import { PayrollComponentService } from "./component.service.js";
import { PayrollInputService } from "./input-snapshot.service.js";
import { PayrollCalcService } from "./calc.service.js";
import { PayrollBatchService } from "./batch.service.js";
import { VariablePayService } from "./variable-pay.service.js";
import { OvertimeService } from "./overtime.service.js";
import { PayrollApprovalService } from "./approval.service.js";
import { PaymentService } from "./payment.service.js";
import { StatementService } from "./statement.service.js";
import { DisputeService } from "./dispute.service.js";
import { AdjustmentService } from "./adjustment.service.js";
import { DashboardService } from "./dashboard.service.js";
import { PayrollReportsService } from "./reports.service.js";

// Controllers
import { PayrollCalendarController } from "./calendar.controller.js";
import { PayrollProfileController } from "./profile.controller.js";
import { PayrollComponentController } from "./component.controller.js";
import { PayrollBatchController } from "./batch.controller.js";
import { PayrollRecordController } from "./record.controller.js";
import { VariablePayController } from "./variable-pay.controller.js";
import { OvertimeController } from "./overtime.controller.js";
import { PayrollApprovalController } from "./approval.controller.js";
import { PayrollPaymentController } from "./payment.controller.js";
import { PayrollStatementController } from "./statement.controller.js";
import { DisputeController } from "./dispute.controller.js";
import { AdjustmentController } from "./adjustment.controller.js";
import { DashboardController } from "./dashboard.controller.js";
import { PayrollReportsController } from "./reports.controller.js";

/**
 * Payroll & Payout Workspace (spec §2). One consolidated in-portal module that
 * replaces the legacy basic payout: profiles, components, calendars, batches, the
 * deterministic calculation pipeline, attendance/leave input snapshots, variable
 * pay, overtime/comp-off, maker-checker approvals, payments + proof, statements,
 * disputes (linked to HR cases), adjustments, dashboard and reports. Reuses the
 * portal's RBAC/ABAC (AccessScope), audit and outbox infrastructure.
 */
@Module({
  imports: [AccessScopeModule, OrgRolesModule, ObservationModule],
  controllers: [
    PayrollCalendarController,
    PayrollProfileController,
    PayrollComponentController,
    PayrollBatchController,
    PayrollRecordController,
    VariablePayController,
    OvertimeController,
    PayrollApprovalController,
    PayrollPaymentController,
    PayrollStatementController,
    DisputeController,
    AdjustmentController,
    DashboardController,
    PayrollReportsController,
  ],
  providers: [
    PayrollCalendarService,
    PayrollProfileService,
    PayrollComponentService,
    PayrollInputService,
    PayrollCalcService,
    PayrollBatchService,
    VariablePayService,
    OvertimeService,
    PayrollApprovalService,
    PaymentService,
    StatementService,
    DisputeService,
    AdjustmentService,
    DashboardService,
    PayrollReportsService,
  ],
  exports: [PayrollCalcService, PayrollBatchService, PayrollProfileService],
})
export class PayrollWorkspaceModule {}
