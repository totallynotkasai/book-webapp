import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/** Cursor paging, as the API will use (§10.1). Cursors are opaque strings. */
export const pageRequestSchema = z.object({
	cursor: z.string().min(1).optional(),
	limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional()
});

export type PageRequest = z.infer<typeof pageRequestSchema>;

export function pageSchema<T extends z.ZodType>(item: T) {
	return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export interface Page<T> {
	items: T[];
	/** Null on the last page. */
	nextCursor: string | null;
}
