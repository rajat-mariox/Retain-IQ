import { z } from "zod";

export const idempotencyKeySchema = z.string().min(16).max(200);

export type IdempotencyState = "started" | "completed" | "failed";

export type IdempotencyRecord<TResponse = unknown> = {
  orgId: string;
  key: string;
  requestHash: string;
  state: IdempotencyState;
  response?: TResponse;
  expiresAt: Date;
};

