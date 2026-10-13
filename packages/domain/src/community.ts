/**
 * Community rules (DESIGN.md §4.8, §6.6, §10.6; P1-COM-01, P1-COM-02), shared by `backend-local`
 * now and the API from Phase 5: whether a Creator may make a Layer for someone else's Book, where
 * it goes when submitted, ratings, and the hub's order.
 *
 * Invariant 19: community content requires the author's policy to allow it.
 */
import type { AiUse, CommunityAi, CommunityPolicy } from '@book/core';

export interface CommunityBook {
	creatorId: string;
	communityPolicy: CommunityPolicy;
	communityAi: CommunityAi;
}

export type CommunityDecision =
	{ allowed: true; state: 'pending' | 'listed' } | { allowed: false; reason: string };

/** Whether a Creator may start a Layer for this Book at all (before the AI question). */
export function mayMakeFor(book: CommunityBook, creatorId: string): CommunityDecision {
	if (book.creatorId === creatorId) return { allowed: true, state: 'listed' };
	if (book.communityPolicy === 'closed') {
		return {
			allowed: false,
			reason: 'The author doesn’t accept community illustrations or narration for this book.'
		};
	}
	return { allowed: true, state: book.communityPolicy === 'approval' ? 'pending' : 'listed' };
}

/**
 * Where a submitted Layer goes (§6.6): the author's own is listed; a community one is refused
 * under `closed`, waits for the author under `approval`, is listed under `open` (moderation
 * still applies). The AI answer is required, and AI-generated community Layers are refused
 * where the author refuses them (§10.6).
 */
export function submission(
	book: CommunityBook,
	layer: { creatorId: string; aiUse: AiUse | null }
): CommunityDecision {
	const may = mayMakeFor(book, layer.creatorId);
	if (!may.allowed) return may;
	if (!layer.aiUse) return { allowed: false, reason: 'Answer “Was AI used to make this?” first.' };
	if (
		book.creatorId !== layer.creatorId &&
		layer.aiUse === 'generated' &&
		book.communityAi === 'refused'
	) {
		return {
			allowed: false,
			reason: 'The author doesn’t accept AI-generated community content for this book.'
		};
	}
	return may;
}

export interface Rating {
	stars: number;
}

/** Average stars to one decimal place, or null with no ratings. */
export function ratingSummary(
	ratings: readonly Rating[]
): { average: number; count: number } | null {
	if (!ratings.length) return null;
	const total = ratings.reduce((sum, r) => sum + r.stars, 0);
	return { average: Math.round((total / ratings.length) * 10) / 10, count: ratings.length };
}

/** The hub's order (§4.8): endorsed first, then top-rated, then most-rated, then by name. */
export function hubOrder<
	T extends { endorsed: boolean; name: string; rating: { average: number; count: number } | null }
>(a: T, b: T): number {
	return (
		Number(b.endorsed) - Number(a.endorsed) ||
		(b.rating?.average ?? 0) - (a.rating?.average ?? 0) ||
		(b.rating?.count ?? 0) - (a.rating?.count ?? 0) ||
		a.name.localeCompare(b.name)
	);
}
