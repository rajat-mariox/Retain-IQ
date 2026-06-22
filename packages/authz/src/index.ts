export const permissions = {
  employeeRead: "employee.read",
  employeeWrite: "employee.write",
  attendanceRead: "attendance.read",
  attendanceApprove: "attendance.approve",
  screenshotsRead: "screenshots.read",
  screenshotsDownload: "screenshots.download",
  payrollRead: "payroll.read",
  payrollApprove: "payroll.approve",
  aiRiskRead: "ai_risk.read",
  billingManage: "billing.manage",
  securityManage: "settings.security.manage",
  auditRead: "audit.read",
} as const;

export type Permission = (typeof permissions)[keyof typeof permissions];

/** Every known permission — used to seed the org Owner/system role. */
export const allPermissions: Permission[] = Object.values(permissions);

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

