/**
 * Serial release schedules, part of the Backend contract (P1-STU-06; DESIGN.md §4.7, §13.2): a
 * Chapter still to come is locked for every reader until its time on the clock, then readable
 * and announced once to each of the author's followers; early access (P1-STO-04) still applies.
 *
 * Uses the Studio fixtures: a small EPUB and the same EPUB with a Chapter added at the end.
 */
import type { Backend, PersonaDto, Role, StudioBookDetailDto } from '@book/core';
import { describe, expect, it } from 'vitest';
import { expectBackendError } from './backend';
import type { ManualClock } from './clock';
import type { StudioFixtures } from './studio';

interface Context {
	backend(): Backend;
	clock(): ManualClock;
	personas(): PersonaDto[];
	conforms(module: string, method: string, value: unknown): void;
	fixtures: StudioFixtures;
}

const DAY = 24 * 60 * 60 * 1000;

const blob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]);

export function describeReleasesContract(ctx: Context): void {
	const { conforms } = ctx;
	const signIn = (role: Role, nth = 0) => {
		const found = ctx.personas().filter((p) => p.user.role === role)[nth];
		if (!found) throw new Error(`The seed needs ${nth + 1} ${role} Persona(s)`);
		return ctx.backend().session.signInAs(found.id);
	};
	const later = (ms: number) => new Date(ctx.clock().now().getTime() + ms).toISOString();

	async function processed(bookId: string, revisionId: string): Promise<StudioBookDetailDto> {
		for (let i = 0; i < 400; i++) {
			const book = await ctx.backend().studio.getBook(bookId);
			if (book.revisions.find((r) => r.id === revisionId)?.state !== 'processing') return book;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error('The upload never finished processing');
	}

	/**
	 * The fixture published by the creator, owned and followed by the reader, and its next
	 * version (with a new last Chapter) uploaded and processed. Signed in as the creator.
	 */
	async function nextVersion(options: { follow?: boolean } = {}) {
		const backend = ctx.backend();
		await signIn('creator');
		const first = await backend.studio.upload(blob(ctx.fixtures.book));
		await processed(first.bookId, first.id);
		const book = await backend.studio.publishRevision(first.bookId, {
			revisionId: first.id,
			aiUse: 'none'
		});
		await signIn('reader');
		const page = await backend.catalogue.getBook(book.slug);
		await backend.checkout.claim(page.offers[0]!.productId);
		if (options.follow !== false) await backend.community.follow(page.creator.handle, true);
		await signIn('creator');
		const upload = await backend.studio.upload(blob(ctx.fixtures.extended), { bookId: book.id });
		const ready = await processed(book.id, upload.id);
		const chapters = ready.revisions.find((r) => r.id === upload.id)!.chapters;
		const added = chapters.at(-1)!;
		return { book, page, revisionId: upload.id, chapters, added };
	}

	const chapterMessages = async (bookId: string) =>
		(await ctx.backend().inbox.list()).filter(
			(m) => m.about?.type === 'chapter' && m.about.id === bookId
		);

	describe('studio: serial release schedules (P1-STU-06)', () => {
		it('a scheduled Chapter is locked for everyone until its time, then out and announced once', async () => {
			const backend = ctx.backend();
			const { book, revisionId, chapters, added } = await nextVersion();
			expect(chapters[0]!.release).toMatchObject({ state: 'out', schedulable: false });
			expect(added.release).toMatchObject({ state: 'with_version', schedulable: true });

			const tomorrow = later(DAY);
			const scheduled = await backend.studio.scheduleChapter(book.id, {
				chapterId: added.chapterId,
				releaseAt: tomorrow
			});
			conforms('studio', 'scheduleChapter', scheduled);
			const chapter = scheduled.revisions
				.find((r) => r.id === revisionId)!
				.chapters.find((c) => c.chapterId === added.chapterId)!;
			expect(chapter.release).toMatchObject({
				state: 'scheduled',
				releaseAt: tomorrow,
				scheduledAt: tomorrow
			});
			await backend.studio.publishRevision(book.id, { revisionId, aiUse: 'none' });

			await signIn('reader');
			const opened = await backend.content.open(book.id);
			expect(opened.revisionId).toBe(revisionId);
			expect(opened.locked).toEqual([
				expect.objectContaining({
					chapterId: added.chapterId,
					reason: 'scheduled',
					releaseAt: tomorrow
				})
			]);
			await expectBackendError(
				backend.content.read(opened.contentToken, `index/${added.chapterId}.words.json`),
				'ENTITLEMENT_REQUIRED'
			);
			const page = await backend.catalogue.getBook(book.slug);
			conforms('catalogue', 'getBook', page);
			expect(page.nextChapterAt).toBe(tomorrow);
			expect(await chapterMessages(book.id)).toEqual([]);

			ctx.clock().advance(DAY + 60_000);
			const messages = await chapterMessages(book.id);
			conforms('inbox', 'list', messages);
			expect(messages).toHaveLength(1);
			expect(messages[0]!.about).toEqual({
				type: 'chapter',
				id: book.id,
				chapterId: added.chapterId
			});
			expect(messages[0]!.body).toContain(added.title);
			// Looking again, or from elsewhere, doesn't announce it twice.
			expect((await backend.content.open(book.id)).locked).toEqual([]);
			expect(await chapterMessages(book.id)).toHaveLength(1);
			expect((await backend.catalogue.getBook(book.slug)).nextChapterAt).toBeNull();
		});

		it('a new Chapter with no time comes out with its version; only followers hear, and not of a first version', async () => {
			const backend = ctx.backend();
			const { book, revisionId, added } = await nextVersion();
			// A new Book from an author the reader follows isn't announced Chapter by Chapter.
			const other = await backend.studio.upload(blob(ctx.fixtures.edited));
			await processed(other.bookId, other.id);
			await backend.studio.publishRevision(other.bookId, { revisionId: other.id, aiUse: 'none' });
			await backend.studio.publishRevision(book.id, { revisionId, aiUse: 'none' });
			// Someone who doesn't follow the author hears nothing.
			await signIn('creator', 1);
			expect(await chapterMessages(book.id)).toEqual([]);
			await signIn('reader');
			expect(await chapterMessages(other.bookId)).toEqual([]);
			expect((await backend.content.open(book.id)).locked).toEqual([]);
			const messages = await chapterMessages(book.id);
			expect(messages.map((m) => m.about?.chapterId)).toEqual([added.chapterId]);
		});

		it('“release now” brings a scheduled Chapter out at once', async () => {
			const backend = ctx.backend();
			const { book, revisionId, added } = await nextVersion();
			await backend.studio.scheduleChapter(book.id, {
				chapterId: added.chapterId,
				releaseAt: later(3 * DAY)
			});
			await backend.studio.publishRevision(book.id, { revisionId, aiUse: 'none' });
			const released = await backend.studio.scheduleChapter(book.id, {
				chapterId: added.chapterId,
				releaseAt: null
			});
			const chapter = released.revisions
				.find((r) => r.id === revisionId)!
				.chapters.find((c) => c.chapterId === added.chapterId)!;
			expect(chapter.release).toMatchObject({ state: 'out', schedulable: false });
			await signIn('reader');
			expect((await backend.content.open(book.id)).locked).toEqual([]);
			expect(await chapterMessages(book.id)).toHaveLength(1);
		});

		it('only Chapters still to come can wait, until a time in the future, and only by their author', async () => {
			const backend = ctx.backend();
			const { book, revisionId, chapters, added } = await nextVersion();
			// The first Chapter comes out with the Book, and the others are out already.
			for (const chapter of chapters.slice(0, -1)) {
				await expectBackendError(
					backend.studio.scheduleChapter(book.id, {
						chapterId: chapter.chapterId,
						releaseAt: later(DAY)
					}),
					'CONFLICT'
				);
			}
			await expectBackendError(
				backend.studio.scheduleChapter(book.id, {
					chapterId: added.chapterId,
					releaseAt: later(-60_000)
				}),
				'VALIDATION_FAILED'
			);
			await expectBackendError(
				backend.studio.scheduleChapter(book.id, { chapterId: 'no-such-chapter', releaseAt: null }),
				'NOT_FOUND'
			);
			// With no time it's back to coming out with its version.
			await backend.studio.scheduleChapter(book.id, {
				chapterId: added.chapterId,
				releaseAt: later(DAY)
			});
			const cleared = await backend.studio.scheduleChapter(book.id, {
				chapterId: added.chapterId,
				releaseAt: null
			});
			expect(
				cleared.revisions.find((r) => r.id === revisionId)!.chapters.at(-1)!.release.state
			).toBe('with_version');

			await signIn('creator', 1);
			await expectBackendError(
				backend.studio.scheduleChapter(book.id, {
					chapterId: added.chapterId,
					releaseAt: later(DAY)
				}),
				'FORBIDDEN'
			);
			await signIn('reader');
			await expectBackendError(
				backend.studio.scheduleChapter(book.id, {
					chapterId: added.chapterId,
					releaseAt: later(DAY)
				}),
				'FORBIDDEN'
			);
		});

		it('early access still applies once it’s out, from its release (P1-STO-04)', async () => {
			const backend = ctx.backend();
			const { book, revisionId, added } = await nextVersion();
			await backend.studio.updateBook(book.id, { isSerial: true, earlyAccessChapters: 1 });
			const releaseAt = later(2 * DAY);
			await backend.studio.scheduleChapter(book.id, { chapterId: added.chapterId, releaseAt });
			await backend.studio.publishRevision(book.id, { revisionId, aiUse: 'none' });

			await signIn('reader');
			const before = await backend.content.open(book.id);
			// The newest Chapter that's out is early access; the scheduled one waits for everyone.
			expect(before.locked.map((l) => l.reason)).toEqual(['early_access', 'scheduled']);

			ctx.clock().advance(2 * DAY + 60_000);
			const after = await backend.content.open(book.id);
			expect(after.locked).toEqual([
				expect.objectContaining({ chapterId: added.chapterId, reason: 'early_access' })
			]);
			// SIMULATION (OPEN-10): the window runs from the release.
			expect(Date.parse(after.locked[0]!.freeAt!)).toBe(Date.parse(releaseAt) + 30 * DAY);
			const [message] = await chapterMessages(book.id);
			expect(message!.body).toMatch(/early access/i);
		});
	});
}
