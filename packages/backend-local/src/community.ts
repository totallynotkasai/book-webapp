/**
 * `Backend.community` in the browser (DESIGN.md §4.8; P1-COM-01, P1-COM-02): a Book's community
 * hub (endorsed first, then top-rated), ratings (one per reader per Layer, for Layers they hold),
 * Creator profiles with followers and a portfolio, and readers' reports, which raise Flags
 * (P1-ADM-02). Whether a Creator may make a Layer for a Book comes from `@book/domain`
 * (Invariant 19).
 */
import {
	BackendError,
	type Clock,
	type CommunityApi,
	type CreatorProfileDto,
	type LayerSummaryDto,
	type UserDto
} from '@book/core';
import { can, hasEntitlement, hubOrder, mayMakeFor } from '@book/domain';
import type { BackendDatabase } from './db';
import type { LayersModule } from './layers';
import type { ModerationModule } from './moderation';

export function createCommunityApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requireUser: () => UserDto;
	layers: LayersModule;
	moderation: ModerationModule;
	changed: () => void;
}): CommunityApi {
	const { db, clock } = deps;

	async function listedBook(bookId: string) {
		const book = await db.get('books', bookId);
		if (!book || book.listingState !== 'listed') {
			throw new BackendError('NOT_FOUND', 'That book isn’t in the store.');
		}
		return book;
	}

	async function profile(handle: string, user: UserDto): Promise<CreatorProfileDto> {
		const creator = await db.getFromIndex('creators', 'handle', handle);
		if (!creator) throw new BackendError('NOT_FOUND', 'There is no creator with that name.');
		const follows = await db.getAllFromIndex('follows', 'creatorId', creator.id);
		const records = [
			...(await db.getAll('illustrationPacks')),
			...(await db.getAll('audioTracks'))
		].filter((l) => l.creatorId === creator.id && l.listingState === 'listed');
		const layers = [];
		for (const record of records) {
			const book = await db.get('books', record.bookId);
			const summary = await deps.layers.summarise(record.id);
			if (!book || book.listingState !== 'listed' || !summary) continue;
			layers.push({ ...summary, bookTitle: book.title, bookSlug: book.slug });
		}
		const { id, handle: h, displayName, bio } = creator;
		return {
			creator: { id, handle: h, displayName, bio },
			followers: follows.length,
			following: follows.some((f) => f.userId === user.id),
			layers: layers.sort(hubOrder)
		};
	}

	return {
		async hub(bookId) {
			const user = deps.requireUser();
			const book = await listedBook(bookId);
			const layers = (await deps.layers.list(bookId))
				.filter((l) => l.creatorId !== book.creatorId)
				.sort(hubOrder);
			let blocked: string | null = null;
			if (!can(user.role, 'studio') || !user.creatorId) {
				blocked = 'Creators can make illustrations and narration for books whose authors allow it.';
			} else if (user.creatorId === book.creatorId) {
				blocked = 'This is your book: add official illustrations and narration in the Studio.';
			} else {
				const may = mayMakeFor(book, user.creatorId);
				if (!may.allowed) blocked = may.reason;
				else if ((await db.get('creators', user.creatorId))?.suspended) {
					blocked = 'Your account is suspended.';
				}
			}
			return {
				bookId,
				bookTitle: book.title,
				policy: book.communityPolicy,
				communityAi: book.communityAi,
				canSubmit: blocked === null,
				submitBlockedReason: blocked,
				layers
			};
		},

		async rate(layerId, stars): Promise<LayerSummaryDto> {
			const user = deps.requireUser();
			const layer =
				(await db.get('illustrationPacks', layerId)) ?? (await db.get('audioTracks', layerId));
			if (!layer || layer.listingState !== 'listed') {
				throw new BackendError('NOT_FOUND', 'That isn’t in the store.');
			}
			const kind = 'packUrl' in layer ? 'illustration_pack' : 'audio_track';
			const product = (await db.getAll('products')).find(
				(p) => p.kind === kind && p.refId === layerId
			);
			const entitlements = await db.getAllFromIndex('entitlements', 'userId', user.id);
			if (!product || !hasEntitlement(entitlements, user.id, product.id, clock.now())) {
				throw new BackendError('ENTITLEMENT_REQUIRED', 'Get it first, then rate it.');
			}
			// One rating per reader per Layer (P1-COM-02): rating again replaces it.
			await db.put('ratings', {
				id: `${layerId}|${user.id}`,
				layerId,
				userId: user.id,
				stars,
				createdAt: clock.now().toISOString()
			});
			deps.changed();
			return (await deps.layers.summarise(layerId))!;
		},

		async profile(handle) {
			return profile(handle, deps.requireUser());
		},

		async follow(handle, following) {
			const user = deps.requireUser();
			const creator = await db.getFromIndex('creators', 'handle', handle);
			if (!creator) throw new BackendError('NOT_FOUND', 'There is no creator with that name.');
			const id = `${user.id}|${creator.id}`;
			if (following) {
				await db.put('follows', {
					id,
					userId: user.id,
					creatorId: creator.id,
					createdAt: clock.now().toISOString()
				});
			} else {
				await db.delete('follows', id);
			}
			deps.changed();
			return profile(handle, user);
		},

		async report(input) {
			const user = deps.requireUser();
			const exists =
				input.targetType === 'book'
					? await db.get('books', input.targetId)
					: input.targetType === 'illustration_pack'
						? await db.get('illustrationPacks', input.targetId)
						: await db.get('audioTracks', input.targetId);
			if (!exists) throw new BackendError('NOT_FOUND', 'That isn’t in the store.');
			await deps.moderation.report(user.id, input);
		}
	};
}
