import { z } from "zod";

export const requestContextSchema = z.object({
  requestId: z.string().uuid(),
  traceId: z.string().min(1),
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  membershipId: z.string().uuid(),
  role: z.string().min(1),
  permissionsVersion: z.number().int().nonnegative(),
  ipAddress: z.string().min(1),
  userAgent: z.string().min(1),
});

export type RequestContext = z.infer<typeof requestContextSchema>;

export const systemTenantContextSchema = z.object({
  requestId: z.string().uuid(),
  traceId: z.string().min(1),
  orgId: z.string().uuid(),
  actor: z.literal("system"),
  jobId: z.string().uuid(),
});

export type SystemTenantContext = z.infer<typeof systemTenantContextSchema>;

export type TenantContext = RequestContext | SystemTenantContext;

