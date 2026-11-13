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

/** Offset (page-number) pagination — used by list endpoints that need a total. */
export const offsetPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export type OffsetPaginationQuery = z.infer<typeof offsetPaginationQuerySchema>;

export type OffsetPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

