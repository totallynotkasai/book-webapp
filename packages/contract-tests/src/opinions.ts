/**
 * Wishlists and reviews in the Backend contract (P1-STO-06, P1-STO-07; DESIGN.md §4.8): a Book
 * on the wishlist once, owning it takes it off, a lower price in the Studio alerts each reader who
 * wishlisted it once (D-042); one review per reader per Book they own, with how far they'd read,
 * reported into the moderation queue, where a moderator can hide or remove it.
 *
 * Seed assumptions: a reader Persona, two creator Personas (the first an author with a listed,
 * paid Book that neither the reader nor the second creator owns) and a moderator Persona; a
 * Book the reader owns; and a Book with at least two reviews by other readers.
 */
import type { Backend, BookSummaryDto, PersonaDto, Role } from '@book/core';
import { describe, expect, it } from 'vitest';
import { expectBackendError } from './backend';
import type { ManualClock } from './clock';

interface Context {
	backend(): Backend;
	clock(): ManualClock;
	personas(): PersonaDto[];
	conforms(module: string, method: string, value: unknown): void;
}

const DAY = 24 * 60 * 60 * 1000;

export function describeOpinionsContract(ctx: Context): void {
	const { conforms } = ctx;
	const persona = (role: Role, nth = 0) => {
		const found = ctx.personas().filter((p) => p.user.role === role)[nth];
		if (!found) throw new Error(`The seed needs ${nth + 1} ${role} Persona(s)`);
		return found;
	};
	const as = (role: Role, nth = 0) => ctx.backend().session.signInAs(persona(role, nth).id);
	const reader = () => as('reader');
	const author = () => as('creator', 0);
	const otherReader = () => as('creator', 1);
	const moderator = () => as('moderator');

	async function books(): Promise<BookSummaryDto[]> {
		return (await ctx.backend().catalogue.listBooks({ limit: 100 })).items;
	}

	/** The author's listed, paid Book, which the reader doesn't own. */
	async function authorsPaidBook(): Promise<BookSummaryDto> {
		await author();
		const own = (await ctx.backend().studio.listBooks({ limit: 100 })).items.map((b) => b.id);
		await reader();
		const book = (await books()).find(
			(b) => own.includes(b.id) && b.price.amountMinor > 0 && !b.inLibrary
		);
		if (!book) throw new Error('The seed needs an author’s paid Book the reader doesn’t own');
		return book;
	}

	describe('wishlist (P1-STO-06)', () => {
		it('adds a listed Book once, shows it on its page, and takes it off', async () => {
			const backend = ctx.backend();
			await reader();
			const book = (await books()).find((b) => !b.inLibrary)!;
			const added = await backend.wishlist.add(book.id);
			conforms('wishlist', 'add', added);
			expect(added.book.id).toBe(book.id);
			expect(added.seenPrice).toEqual(book.price);
			await backend.wishlist.add(book.id);
			const list = await backend.wishlist.list();
			conforms('wishlist', 'list', list);
			expect(list.map((e) => e.book.id)).toEqual([book.id]);
			expect((await backend.catalogue.getBook(book.slug)).wishlisted).toBe(true);

			await backend.wishlist.remove(book.id);
			await backend.wishlist.remove(book.id);
			expect(await backend.wishlist.list()).toEqual([]);
			expect((await backend.catalogue.getBook(book.slug)).wishlisted).toBe(false);
		});

		it('keeps each reader’s own wishlist, newest first', async () => {
			const backend = ctx.backend();
			await reader();
			const [a, b] = (await books()).filter((x) => !x.inLibrary);
			await backend.wishlist.add(a!.id);
			ctx.clock().advance(1000);
			await backend.wishlist.add(b!.id);
			expect((await backend.wishlist.list()).map((e) => e.book.id)).toEqual([b!.id, a!.id]);
			await moderator();
			expect(await backend.wishlist.list()).toEqual([]);
		});

		it('refuses a Book already in the library, and owning one takes it off', async () => {
			const backend = ctx.backend();
			await reader();
			const all = await books();
			const owned = all.find((b) => b.inLibrary);
			if (!owned) throw new Error('The seed needs a Book the reader owns');
			await expectBackendError(backend.wishlist.add(owned.id), 'CONFLICT');
			await expectBackendError(backend.wishlist.add('no-such-book'), 'NOT_FOUND');

			const free = all.find((b) => !b.inLibrary && b.price.amountMinor === 0);
			if (!free) throw new Error('The seed needs a free Book the reader doesn’t own');
			await backend.wishlist.add(free.id);
			const page = await backend.catalogue.getBook(free.slug);
			await backend.checkout.claim(page.offers.find((o) => o.kind === 'book')!.productId);
			expect(await backend.wishlist.list()).toEqual([]);
			expect((await backend.catalogue.getBook(free.slug)).wishlisted).toBe(false);
		});

		it('a lower price in the Studio alerts each reader who wishlisted it, once (D-042)', async () => {
			const backend = ctx.backend();
			const book = await authorsPaidBook();
			const price = book.price;
			const at = (amountMinor: number) => ({ amountMinor, currency: price.currency });
			await reader();
			await backend.wishlist.add(book.id);
			await otherReader();
			await backend.wishlist.add(book.id);
			const alerts = async () =>
				(await backend.inbox.list()).filter((m) => m.about?.type === 'book_page');

			await author();
			await backend.studio.updateBook(book.id, { price: at(price.amountMinor - 100) });
			for (const who of [reader, otherReader]) {
				await who();
				const messages = await alerts();
				expect(messages).toHaveLength(1);
				expect(messages[0]!.about).toMatchObject({ id: book.id, slug: book.slug });
				expect(messages[0]!.title).toContain(book.title);
			}
			await moderator();
			expect(await alerts()).toEqual([]);
			await reader();
			expect((await backend.wishlist.list())[0]!.seenPrice).toEqual(at(price.amountMinor - 100));

			// A rise, the same price again, and a drop back above the last alert's: nothing new.
			await author();
			await backend.studio.updateBook(book.id, { price: at(price.amountMinor + 200) });
			await backend.studio.updateBook(book.id, { price: at(price.amountMinor - 50) });
			await backend.studio.updateBook(book.id, { price: at(price.amountMinor - 100) });
			await reader();
			expect(await alerts()).toHaveLength(1);

			// Below the last alert's price: a second one.
			await author();
			await backend.studio.updateBook(book.id, { price: at(0) });
			await reader();
			expect(await alerts()).toHaveLength(2);
		});
	});

	describe('reviews (P1-STO-07)', () => {
		async function ownedBook() {
			await reader();
			const book = (await books()).find((b) => b.inLibrary);
			if (!book) throw new Error('The seed needs a Book the reader owns');
			return book;
		}

		const review = {
			stars: 4,
			text: 'Halfway, and loving it.',
			spoilers: false,
			progression: 0.45
		};

		it('one review per reader per Book they own, with how far they’d read', async () => {
			const backend = ctx.backend();
			const book = await ownedBook();
			const before = await backend.reviews.list(book.id);
			expect(before.canReview).toBe(true);
			expect(before.mine).toBeNull();

			const saved = await backend.reviews.save(book.id, {
				...review,
				text: '  Halfway, and loving it. '
			});
			conforms('reviews', 'save', saved);
			expect(saved).toMatchObject({ ...review, mine: true, hidden: false });
			ctx.clock().advance(DAY);
			const changed = await backend.reviews.save(book.id, {
				...review,
				stars: 5,
				progression: 0.8
			});
			expect(changed.id).toBe(saved.id);
			expect(changed.createdAt).toBe(saved.createdAt);
			expect(changed.updatedAt > saved.updatedAt).toBe(true);

			const after = await backend.reviews.list(book.id);
			conforms('reviews', 'list', after);
			expect(after.mine).toMatchObject({ stars: 5, progression: 0.8 });
			expect(after.items.some((r) => r.mine)).toBe(false);
			// Everyone else sees it once, among the others.
			await moderator();
			const seen = await backend.reviews.list(book.id, { limit: 100 });
			expect(seen.items.filter((r) => r.id === saved.id)).toHaveLength(1);
		});

		it('refuses a review of a Book the reader doesn’t own', async () => {
			const backend = ctx.backend();
			await reader();
			const book = (await books()).find((b) => !b.inLibrary)!;
			expect((await backend.reviews.list(book.id)).canReview).toBe(false);
			await expectBackendError(backend.reviews.save(book.id, review), 'ENTITLEMENT_REQUIRED');
			await expectBackendError(backend.reviews.list('no-such-book'), 'NOT_FOUND');
		});

		it('pages other readers’ reviews newest first, and averages every visible one', async () => {
			const backend = ctx.backend();
			await reader();
			let reviewed: BookSummaryDto | undefined;
			for (const book of await books()) {
				if (((await backend.reviews.list(book.id)).summary?.count ?? 0) >= 2) {
					reviewed = book;
					break;
				}
			}
			if (!reviewed) throw new Error('The seed needs a Book with two reviews');
			const all = await backend.reviews.list(reviewed.id, { limit: 100 });
			const dates = all.items.map((r) => r.createdAt);
			expect(dates).toEqual([...dates].sort().reverse());
			const average = all.items.reduce((sum, r) => sum + r.stars, 0) / all.items.length;
			expect(all.summary).toEqual({
				average: Math.round(average * 10) / 10,
				count: all.items.length
			});
			const first = await backend.reviews.list(reviewed.id, { limit: 1 });
			expect(first.items).toHaveLength(1);
			expect(first.nextCursor).not.toBeNull();
			const second = await backend.reviews.list(reviewed.id, {
				limit: 1,
				cursor: first.nextCursor!
			});
			expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
		});

		it('a report reaches the queue; hidden, only its writer sees it; removed, it’s gone', async () => {
			const backend = ctx.backend();
			const book = await ownedBook();
			const saved = await backend.reviews.save(book.id, review);
			await otherReader();
			await backend.community.report({
				targetType: 'review',
				targetId: saved.id,
				reason: 'inappropriate',
				details: 'Rude about other readers.'
			});
			await expectBackendError(
				backend.community.report({
					targetType: 'review',
					targetId: 'no-such-review',
					reason: 'spam',
					details: ''
				}),
				'NOT_FOUND'
			);

			await moderator();
			const flag = (await backend.moderation.listQueue({ limit: 100 })).items.find(
				(f) => f.targetType === 'review' && f.targetId === saved.id
			);
			expect(flag).toBeDefined();
			const detail = await backend.moderation.getFlag(flag!.id);
			expect(detail.target.excerpt).toContain('Halfway, and loving it.');
			expect(detail.target.bookTitle).toBe(book.title);
			await expectBackendError(
				backend.moderation.act(flag!.id, { action: 'suspend', reason: 'Not for reviews.' }),
				'VALIDATION_FAILED'
			);
			await backend.moderation.act(flag!.id, { action: 'hide', reason: 'Personal attacks.' });

			await otherReader();
			const others = await backend.reviews.list(book.id, { limit: 100 });
			expect(others.items.some((r) => r.id === saved.id)).toBe(false);
			await reader();
			const mine = await backend.reviews.list(book.id);
			expect(mine.mine).toMatchObject({ id: saved.id, hidden: true });
			const told = (await backend.inbox.list()).find((m) => m.about?.type === 'review');
			expect(told?.about).toMatchObject({ id: saved.id });
			// Editing doesn't bring it back.
			expect((await backend.reviews.save(book.id, review)).hidden).toBe(true);

			await otherReader();
			await backend.community.report({
				targetType: 'review',
				targetId: saved.id,
				reason: 'spam',
				details: ''
			});
			await moderator();
			const again = (await backend.moderation.listQueue({ limit: 100 })).items.find(
				(f) => f.targetType === 'review' && f.targetId === saved.id
			);
			await backend.moderation.act(again!.id, { action: 'remove', reason: 'Still abusive.' });
			await reader();
			expect((await backend.reviews.list(book.id)).mine).toBeNull();
		});

		it('the reader deletes their own review', async () => {
			const backend = ctx.backend();
			const book = await ownedBook();
			await backend.reviews.save(book.id, review);
			await backend.reviews.remove(book.id);
			await backend.reviews.remove(book.id);
			expect((await backend.reviews.list(book.id)).mine).toBeNull();
		});
	});
}
