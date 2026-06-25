import { z } from "zod";

export const addMemberSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email(),
  role: z.enum(["Manager", "Employee"]).default("Employee"),
  department: z.string().max(80).optional(),
  title: z.string().max(120).optional(),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;
