export const permissions = {
  employeeRead: "employee.read",
  employeeWrite: "employee.write",
  attendanceRead: "attendance.read",
  attendanceApprove: "attendance.approve",
  projectRead: "project.read",
  projectWrite: "project.write",
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

// ---------------------------------------------------------------------------
// System role hierarchy (Owner > Manager > Employee). Managers can manage
// projects/tasks and add members; employees only see their own data + projects.
// ---------------------------------------------------------------------------

/** Department managers: manage team, projects/tasks, attendance, view insights. */
export const managerPermissions: Permission[] = [
  permissions.employeeRead,
  permissions.employeeWrite,
  permissions.attendanceRead,
  permissions.attendanceApprove,
  permissions.projectRead,
  permissions.projectWrite,
  permissions.aiRiskRead,
  permissions.payrollRead,
];

/** Standard employee: read projects (own data needs no permission). */
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

