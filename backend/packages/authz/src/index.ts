export const permissions = {
  employeeRead: "employee.read",
  employeeWrite: "employee.write",
  attendanceRead: "attendance.read",
  attendanceApprove: "attendance.approve",
  attendanceManage: "attendance.manage",
  projectRead: "project.read",
  projectWrite: "project.write",
  screenshotsRead: "screenshots.read",
  screenshotsDownload: "screenshots.download",
  screenshotsDelete: "screenshots.delete",
  // Coarse gates (legacy module + nav flag).
  payrollRead: "payroll.read",
  payrollApprove: "payroll.approve",
  // ---- Payroll & Payout Workspace granular permissions (spec §27) ----
  // Access is never checked by role name; controllers require these explicitly.
  payrollDashboardRead: "payroll.dashboard.read",
  payrollProfileRead: "payroll.profile.read",
  payrollProfileCreate: "payroll.profile.create",
  payrollProfileUpdate: "payroll.profile.update",
  payrollProfileCompensationRead: "payroll.profile.compensation.read",
  payrollProfileBankRead: "payroll.profile.bank_details.read",
  payrollProfileTaxRead: "payroll.profile.tax_details.read",
  payrollComponentRead: "payroll.component.read",
  payrollComponentManage: "payroll.component.manage",
  payrollBatchRead: "payroll.batch.read",
  payrollBatchCreate: "payroll.batch.create",
  payrollBatchCalculate: "payroll.batch.calculate",
  payrollBatchValidate: "payroll.batch.validate",
  payrollBatchSubmit: "payroll.batch.submit",
  payrollBatchApprove: "payroll.batch.approve",
  payrollBatchReject: "payroll.batch.reject",
  payrollBatchHold: "payroll.batch.hold",
  payrollBatchRelease: "payroll.batch.release",
  payrollBatchClose: "payroll.batch.close",
  payrollRecordRead: "payroll.record.read",
  payrollRecordUpdate: "payroll.record.update",
  payrollRecordOverride: "payroll.record.override",
  payrollPaymentRead: "payroll.payment.read",
  payrollPaymentProcess: "payroll.payment.process",
  payrollPaymentMarkPaid: "payroll.payment.mark_paid",
  payrollPaymentRetry: "payroll.payment.retry",
  payrollPaymentProofRead: "payroll.payment.proof.read",
  payrollPaymentProofUpload: "payroll.payment.proof.upload",
  payrollStatementOwnRead: "payroll.statement.own.read",
  payrollStatementEmployeeRead: "payroll.statement.employee.read",
  payrollStatementGenerate: "payroll.statement.generate",
  payrollStatementDownload: "payroll.statement.download",
  payrollDisputeCreate: "payroll.dispute.create",
  payrollDisputeRead: "payroll.dispute.read",
  payrollDisputeAssign: "payroll.dispute.assign",
  payrollDisputeResolve: "payroll.dispute.resolve",
  payrollAdjustmentCreate: "payroll.adjustment.create",
  payrollAdjustmentReview: "payroll.adjustment.review",
  payrollAdjustmentApprove: "payroll.adjustment.approve",
  payrollVariablePayApprove: "payroll.variable_pay.approve",
  payrollOvertimeApprove: "payroll.overtime.approve",
  // Sensitive-field gate for compensation/bank/tax (field-level authz, §28).
  salaryViewSensitive: "salary.view_sensitive",
  // Phase 2/3 (tax/statutory/filing) — registered now so roles & UI can gate them.
  payrollTaxRead: "payroll.tax.read",
  payrollTaxCalculate: "payroll.tax.calculate",
  payrollTaxOverride: "payroll.tax.override",
  payrollTaxConfigure: "payroll.tax.configure",
  payrollStatutoryRead: "payroll.statutory.read",
  payrollStatutoryCalculate: "payroll.statutory.calculate",
  payrollStatutoryConfigure: "payroll.statutory.configure",
  payrollFilingRead: "payroll.filing.read",
  payrollFilingPrepare: "payroll.filing.prepare",
  payrollFilingReview: "payroll.filing.review",
  payrollFilingApprove: "payroll.filing.approve",
  payrollFilingSubmit: "payroll.filing.submit",
  payrollReportRead: "payroll.report.read",
  payrollReportExport: "payroll.report.export",
  payrollAuditRead: "payroll.audit.read",
  aiRiskRead: "ai_risk.read",
  observationRead: "observation.read",
  observationManage: "observation.manage",
  incidentManage: "incident.manage",
  billingManage: "billing.manage",
  securityManage: "settings.security.manage",
  auditRead: "audit.read",
} as const;

export type Permission = (typeof permissions)[keyof typeof permissions];

/** Every known permission — used to seed the org Owner/system role. */
export const allPermissions: Permission[] = Object.values(permissions);

// ---------------------------------------------------------------------------
// System role hierarchy (Owner > Manager > Employee). Managers can manage
// projects/tasks and add members; employees only see their own data + projects.
// ---------------------------------------------------------------------------

/**
 * Department managers (HR / project managers): manage team, projects/tasks,
 * attendance, view insights, and view + DELETE employee screenshots.
 *
 * Deliberately NOT payroll: salary is personal data, and managing a team
 * doesn't require seeing what people are paid. Payroll access is granted only
 * to the Owner or to a purpose-built role (e.g. Finance / HR) an admin creates.
 */
export const managerPermissions: Permission[] = [
  permissions.employeeRead,
  permissions.employeeWrite,
  permissions.attendanceRead,
  permissions.attendanceApprove,
  permissions.projectRead,
  permissions.projectWrite,
  permissions.aiRiskRead,
  permissions.observationRead,
  permissions.observationManage,
  permissions.screenshotsRead,
  permissions.screenshotsDownload,
  permissions.screenshotsDelete,
];

/**
 * HR Manager: the people-operations role — manages employees, attendance,
 * leave/payroll approvals, and the workforce-care surfaces (observations &
 * incidents). Deliberately no project.write (not a delivery manager) and no
 * screenshots.delete (can view/download for review, not destroy evidence).
 */
export const hrManagerPermissions: Permission[] = [
  permissions.employeeRead,
  permissions.employeeWrite,
  permissions.attendanceRead,
  permissions.attendanceApprove,
  permissions.payrollRead,
  permissions.payrollApprove,
  // People-ops payroll scope (spec §27/§28): run/review batches, manage profiles
  // & components, approve variable pay/overtime, handle disputes/adjustments —
  // but NOT process payments (that stays with Finance/Owner, separation of duties).
  permissions.payrollDashboardRead,
  permissions.payrollProfileRead,
  permissions.payrollProfileCreate,
  permissions.payrollProfileUpdate,
  permissions.payrollComponentRead,
  permissions.payrollComponentManage,
  permissions.payrollBatchRead,
  permissions.payrollBatchCreate,
  permissions.payrollBatchCalculate,
  permissions.payrollBatchValidate,
  permissions.payrollBatchSubmit,
  permissions.payrollBatchApprove,
  permissions.payrollBatchHold,
  permissions.payrollBatchRelease,
  permissions.payrollBatchClose,
  permissions.payrollRecordRead,
  permissions.payrollStatementEmployeeRead,
  permissions.payrollStatementGenerate,
  permissions.payrollDisputeRead,
  permissions.payrollDisputeAssign,
  permissions.payrollDisputeResolve,
  permissions.payrollAdjustmentCreate,
  permissions.payrollAdjustmentReview,
  permissions.payrollAdjustmentApprove,
  permissions.payrollVariablePayApprove,
  permissions.payrollOvertimeApprove,
  permissions.payrollReportRead,
  permissions.payrollTaxRead,
  permissions.payrollStatutoryRead,
  permissions.observationRead,
  permissions.observationManage,
  permissions.incidentManage,
  permissions.screenshotsRead,
  permissions.screenshotsDownload,
];

/**
 * Standard employee: read projects. Employees see their OWN productivity via
 * /insights/me — NOT a screenshot gallery — so they get no screenshots.read.
 */
export const employeePermissions: Permission[] = [permissions.projectRead];

export interface SystemRole {
  name: string;
  description: string;
  permissions: Permission[];
}

/** Roles seeded into every org (highest first). */
export const SYSTEM_ROLES: SystemRole[] = [
  { name: "Owner", description: "Full administrative access.", permissions: allPermissions },
  { name: "Manager", description: "Manage team, projects and attendance.", permissions: managerPermissions },
  { name: "HR Manager", description: "People operations — employees, attendance, payroll approvals, observations & incidents.", permissions: hrManagerPermissions },
  { name: "Employee", description: "Standard employee access.", permissions: employeePermissions },
];

export type PermissionBundle = {
  role: string;
  permissions: Permission[];
  version: number;
};

export function hasPermission(bundle: PermissionBundle, permission: Permission): boolean {
  return bundle.permissions.includes(permission);
}

/**
 * Returns the subset of `required` permissions not present in `granted`.
 * An empty result means the request is authorized.
 */
export function missingPermissions(
  granted: readonly Permission[],
  required: readonly Permission[],
): Permission[] {
  const grantedSet = new Set(granted);
  return required.filter((permission) => !grantedSet.has(permission));
}

