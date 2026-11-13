// Permission gate for the Payroll & Payout workspace. Kept as a plain module
// (no React, no client-only APIs) so the server page and the client workspace can
// both derive the same booleans from the session's resolved permission list.

export interface PayrollAccess {
  canDashboard: boolean;
  // Batches
  canBatchRead: boolean;
  canBatchCreate: boolean;
  canCalculate: boolean;
  canValidate: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canHold: boolean;
  canRelease: boolean;
  canClose: boolean;
  // Records / profiles / components
  canRecordRead: boolean;
  canRecordUpdate: boolean;
  canProfileRead: boolean;
  canComponentRead: boolean;
  canComponentManage: boolean;
  // Variable pay & overtime
  canVariablePayApprove: boolean;
  canOvertimeApprove: boolean;
  // Payments
  canPaymentRead: boolean;
  canPaymentProcess: boolean;
  canMarkPaid: boolean;
  canProofUpload: boolean;
  canPaymentRetry: boolean;
  // Statements
  canStatementEmployeeRead: boolean;
  canStatementGenerate: boolean;
  // Disputes & adjustments
  canDisputeRead: boolean;
  canAdjustmentReview: boolean;
  // Reports
  canReportRead: boolean;
  canReportExport: boolean;
  // Tax & statutory (Phase 2)
  canTaxRead: boolean;
  canTaxConfigure: boolean;
  canStatutoryRead: boolean;
  canStatutoryConfigure: boolean;
  // Filing (Phase 3)
  canFilingRead: boolean;
  canFilingPrepare: boolean;
  canFilingApprove: boolean;
  canFilingSubmit: boolean;
}

/** Resolve the workspace's permission booleans from a session's permission strings. */
export function buildAccess(perms: string[]): PayrollAccess {
  const set = new Set(perms);
  const has = (p: string) => set.has(p);
  return {
    canDashboard: has("payroll.dashboard.read"),
    canBatchRead: has("payroll.batch.read"),
    canBatchCreate: has("payroll.batch.create"),
    canCalculate: has("payroll.batch.calculate"),
    canValidate: has("payroll.batch.validate"),
    canSubmit: has("payroll.batch.submit"),
    canApprove: has("payroll.batch.approve"),
    canReject: has("payroll.batch.reject"),
    canHold: has("payroll.batch.hold"),
    canRelease: has("payroll.batch.release"),
    canClose: has("payroll.batch.close"),
    canRecordRead: has("payroll.record.read"),
    canRecordUpdate: has("payroll.record.update"),
    canProfileRead: has("payroll.profile.read"),
    canComponentRead: has("payroll.component.read"),
    canComponentManage: has("payroll.component.manage"),
    canVariablePayApprove: has("payroll.variable_pay.approve"),
    canOvertimeApprove: has("payroll.overtime.approve"),
    canPaymentRead: has("payroll.payment.read"),
    canPaymentProcess: has("payroll.payment.process"),
    canMarkPaid: has("payroll.payment.mark_paid"),
    canProofUpload: has("payroll.payment.proof.upload"),
    canPaymentRetry: has("payroll.payment.retry"),
    canStatementEmployeeRead: has("payroll.statement.employee.read"),
    canStatementGenerate: has("payroll.statement.generate"),
    canDisputeRead: has("payroll.dispute.read"),
    canAdjustmentReview: has("payroll.adjustment.review"),
    canReportRead: has("payroll.report.read"),
    canReportExport: has("payroll.report.export"),
    canTaxRead: has("payroll.tax.read"),
    canTaxConfigure: has("payroll.tax.configure"),
    canStatutoryRead: has("payroll.statutory.read"),
    canStatutoryConfigure: has("payroll.statutory.configure"),
    canFilingRead: has("payroll.filing.read"),
    canFilingPrepare: has("payroll.filing.prepare"),
    canFilingApprove: has("payroll.filing.approve"),
    canFilingSubmit: has("payroll.filing.submit"),
  };
}

/** Whether the caller can see the workspace at all (any payroll read grant). */
export function canViewPayroll(perms: string[]): boolean {
  return [
    "payroll.dashboard.read",
    "payroll.batch.read",
    "payroll.record.read",
    "payroll.profile.read",
    "payroll.payment.read",
    "payroll.dispute.read",
    "payroll.adjustment.review",
    "payroll.report.read",
  ].some((p) => perms.includes(p));
}
