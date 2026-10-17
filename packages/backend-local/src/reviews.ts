/**
 * `Backend.reviews` in the browser (P1-STO-07; plan §6 Phase 1.18; Phase 6 serves it for real):
 * one review per reader per Book they own (Invariant 15 decides), with how far they'd read.
 * Other readers' reviews are seeded. Reports go through `community.report`; a moderator can hide
 * or remove a review (§10.6), and a hidden one is seen only by its writer (`reviewVisibleTo`).
 */
import {
	BackendError,
	reviewInputSchema,
	type Clock,
	type ReviewDto,
	type ReviewsApi,
	type UserDto
} from '@book/core';
import { ownedProductIds, reviewOrder, reviewSummary, reviewVisibleTo } from '@book/domain';
import type { BackendDatabase, ReviewRecord } from './db';
import { paginate } from './paging';

export interface ReviewsModule extends ReviewsApi {
	/** A review, for the moderator's Flag detail. */
	get(reviewId: string): Promise<ReviewRecord | undefined>;
	/** A moderator's decision (§10.6): shown again, hidden, or removed for good. */
	moderate(reviewId: string, outcome: 'visible' | 'hidden' | 'removed'): Promise<void>;
}

export function createReviewsApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requireUser: () => UserDto;
	/** The signed-in user, or null: anyone can read reviews. */
	currentUser: () => UserDto | null;
	changed: () => void;
}): ReviewsModule {
	const { db, clock } = deps;
	const key = (userId: string, bookId: string) => `${userId}|${bookId}`;

	async function listedBook(bookId: string) {
		const book = await db.get('books', bookId);
		if (!book || book.listingState !== 'listed') {
			throw new BackendError('NOT_FOUND', 'That book isn’t in the store.');
		}
		return book;
	}

	async function owns(userId: string, bookId: string): Promise<boolean> {
		const product = (await db.getAll('products')).find(
			(p) => p.kind === 'book' && p.refId === bookId
		);
		const entitlements = await db.getAllFromIndex('entitlements', 'userId', userId);
		return !!product && ownedProductIds(entitlements, userId, clock.now()).has(product.id);
	}

	function toDto(record: ReviewRecord, userId: string | null): ReviewDto {
		return {
			id: record.id,
			bookId: record.bookId,
			reviewerName: record.reviewerName,
			stars: record.stars,
			text: record.text,
			spoilers: record.spoilers,
			progression: record.progression,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
			mine: record.userId === userId,
			hidden: record.state === 'hidden'
		};
	}

	return {
		async list(bookId, page) {
			await listedBook(bookId);
			const userId = deps.currentUser()?.id ?? null;
			const all = await db.getAllFromIndex('reviews', 'bookId', bookId);
			const mine = userId ? all.find((r) => r.userId === userId) : undefined;
			const others = all
				.filter((r) => r.userId !== userId && reviewVisibleTo(r, userId))
				.sort(reviewOrder);
			return {
				bookId,
				summary: reviewSummary(all),
				mine: mine ? toDto(mine, userId) : null,
				canReview: userId ? await owns(userId, bookId) : false,
				...paginate(
					others.map((r) => toDto(r, userId)),
					page
				)
			};
		},

		async save(bookId, raw) {
			const user = deps.requireUser();
			await listedBook(bookId);
			if (!(await owns(user.id, bookId))) {
				throw new BackendError('ENTITLEMENT_REQUIRED', 'Get the book to review it.');
			}
			const input = reviewInputSchema.parse(raw);
			const existing = await db.get('reviews', key(user.id, bookId));
			const now = clock.now().toISOString();
			const record: ReviewRecord = {
				id: key(user.id, bookId),
				userId: user.id,
				bookId,
				reviewerName: user.displayName,
				stars: input.stars,
				text: input.text,
				spoilers: input.spoilers,
				// How far they'd read when they wrote it, or last changed it.
				progression: input.progression,
				// Editing a hidden review doesn't bring it back: a moderator does.
				state: existing?.state ?? 'visible',
				createdAt: existing?.createdAt ?? now,
				updatedAt: now
			};
			await db.put('reviews', record);
			deps.changed();
			return toDto(record, user.id);
		},

		async remove(bookId) {
			const user = deps.requireUser();
			const id = key(user.id, bookId);
			if (!(await db.get('reviews', id))) return;
			await db.delete('reviews', id);
			deps.changed();
		},

		get: (reviewId) => db.get('reviews', reviewId),

		async moderate(reviewId, outcome) {
			const record = await db.get('reviews', reviewId);
			if (!record) return;
			if (outcome === 'removed') await db.delete('reviews', reviewId);
			else await db.put('reviews', { ...record, state: outcome });
			deps.changed();
		}
	};
}
