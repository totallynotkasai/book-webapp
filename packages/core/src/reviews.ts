/**
 * Reviews (P1-STO-07, DESIGN.md §4.8; simulated until Phase 6): a reader's stars and words on a
 * Book they own, showing how far they'd read when they wrote it. One per reader per Book.
 * Other readers' reviews come from seed data in the PoC (plan §4.7, "Other people").
 */
import { z } from 'zod';
import { ratingSummarySchema } from './layers';

const id = z.string().min(1);
const timestamp = z.iso.datetime();

/** The most a review can say. */
export const REVIEW_MAX_LENGTH = 4000;

export const reviewInputSchema = z.object({
	stars: z.number().int().min(1).max(5),
	/** Optional: stars alone are a review. */
	text: z.string().trim().max(REVIEW_MAX_LENGTH),
	/** Its text gives away the story: other readers see it only when they choose to (D-042). */
	spoilers: z.boolean(),
	/**
	 * How far the reviewer had read: their furthest Reading Progress (§9.5), 0–1. SIMULATION:
	 * sent by the device, as Reading Progress lives there until Phase 2's sync; Phase 6's server
	 * takes it from the synced progress instead.
	 */
	progression: z.number().min(0).max(1)
});
export type ReviewInput = z.input<typeof reviewInputSchema>;

export const reviewSchema = z.object({
	id,
	bookId: id,
	reviewerName: z.string().min(1),
	stars: z.number().int().min(1).max(5),
	text: z.string(),
	spoilers: z.boolean(),
	/** How far the reviewer had read when they wrote it, or last changed it: 0–1. */
	progression: z.number().min(0).max(1),
	createdAt: timestamp,
	/** When it was last changed; the same as `createdAt` if never. */
	updatedAt: timestamp,
	/** Written by the signed-in reader. */
	mine: z.boolean(),
	/** A moderator hid it after a report: only its writer still sees it (§10.6). */
	hidden: z.boolean()
});
export type ReviewDto = z.infer<typeof reviewSchema>;

/** A Book's reviews, a page at a time: everyone else's newest first, the reader's own apart. */
export const bookReviewsSchema = z.object({
	bookId: id,
	/** Over every review readers can see; null with none. */
	summary: ratingSummarySchema.nullable(),
	/** The signed-in reader's own review, hidden or not. */
	mine: reviewSchema.nullable(),
	/** They own the Book, so they can write (or change) one. */
	canReview: z.boolean(),
	items: z.array(reviewSchema),
	nextCursor: z.string().nullable()
});
export type BookReviewsDto = z.infer<typeof bookReviewsSchema>;
