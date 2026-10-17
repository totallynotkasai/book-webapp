/**
 * `Backend.wishlist` in the browser (P1-STO-06; plan §6 Phase 1.18; Phase 6 serves it for real):
 * Books saved for later, and a sale alert in the inbox when a Book's price falls below the price
 * the reader last saw (D-042, `saleAlertDue` in `@book/domain`). Owning a Book takes it off, however
 * it was got (bought, claimed, granted), so the list is cleaned as it's read (Invariant 15 decides
 * what's owned).
 */
import {
	BackendError,
	type BookSummaryDto,
	type Clock,
	type Money,
	type UserDto,
	type WishlistApi,
	type WishlistEntryDto
} from '@book/core';
import { ownedProductIds, saleAlertDue } from '@book/domain';
import type { BackendDatabase, WishlistRecord } from './db';
import type { InboxModule } from './inbox';
import type { BookRecord } from './seed';

export interface WishlistModule extends WishlistApi {
	/** Whether a Book is on the signed-in reader's wishlist (and not owned), for its Book page. */
	has(userId: string, bookId: string): Promise<boolean>;
	/** A Book's price changed (the Studio's Book settings): alerts each reader it's now cheaper for. */
	priceChanged(bookId: string, price: Money): Promise<void>;
}

export function createWishlistApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requireUser: () => UserDto;
	summaries: (books: BookRecord[]) => Promise<BookSummaryDto[]>;
	inbox: InboxModule;
	changed: () => void;
}): WishlistModule {
	const { db, clock } = deps;
	const key = (userId: string, bookId: string) => `${userId}|${bookId}`;

	async function bookProductId(bookId: string): Promise<string | undefined> {
		return (await db.getAll('products')).find((p) => p.kind === 'book' && p.refId === bookId)?.id;
	}

	async function owns(userId: string, bookId: string): Promise<boolean> {
		const productId = await bookProductId(bookId);
		const entitlements = await db.getAllFromIndex('entitlements', 'userId', userId);
		return !!productId && ownedProductIds(entitlements, userId, clock.now()).has(productId);
	}

	/** The reader's entries, taking off Books they now own and Books no longer in the store. */
	async function entriesOf(
		userId: string
	): Promise<{ record: WishlistRecord; book: BookRecord }[]> {
		const out = [];
		let removed = false;
		for (const record of await db.getAllFromIndex('wishlists', 'userId', userId)) {
			const book = await db.get('books', record.bookId);
			if (!book || (await owns(userId, record.bookId))) {
				await db.delete('wishlists', record.id);
				removed = true;
				continue;
			}
			// A Book taken out of the store stays on the wishlist, but out of sight, until it's back.
			if (book.listingState === 'listed') out.push({ record, book });
		}
		if (removed) deps.changed();
		return out;
	}

	async function toDto(record: WishlistRecord, book: BookRecord): Promise<WishlistEntryDto> {
		const [summary] = await deps.summaries([book]);
		return { book: summary!, addedAt: record.addedAt, seenPrice: record.seenPrice };
	}

	return {
		async list() {
			const user = deps.requireUser();
			const entries = await entriesOf(user.id);
			entries.sort((a, b) => b.record.addedAt.localeCompare(a.record.addedAt));
			return Promise.all(entries.map(({ record, book }) => toDto(record, book)));
		},

		async add(bookId) {
			const user = deps.requireUser();
			const book = await db.get('books', bookId);
			if (!book || book.listingState !== 'listed') {
				throw new BackendError('NOT_FOUND', 'That book isn’t in the store.');
			}
			if (await owns(user.id, bookId)) {
				throw new BackendError('CONFLICT', 'That book is in your library already.');
			}
			const existing = await db.get('wishlists', key(user.id, bookId));
			if (existing) return toDto(existing, book);
			const product = (await db.getAll('products')).find(
				(p) => p.kind === 'book' && p.refId === bookId
			);
			if (!product) throw new BackendError('SERVER_ERROR', `Book ${bookId} has no Product.`);
			const record: WishlistRecord = {
				id: key(user.id, bookId),
				userId: user.id,
				bookId,
				addedAt: clock.now().toISOString(),
				seenPrice: product.price,
				alerted: false
			};
			await db.put('wishlists', record);
			deps.changed();
			return toDto(record, book);
		},

		async remove(bookId) {
			const user = deps.requireUser();
			const id = key(user.id, bookId);
			if (!(await db.get('wishlists', id))) return;
			await db.delete('wishlists', id);
			deps.changed();
		},

		async has(userId, bookId) {
			return !!(await db.get('wishlists', key(userId, bookId))) && !(await owns(userId, bookId));
		},

		async priceChanged(bookId, price) {
			const book = await db.get('books', bookId);
			if (!book) return;
			for (const record of await db.getAllFromIndex('wishlists', 'bookId', bookId)) {
				if (!saleAlertDue(record.seenPrice, price) || (await owns(record.userId, bookId))) continue;
				const now = price.amountMinor === 0 ? 'free' : priceText(price);
				const was = priceText(record.seenPrice);
				await deps.inbox.notify(
					{ userId: record.userId },
					{
						title: `${book.title} is now ${now}`,
						body: `It was ${was} when ${record.alerted ? 'we last told you' : 'you added it to your wishlist'}.`,
						about: { type: 'book_page', id: bookId, slug: book.slug }
					}
				);
				await db.put('wishlists', { ...record, seenPrice: price, alerted: true });
			}
		}
	};
}

/**
 * A price in a message's words, as the server writes them ("£2.99"). Every price is in GBP in
 * the PoC (SIMULATION: one currency until Phase 4); currencies keep their own minor units.
 */
function priceText(price: Money): string {
	const format = new Intl.NumberFormat('en-GB', { style: 'currency', currency: price.currency });
	const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
	return format.format(price.amountMinor / 10 ** digits);
}
