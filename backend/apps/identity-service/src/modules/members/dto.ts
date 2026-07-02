import { z } from "zod";

export const addMemberSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email(),
  // Role to grant: prefer roleId (any org role); `role` name kept for back-compat.
  roleId: z.string().uuid().optional(),
  role: z.enum(["Manager", "Employee"]).optional(),
  // Department the person belongs to (real Department entity).
  departmentId: z.string().uuid().optional(),
  // Scope of the role grant. DEPARTMENT defaults its scopeId to departmentId.
  scopeType: z.enum(["ORG", "DEPARTMENT", "TEAM", "SELF"]).default("SELF"),
  scopeId: z.string().uuid().optional(),
  title: z.string().max(120).optional(),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;
