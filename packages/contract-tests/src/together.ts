/**
 * Readers together in the Backend contract (P1-COM-03, P1-COM-04; DESIGN.md §4.8): a Chapter's
 * comments on passages, in reading order on the current Revision, with one level of replies;
 * anyone who can open a Chapter reads them, only owners write (D-044) and only while the author
 * allows it; writers delete their own; reports reach the moderation queue, where a moderator can
 * hide or remove one; and comments move to a new Revision. Popular highlights are passages at
 * least `minReaders` readers highlighted, with how many and never who.
 *
 * Seed assumptions: every Persona owns a Book with other readers' comments in one of its Chapters
 * and popular highlights in it; the first creator Persona is the author of a listed, paid Book
 * the reader doesn't own, with comments in its first Chapter and more Chapters than its sample.
 */
import {
	wordIndexSchema,
	type Backend,
	type BookSummaryDto,
	type ChapterCommentsDto,
	type PersonaDto,
	type RangeAnchor,
	type Role
} from '@book/core';
import { describe, expect, it } from 'vitest';
import { expectBackendError } from './backend';
import type { StudioFixtures } from './studio';

interface Context {
	backend(): Backend;
	personas(): PersonaDto[];
	conforms(module: string, method: string, value: unknown): void;
	fixtures?: StudioFixtures;
}

export function describeTogetherContract(ctx: Context): void {
	const { conforms } = ctx;
	const persona = (role: Role, nth = 0) => {
		const found = ctx.personas().filter((p) => p.user.role === role)[nth];
		if (!found) throw new Error(`The seed needs ${nth + 1} ${role} Persona(s)`);
		return found;
	};
	const as = (role: Role, nth = 0) => ctx.backend().session.signInAs(persona(role, nth).id);
	const reader = () => as('reader');
	const author = () => as('creator', 0);
	const moderator = () => as('moderator');

	/** A Book's Chapters with Words, and the Words of one, read as the reader reads them. */
	async function chaptersOf(bookId: string) {
		const backend = ctx.backend();
		const opened = await backend.content.open(bookId, { sample: true });
		const manifest = JSON.parse(
			await (await backend.content.read(opened.contentToken, 'manifest.json')).text()
		) as { chapters: { chapterId: string; wordCount: number; linear: boolean }[] };
		const locked = new Set(opened.locked.map((l) => l.chapterId));
		const chapters = manifest.chapters.filter((c) => c.linear && c.wordCount > 0);
		return {
			revisionId: opened.revisionId,
			readable: chapters.filter((c) => !locked.has(c.chapterId)).map((c) => c.chapterId),
			locked: chapters.filter((c) => locked.has(c.chapterId)).map((c) => c.chapterId),
			async words(chapterId: string) {
				return wordIndexSchema.parse(
					JSON.parse(
						await (
							await backend.content.read(opened.contentToken, `index/${chapterId}.words.json`)
						).text()
					)
				);
			}
		};
	}

	function rangeOn(
		bookId: string,
		revisionId: string,
		index: Awaited<ReturnType<Awaited<ReturnType<typeof chaptersOf>>['words']>>,
		from: number,
		to: number
	): RangeAnchor {
		return {
			kind: 'range',
			bookId,
			revisionId,
			startWordId: index.words[from]![0],
			endWordId: index.words[to]![0],
			startOrdinal: index.firstOrdinal + from,
			endOrdinal: index.firstOrdinal + to,
			quote: { exact: 'unused', prefix: '', suffix: '' }
		};
	}

	/** The reader's Book with other readers' comments, and the first Chapter that has some. */
	async function commentedBook(): Promise<{
		book: BookSummaryDto;
		chapter: ChapterCommentsDto;
	}> {
		const backend = ctx.backend();
		await reader();
		for (const entry of (await backend.library.list({ limit: 100 })).items) {
			for (const chapterId of (await chaptersOf(entry.book.id)).readable) {
				const chapter = await backend.comments.list(entry.book.id, chapterId);
				if (chapter.comments.length) return { book: entry.book, chapter };
			}
		}
		throw new Error('The seed needs a Book the reader owns with other readers’ comments');
	}

	/** The author's listed, paid Book that the reader doesn't own. */
	async function authorsBook(): Promise<BookSummaryDto> {
		const backend = ctx.backend();
		await author();
		const own = (await backend.studio.listBooks({ limit: 100 })).items.map((b) => b.id);
		await reader();
		const book = (await backend.catalogue.listBooks({ limit: 100 })).items.find(
			(b) => own.includes(b.id) && b.price.amountMinor > 0 && !b.inLibrary
		);
		if (!book) throw new Error('The seed needs an author’s paid Book the reader doesn’t own');
		return book;
	}

	describe('comments (P1-COM-03)', () => {
		it('lists a Chapter’s comments in reading order on the current Revision, with replies', async () => {
			const { book, chapter } = await commentedBook();
			conforms('comments', 'list', chapter);
			const opened = await ctx.backend().content.open(book.id);
			expect(chapter).toMatchObject({
				bookId: book.id,
				revisionId: opened.revisionId,
				allowed: true,
				canComment: true
			});
			const starts = chapter.comments.map((c) => c.anchor.startOrdinal);
			expect(starts).toEqual([...starts].sort((a, b) => a - b));
			for (const c of chapter.comments) {
				expect(c.anchor.revisionId).toBe(opened.revisionId);
				expect(c.chapterId).toBe(chapter.chapterId);
				expect(c.mine).toBe(false);
				const times = c.replies.map((r) => r.createdAt);
				expect(times).toEqual([...times].sort());
			}
			expect(chapter.comments.some((c) => c.replies.length > 0)).toBe(true);
		});

		it('an owner comments on a passage and replies; others see it; writers delete their own', async () => {
			const backend = ctx.backend();
			const { book, chapter } = await commentedBook();
			const { revisionId, words } = await chaptersOf(book.id);
			const anchor = rangeOn(book.id, revisionId, await words(chapter.chapterId), 3, 7);

			const added = await backend.comments.add(book.id, {
				anchor,
				text: '  A comment of my own.  ',
				spoilers: false
			});
			conforms('comments', 'add', added);
			expect(added).toMatchObject({
				text: 'A comment of my own.',
				mine: true,
				deleted: false,
				chapterId: chapter.chapterId,
				replies: []
			});
			expect(added.anchor).toMatchObject({
				startWordId: anchor.startWordId,
				endWordId: anchor.endWordId,
				revisionId
			});
			expect(added.anchor.quote.exact.length).toBeGreaterThan(0);

			await moderator();
			const replied = await backend.comments.reply(added.id, { text: 'A reply.', spoilers: true });
			conforms('comments', 'reply', replied);
			expect(replied.id).toBe(added.id);
			expect(replied.mine).toBe(false);
			expect(replied.replies).toMatchObject([{ text: 'A reply.', spoilers: true, mine: true }]);
			// A reply to a reply joins the comment's thread.
			const again = await backend.comments.reply(replied.replies[0]!.id, {
				text: 'And another.',
				spoilers: false
			});
			expect(again.replies.map((r) => r.text)).toEqual(['A reply.', 'And another.']);
			await expectBackendError(backend.comments.remove(added.id), 'FORBIDDEN');

			// Deleted with replies: its words go, its place stays for them.
			await reader();
			await backend.comments.remove(added.id);
			await backend.comments.remove(added.id);
			let mine = (await backend.comments.list(book.id, chapter.chapterId)).comments.find(
				(c) => c.id === added.id
			);
			expect(mine).toMatchObject({ deleted: true, text: '', authorName: '', mine: false });
			expect(mine?.replies).toHaveLength(2);

			// The last reply gone, so is the comment.
			await moderator();
			for (const r of again.replies) await backend.comments.remove(r.id);
			mine = (await backend.comments.list(book.id, chapter.chapterId)).comments.find(
				(c) => c.id === added.id
			);
			expect(mine).toBeUndefined();
		});

		it('sample readers read comments but don’t write them; refuses what isn’t in the Book', async () => {
			const backend = ctx.backend();
			const book = await authorsBook();
			const { revisionId, readable, locked, words } = await chaptersOf(book.id);
			const chapters = await Promise.all(
				readable.map((chapterId) => backend.comments.list(book.id, chapterId))
			);
			for (const c of chapters) expect(c).toMatchObject({ allowed: true, canComment: false });
			const first = chapters.find((c) => c.comments.length > 0);
			expect(first, 'comments in the sample').toBeDefined();
			const index = await words(first!.chapterId);
			const anchor = rangeOn(book.id, revisionId, index, 0, 2);
			await expectBackendError(
				backend.comments.add(book.id, { anchor, text: 'Hello', spoilers: false }),
				'ENTITLEMENT_REQUIRED'
			);
			await expectBackendError(
				backend.comments.reply(first!.comments[0]!.id, { text: 'Hello', spoilers: false }),
				'ENTITLEMENT_REQUIRED'
			);
			expect(locked.length).toBeGreaterThan(0);
			await expectBackendError(backend.comments.list(book.id, locked[0]!), 'ENTITLEMENT_REQUIRED');
			await expectBackendError(backend.comments.list(book.id, 'no-such-chapter'), 'NOT_FOUND');

			// The author owns it: a passage on another Revision, or Words that aren't its own.
			await author();
			await expectBackendError(
				backend.comments.add(book.id, {
					anchor: { ...anchor, revisionId: 'an-older-revision' },
					text: 'Hello',
					spoilers: false
				}),
				'CONFLICT'
			);
			await expectBackendError(
				backend.comments.add(book.id, {
					anchor: { ...anchor, startWordId: anchor.endWordId, endWordId: anchor.startWordId },
					text: 'Hello',
					spoilers: false
				}),
				'VALIDATION_FAILED'
			);
			await expectBackendError(
				backend.comments.add(book.id, { anchor, text: '   ', spoilers: false }),
				'VALIDATION_FAILED'
			);
		});

		it('the author can turn comments off for their Book, and on again (D-044)', async () => {
			const backend = ctx.backend();
			const book = await authorsBook();
			const { readable } = await chaptersOf(book.id);
			let before: ChapterCommentsDto | undefined;
			for (const id of readable) {
				const chapter = await backend.comments.list(book.id, id);
				if (chapter.comments.length) before ??= chapter;
			}
			const chapterId = before!.chapterId;

			await author();
			const detail = await backend.studio.updateBook(book.id, { readerComments: false });
			expect(detail.settings.readerComments).toBe(false);
			const off = await backend.comments.list(book.id, chapterId);
			expect(off).toMatchObject({ allowed: false, canComment: false, comments: [] });
			const { revisionId, words } = await chaptersOf(book.id);
			await expectBackendError(
				backend.comments.add(book.id, {
					anchor: rangeOn(book.id, revisionId, await words(chapterId), 0, 1),
					text: 'Hello',
					spoilers: false
				}),
				'FORBIDDEN'
			);

			await backend.studio.updateBook(book.id, { readerComments: true });
			await reader();
			expect((await backend.comments.list(book.id, chapterId)).comments).toEqual(before!.comments);
		});

		it('a reported comment reaches the queue; hidden, only its writer sees it; removed, it’s gone', async () => {
			const backend = ctx.backend();
			const { book, chapter } = await commentedBook();
			const { revisionId, words } = await chaptersOf(book.id);
			const added = await backend.comments.add(book.id, {
				anchor: rangeOn(book.id, revisionId, await words(chapter.chapterId), 10, 12),
				text: 'Something to report.',
				spoilers: false
			});

			await moderator();
			await backend.community.report({
				targetType: 'comment',
				targetId: added.id,
				reason: 'spam',
				details: ''
			});
			const flag = (await backend.moderation.listQueue({ limit: 100 })).items.find(
				(f) => f.targetType === 'comment' && f.targetId === added.id
			);
			expect(flag?.rule).toBe('report');
			const detail = await backend.moderation.getFlag(flag!.id);
			expect(detail.target.excerpt).toContain('Something to report.');
			await backend.moderation.act(flag!.id, { action: 'hide', reason: 'Spam, as reported.' });
			const others = await backend.comments.list(book.id, chapter.chapterId);
			expect(others.comments.some((c) => c.id === added.id)).toBe(false);

			await reader();
			const theirs = (await backend.comments.list(book.id, chapter.chapterId)).comments.find(
				(c) => c.id === added.id
			);
			expect(theirs).toMatchObject({ hidden: true, mine: true });
			const inbox = await backend.inbox.list();
			expect(inbox[0]?.title).toContain('comment');
			expect(inbox[0]?.about).toMatchObject({ type: 'comment', id: added.id, slug: book.slug });

			await backend.community.report({
				targetType: 'comment',
				targetId: chapter.comments[0]!.id,
				reason: 'other',
				details: 'Testing removal'
			});
			await moderator();
			const second = (await backend.moderation.listQueue({ limit: 100 })).items.find(
				(f) => f.targetId === chapter.comments[0]!.id
			);
			await backend.moderation.act(second!.id, {
				action: 'remove',
				reason: 'Removed for the test.'
			});
			expect(
				(await backend.comments.list(book.id, chapter.chapterId)).comments.some(
					(c) => c.id === chapter.comments[0]!.id
				)
			).toBe(false);
			await expectBackendError(
				backend.community.report({
					targetType: 'comment',
					targetId: chapter.comments[0]!.id,
					reason: 'spam',
					details: ''
				}),
				'NOT_FOUND'
			);
		});

		if (ctx.fixtures) {
			const fixtures = ctx.fixtures;
			it('comments move to a new Revision with the text they’re on (§6.2)', async () => {
				const backend = ctx.backend();
				await author();
				const blob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]);
				const waitFor = async (bookId: string, revisionId: string) => {
					for (let i = 0; i < 400; i++) {
						const b = await backend.studio.getBook(bookId);
						const r = b.revisions.find((x) => x.id === revisionId);
						if (r && r.state !== 'processing') return;
						await new Promise((resolve) => setTimeout(resolve, 25));
					}
					throw new Error('The upload never finished processing');
				};
				const upload = await backend.studio.upload(blob(fixtures.book));
				await waitFor(upload.bookId, upload.id);
				const book = await backend.studio.publishRevision(upload.bookId, {
					revisionId: upload.id,
					aiUse: 'none'
				});

				await reader();
				await backend.checkout.claim(
					(await backend.catalogue.getBook(book.slug)).offers[0]!.productId
				);
				const before = await chaptersOf(book.id);
				const second = before.readable[1]!;
				const anchor = rangeOn(book.id, before.revisionId, await before.words(second), 2, 6);
				const added = await backend.comments.add(book.id, {
					anchor,
					text: 'On the second chapter.',
					spoilers: false
				});

				await author();
				const edited = await backend.studio.upload(blob(fixtures.edited), { bookId: book.id });
				await waitFor(book.id, edited.id);
				await backend.studio.publishRevision(book.id, { revisionId: edited.id, aiUse: 'none' });

				await reader();
				const moved = (await backend.comments.list(book.id, second)).comments.find(
					(c) => c.id === added.id
				);
				expect(moved?.anchor).toMatchObject({
					revisionId: edited.id,
					startWordId: anchor.startWordId,
					endWordId: anchor.endWordId
				});
			});
		}
	});

	describe('popular highlights (P1-COM-04)', () => {
		it('are passages at least the minimum number of readers highlighted, and never say who', async () => {
			const backend = ctx.backend();
			const { book } = await commentedBook();
			const popular = await backend.highlights.popular(book.id);
			conforms('highlights', 'popular', popular);
			const opened = await backend.content.open(book.id);
			expect(popular.revisionId).toBe(opened.revisionId);
			expect(popular.passages.length).toBeGreaterThan(0);
			for (const p of popular.passages) {
				expect(p.readers).toBeGreaterThanOrEqual(popular.minReaders);
				expect(p.anchor.revisionId).toBe(opened.revisionId);
				expect(Object.keys(p).sort()).toEqual(['anchor', 'chapterId', 'readers']);
			}
			const starts = popular.passages.map((p) => p.anchor.startOrdinal);
			expect(starts).toEqual([...starts].sort((a, b) => a - b));
		});

		it('for a sample reader, only what’s in the sample', async () => {
			const backend = ctx.backend();
			const book = await authorsBook();
			const { readable } = await chaptersOf(book.id);
			const popular = await backend.highlights.popular(book.id);
			for (const p of popular.passages) expect(readable).toContain(p.chapterId);
		});
	});
}
