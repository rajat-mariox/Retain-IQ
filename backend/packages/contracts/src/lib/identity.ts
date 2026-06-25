import { z } from "zod";

export const registerOrgSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(200),
  orgName: z.string().min(2).max(120),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
});

export type RegisterOrgInput = z.infer<typeof registerOrgSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  // Optional org disambiguation when the user belongs to multiple orgs.
  orgId: z.string().uuid().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export type MembershipSummary = {
  membershipId: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: string;
};

/** When a user belongs to several orgs and none was selected, login returns choices. */
export type OrgSelectionRequired = {
  requiresOrgSelection: true;
  memberships: MembershipSummary[];
};

export type LoginResult = AuthTokens | OrgSelectionRequired;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export type LogoutInput = z.infer<typeof logoutSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Claims embedded in the short-lived access JWT. `jti`/`sid` are stamped by the
 * token service at signing time (the service layer builds only the principal
 * fields), so they are optional on the constructed shape but always present on a
 * verified token. `jti` is the per-token id used for denylist revocation; `sid`
 * is the backing refresh-session id.
 */
export type AccessTokenClaims = {
  sub: string; // userId
  orgId: string;
  membershipId: string;
  role: string;
  permissionsVersion: number;
  jti?: string;
  sid?: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export const createEmployeeSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().optional(),
  employeeCode: z.string().min(1).max(64).optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
