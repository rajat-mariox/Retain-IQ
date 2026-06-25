import { z } from "zod";

export const cursorPaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type CursorPaginationQuery = z.infer<typeof cursorPaginationQuerySchema>;

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

