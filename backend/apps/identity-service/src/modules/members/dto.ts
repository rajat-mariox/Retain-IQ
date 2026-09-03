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

  // --- Compensation, decided AT HIRE ---
  // Required for staff (any non-Owner role); the Owner is not payroll staff and
  // is exempt. This seeds the employee's payroll profile v1 in the same tx as
  // the hire, so attendance/timesheets/leave flow straight into payroll.
  baseAmount: z.coerce.number().positive().max(1_000_000_000).optional(),
  currencyCode: z.string().length(3).optional(),
  payFrequency: z.enum(["MONTHLY", "SEMI_MONTHLY", "BIWEEKLY", "WEEKLY", "DAILY", "CUSTOM"]).optional(),
  paymentBasis: z.enum(["FIXED", "HOURLY", "DAILY"]).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD").optional(),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;
