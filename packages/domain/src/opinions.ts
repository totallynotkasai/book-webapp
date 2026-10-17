/**
 * Wishlists and reviews (P1-STO-06, P1-STO-07; DESIGN.md §4.8), shared by `backend-local` now and
 * Phase 6's server: when a wishlisted Book's price change sends a sale alert, and who sees a
 * review and its rating.
 */
import type { Money } from '@book/core';
import { ratingSummary } from './community';

/**
 * A sale alert is due when a wishlisted Book's price falls below the price the reader last saw:
 * when they added it, or in their last alert (D-042). Rises send nothing, and an author moving
 * the price down and up again can't send the same news twice. Only a price in the same currency
 * compares (Invariant 17).
 */
export function saleAlertDue(seen: Money, now: Money): boolean {
	return now.currency === seen.currency && now.amountMinor < seen.amountMinor;
}

export interface ReviewShape {
	userId: string;
	stars: number;
	/** `hidden`: a moderator hid it after a report (§10.6). */
	state: 'visible' | 'hidden';
	createdAt: string;
}

/** Everyone sees a review until a moderator hides it; then only the reader who wrote it does. */
export function reviewVisibleTo(review: ReviewShape, userId: string | null): boolean {
	return review.state === 'visible' || review.userId === userId;
}

/** The stars every reader can see, as an average to one decimal place; hidden ones don't count. */
export function reviewSummary(reviews: readonly ReviewShape[]) {
	return ratingSummary(reviews.filter((r) => r.state === 'visible'));
}

/** Newest first; ties keep a stable order. */
export function reviewOrder(a: ReviewShape & { id: string }, b: ReviewShape & { id: string }) {
	return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}
