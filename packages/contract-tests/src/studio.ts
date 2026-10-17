/**
 * The Creator Studio part of the Backend contract (P1-STU-01 to P1-STU-04, P1-LAY-05; DESIGN.md
 * §4.7, §6.2, §7.2, §10.6): uploading and publishing Revisions with the AI answer required, readers'
 * Anchors surviving an edit, packs that can't be published without alt text, narration with
 * Sync Map checks and review regions, plans on the Creator's profile, and simulated earnings.
 *
 * The caller provides a small EPUB and an edited copy of it with one paragraph changed in one
 * Chapter, so any implementation can be tested with the same files.
 */
import {
	SYNC_MAP_INTERPOLATED,
	wordIndexSchema,
	type Backend,
	type PersonaDto,
	type RangeAnchor,
	type Role,
	type StudioBookDetailDto,
	type SyncMapWord
} from '@book/core';
import { describe, expect, it } from 'vitest';
import { expectBackendError } from './backend';

export interface StudioFixtures {
	/** A small EPUB with at least two Chapters. */
	book: Uint8Array;
	/** The same EPUB with one paragraph changed in its first Chapter only. */
	edited: Uint8Array;
	/** The same EPUB with a Chapter added at the end (P1-STU-06: a serial's next Chapter). */
	extended: Uint8Array;
	/** Names in `book`'s text (P1-STU-05): one in its first Chapter, one first in its second. */
	names: { inFirstChapter: string; inSecondChapter: string };
}

interface Context {
	backend(): Backend;
	personas(): PersonaDto[];
	conforms(module: string, method: string, value: unknown): void;
	fixtures: StudioFixtures;
}

/** A tiny valid-looking PNG and WAV: enough for content sniffing (§10.2). */
const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52
]);
const WAV = new TextEncoder().encode('RIFF$\u0000\u0000\u0000WAVEfmt ');

const blob = (bytes: Uint8Array, type = '') =>
	new Blob([bytes as Uint8Array<ArrayBuffer>], { type });

export function describeStudioContract(ctx: Context): void {
	const { conforms } = ctx;
	const persona = (role: Role, nth = 0) => {
		const found = ctx.personas().filter((p) => p.user.role === role)[nth];
		if (!found) throw new Error(`The seed needs ${nth + 1} ${role} Persona(s)`);
		return found;
	};
	const signIn = (role: Role, nth = 0) => ctx.backend().session.signInAs(persona(role, nth).id);

	/** Uploads are processed in the background; wait until this one has finished. */
	async function processed(bookId: string, revisionId: string): Promise<StudioBookDetailDto> {
		const backend = ctx.backend();
		for (let i = 0; i < 400; i++) {
			const book = await backend.studio.getBook(bookId);
			const revision = book.revisions.find((r) => r.id === revisionId);
			if (revision && revision.state !== 'processing') return book;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error('The upload never finished processing');
	}

	async function publishedBook() {
		const backend = ctx.backend();
		await signIn('creator');
		const upload = await backend.studio.upload(blob(ctx.fixtures.book));
		conforms('studio', 'upload', upload);
		expect(upload.state).toBe('processing');
		const draft = await processed(upload.bookId, upload.id);
		const book = await backend.studio.publishRevision(upload.bookId, {
			revisionId: upload.id,
			aiUse: 'none'
		});
		return { draft, book, revisionId: upload.id };
	}

	/** Words of a Chapter of a published Book, read as a reader would. */
	async function wordsOf(bookId: string, chapterIndex: number) {
		const backend = ctx.backend();
		const opened = await backend.content.open(bookId);
		const manifest = JSON.parse(
			await (await backend.content.read(opened.contentToken, 'manifest.json')).text()
		) as { chapters: { chapterId: string; wordCount: number; linear: boolean }[] };
		const chapter = manifest.chapters.filter((c) => c.linear && c.wordCount > 0)[chapterIndex]!;
		const index = wordIndexSchema.parse(
			JSON.parse(
				await (
					await backend.content.read(opened.contentToken, `index/${chapter.chapterId}.words.json`)
				).text()
			)
		);
		return { revisionId: opened.revisionId, chapterId: chapter.chapterId, index };
	}

	function rangeOn(
		bookId: string,
		words: Awaited<ReturnType<typeof wordsOf>>,
		from: number,
		to: number
	): RangeAnchor {
		return {
			kind: 'range',
			bookId,
			revisionId: words.revisionId,
			startWordId: words.index.words[from]![0],
			endWordId: words.index.words[to]![0],
			startOrdinal: words.index.firstOrdinal + from,
			endOrdinal: words.index.firstOrdinal + to,
			quote: { exact: 'unused', prefix: '', suffix: '' }
		};
	}

	describe('studio: Books and Revisions (P1-STU-01, P1-STU-02)', () => {
		it('a draft is processed, needs the AI answer to publish, and then is in the store', async () => {
			const backend = ctx.backend();
			await signIn('creator');
			const upload = await backend.studio.upload(blob(ctx.fixtures.book));
			const draft = await processed(upload.bookId, upload.id);
			conforms('studio', 'getBook', draft);
			expect(draft.listingState).toBe('draft');
			const revision = draft.revisions[0]!;
			expect(revision.state).toBe('ready');
			expect(revision.report?.chapterCount).toBeGreaterThan(0);
			expect(revision.chapters.length).toBeGreaterThan(1);
			expect((await backend.catalogue.search(draft.settings.title)).items).toHaveLength(0);

			// The same file again changes nothing.
			expect((await backend.studio.upload(blob(ctx.fixtures.book))).id).toBe(upload.id);
			// No AI answer, no publishing (§10.6).
			await expectBackendError(
				backend.studio.publishRevision(upload.bookId, { revisionId: upload.id } as never),
				'VALIDATION_FAILED'
			);
			const published = await backend.studio.publishRevision(upload.bookId, {
				revisionId: upload.id,
				aiUse: 'assisted'
			});
			conforms('studio', 'publishRevision', published);
			expect(published.listingState).toBe('listed');
			expect(published.currentRevisionId).toBe(upload.id);

			const found = (await backend.catalogue.search(published.settings.title)).items;
			expect(found.map((b) => b.id)).toContain(upload.bookId);
			expect(found.find((b) => b.id === upload.bookId)?.aiUse).toBe('assisted');
		});

		it('settings change the store page; price changes are simulated money (Invariant 17)', async () => {
			const backend = ctx.backend();
			const { book } = await publishedBook();
			const updated = await backend.studio.updateBook(book.id, {
				title: 'A Retitled Book',
				description: 'Changed in the Studio.',
				price: { amountMinor: 149, currency: 'GBP' },
				contentRating: 'teen',
				contentWarnings: ['Peril'],
				communityPolicy: 'approval'
			});
			conforms('studio', 'updateBook', updated);
			expect(updated.settings).toMatchObject({
				title: 'A Retitled Book',
				communityPolicy: 'approval'
			});
			await signIn('reader');
			const page = await backend.catalogue.getBook(updated.slug);
			expect(page.title).toBe('A Retitled Book');
			expect(page.price).toEqual({ amountMinor: 149, currency: 'GBP' });
			expect(page.contentWarnings).toEqual(['Peril']);
		});

		it('an edited paragraph leaves a reader’s other Anchors where they were (P1-STU-01)', async () => {
			const backend = ctx.backend();
			const { book, revisionId } = await publishedBook();
			await signIn('reader');
			await backend.checkout.claim(
				(await backend.catalogue.getBook(book.slug)).offers[0]!.productId
			);
			const second = await wordsOf(book.id, 1);
			const anchor = rangeOn(book.id, second, 2, 6);

			await signIn('creator');
			const upload = await backend.studio.upload(blob(ctx.fixtures.edited), { bookId: book.id });
			const ready = await processed(book.id, upload.id);
			const changes = ready.revisions.find((r) => r.id === upload.id)!.changes!;
			expect(changes.previousRevisionId).toBe(revisionId);
			expect(changes.changedChapterIds).toHaveLength(1);
			expect(changes.changedChapterIds).not.toContain(second.chapterId);
			await backend.studio.publishRevision(book.id, { revisionId: upload.id, aiUse: 'none' });

			await signIn('reader');
			expect((await backend.content.open(book.id)).revisionId).toBe(upload.id);
			const moved = await backend.content.migrateAnchors(book.id, {
				fromRevisionId: revisionId,
				anchors: [anchor],
				progress: []
			});
			conforms('content', 'migrateAnchors', moved);
			expect(moved.revisionId).toBe(upload.id);
			expect(moved.anchors[0]!.status).toBe('migrated');
			expect(moved.anchors[0]!.anchor).toMatchObject({
				revisionId: upload.id,
				startWordId: anchor.startWordId,
				endWordId: anchor.endWordId
			});
		});

		it('refuses other Creators’ Books and everyone who isn’t a Creator (§10.6)', async () => {
			const backend = ctx.backend();
			const { book } = await publishedBook();
			await signIn('creator', 1);
			await expectBackendError(backend.studio.getBook(book.id), 'FORBIDDEN');
			await expectBackendError(
				backend.studio.upload(blob(ctx.fixtures.edited), { bookId: book.id }),
				'FORBIDDEN'
			);
			await expectBackendError(backend.studio.createPack(book.id, {}), 'FORBIDDEN');
			await signIn('reader');
			await expectBackendError(backend.studio.upload(blob(ctx.fixtures.book)), 'FORBIDDEN');
			await expectBackendError(backend.studio.earnings(), 'FORBIDDEN');
		});
	});

	describe('studio: Illustration Packs (P1-LAY-05)', () => {
		it('can’t be published while a picture lacks alt text; then readers open it, and it survives an edit', async () => {
			const backend = ctx.backend();
			const { book, revisionId } = await publishedBook();
			const words = await wordsOf(book.id, 1);
			const pack = await backend.studio.createPack(book.id, { name: 'Sketches', aiUse: 'none' });
			conforms('studio', 'createPack', pack);
			expect(pack.revisionId).toBe(revisionId);
			const image = {
				width: 1,
				height: 1,
				dominant: '#808080',
				variants: [{ width: 1, file: blob(PNG) }]
			};
			const withPicture = await backend.studio.addIllustration(pack.id, {
				anchor: rangeOn(book.id, words, 0, 3),
				placement: 'inline',
				span: 'single',
				alt: '',
				spoilerSafe: true,
				image
			});
			conforms('studio', 'addIllustration', withPicture);
			expect(withPicture.missingAlt).toBe(1);
			await expectBackendError(backend.studio.publishPack(pack.id), 'VALIDATION_FAILED');

			const id = withPicture.illustrations[0]!.id;
			await backend.studio.updateIllustration(pack.id, id, { alt: 'A sigil drawn in ink' });
			const listed = await backend.studio.publishPack(pack.id);
			expect(listed.listingState).toBe('listed');
			// A listed pack can't lose its alt text.
			await expectBackendError(
				backend.studio.updateIllustration(pack.id, id, { alt: '' }),
				'VALIDATION_FAILED'
			);

			await signIn('reader');
			await backend.checkout.claim(
				(await backend.catalogue.getBook(book.slug)).offers[0]!.productId
			);
			const layer = (await backend.layers.list(book.id)).find((l) => l.id === pack.id)!;
			expect(layer.entitled).toBe(false);
			await backend.checkout.claim(layer.productId);
			const opened = await backend.layers.openPack(pack.id);
			expect(opened.illustrations.map((i) => i.alt)).toEqual(['A sigil drawn in ink']);
			const file = await backend.content.read(
				opened.contentToken,
				opened.illustrations[0]!.image.variants[0]!.path
			);
			expect(file.size).toBe(PNG.length);

			await signIn('creator');
			const upload = await backend.studio.upload(blob(ctx.fixtures.edited), { bookId: book.id });
			await processed(book.id, upload.id);
			await backend.studio.publishRevision(book.id, { revisionId: upload.id, aiUse: 'none' });
			const moved = await backend.studio.getPack(pack.id);
			expect(moved.revisionId).toBe(upload.id);
			expect(moved.illustrations[0]!.anchorStatus).toBe('migrated');
			expect(moved.illustrations[0]!.anchor.revisionId).toBe(upload.id);
		});
	});

	describe('studio: narration (P1-STU-03)', () => {
		it('checks Sync Maps, asks for review below 0.90, puts each region one call away, and goes stale after an edit', async () => {
			const backend = ctx.backend();
			const { book, revisionId } = await publishedBook();
			const first = await wordsOf(book.id, 0);
			const track = await backend.studio.createTrack(book.id, { narrator: 'A Narrator' });
			conforms('studio', 'createTrack', track);
			expect(track.chapters.every((c) => c.status === 'missing')).toBe(true);

			// Every fifth Word guessed, not heard: coverage 0.8.
			const words: SyncMapWord[] = first.index.words.map(([id], i) => [
				id,
				i * 300,
				i * 300 + 280,
				i % 5 === 4 ? SYNC_MAP_INTERPOLATED : 0
			]);
			const syncMap = {
				version: 1,
				trackId: 'from-tools-align',
				revisionId,
				chapterId: first.chapterId,
				audioKey: 'audio.m4a',
				durationMs: words.length * 300,
				coverage: 0.8,
				words
			};
			const audio = blob(WAV);
			await expectBackendError(
				backend.studio.setChapterNarration(track.id, {
					chapterId: first.chapterId,
					audio,
					syncMap: { ...syncMap, revisionId: 'another-revision' }
				}),
				'VALIDATION_FAILED'
			);
			await expectBackendError(
				backend.studio.setChapterNarration(track.id, {
					chapterId: first.chapterId,
					audio,
					syncMap: { nonsense: true }
				}),
				'VALIDATION_FAILED'
			);
			const narrated = await backend.studio.setChapterNarration(track.id, {
				chapterId: first.chapterId,
				audio,
				syncMap
			});
			conforms('studio', 'setChapterNarration', narrated);
			const chapter = narrated.chapters.find((c) => c.chapterId === first.chapterId)!;
			expect(chapter.status).toBe('needs_review');
			expect(chapter.coverage).toBeCloseTo(0.8, 2);
			expect(chapter.regions).toBeGreaterThan(0);

			const review = await backend.studio.reviewChapter(track.id, first.chapterId);
			conforms('studio', 'reviewChapter', review);
			expect(review.regions).toHaveLength(chapter.regions);
			expect(review.regions.every((r) => r.text.length > 0)).toBe(true);
			let last = review;
			for (const region of review.regions) {
				last = await backend.studio.markReviewed(track.id, first.chapterId, region.index, true);
			}
			expect(last.regions.every((r) => r.reviewed)).toBe(true);
			expect(last.status).toBe('ready');

			await expectBackendError(backend.studio.publishTrack(track.id), 'VALIDATION_FAILED');
			await backend.studio.updateTrack(track.id, { aiUse: 'none' });
			expect((await backend.studio.publishTrack(track.id)).listingState).toBe('listed');

			const upload = await backend.studio.upload(blob(ctx.fixtures.edited), { bookId: book.id });
			const ready = await processed(book.id, upload.id);
			expect(ready.revisions.find((r) => r.id === upload.id)!.changes!.staleNarration).toEqual([
				{ trackId: track.id, trackName: track.name, chapterId: first.chapterId }
			]);
			await backend.studio.publishRevision(book.id, { revisionId: upload.id, aiUse: 'none' });
			const after = await backend.studio.getTrack(track.id);
			expect(after.chapters.find((c) => c.chapterId === first.chapterId)!.status).toBe('stale');
		});
	});

	describe('studio: the story so far (P1-STU-05, P1-RDR-13)', () => {
		const { inFirstChapter, inSecondChapter } = ctx.fixtures.names;
		const entry = (name: string, aliases: string[] = []) => ({
			name,
			aliases,
			description: `About ${name}.`
		});

		it('is written as a draft, found in the text, and published only with every name in it and the AI answer', async () => {
			const backend = ctx.backend();
			const { book } = await publishedBook();
			const empty = await backend.studio.getStory(book.id);
			conforms('studio', 'getStory', empty);
			expect(empty.recaps.length).toBeGreaterThan(1);
			expect(empty.recaps.every((r) => r.text === '' && !r.changed)).toBe(true);
			expect(empty).toMatchObject({ glossary: [], publishedAt: null, unpublishedChanges: false });
			expect(empty.problems).toHaveLength(1);

			const [first, second] = empty.recaps;
			let story = await backend.studio.saveRecap(book.id, {
				chapterId: first!.chapterId,
				text: '  What happened first.  '
			});
			conforms('studio', 'saveRecap', story);
			expect(story.recaps[0]!.text).toBe('What happened first.');
			story = await backend.studio.saveGlossaryEntry(book.id, null, entry(inSecondChapter));
			conforms('studio', 'saveGlossaryEntry', story);
			await backend.studio.saveGlossaryEntry(book.id, null, entry(inFirstChapter));
			story = await backend.studio.saveGlossaryEntry(book.id, null, entry('Zebedee Crumbhorn'));
			// In order of first appearance; the one that isn't in the text last.
			expect(story.glossary.map((e) => e.name)).toEqual([
				inFirstChapter,
				inSecondChapter,
				'Zebedee Crumbhorn'
			]);
			const [early, later, absent] = story.glossary;
			expect(early!.names[0]!.chapterId).toBe(first!.chapterId);
			expect(later!.names[0]).toMatchObject({ chapterId: second!.chapterId });
			expect(later!.names[0]!.firstAppearance).toMatchObject({
				kind: 'range',
				bookId: book.id,
				revisionId: story.revisionId
			});
			expect(later!.names[0]!.context).toContain(inSecondChapter.split(' ')[0]);
			expect(absent!.names[0]).toMatchObject({ firstAppearance: null, chapterId: null });
			expect(story.problems.join(' ')).toContain('Zebedee Crumbhorn');
			expect(story.unpublishedChanges).toBe(true);

			// Readers have nothing until it's published.
			await signIn('reader');
			await backend.checkout.claim(
				(await backend.catalogue.getBook(book.slug)).offers[0]!.productId
			);
			expect(await backend.content.storySoFar(book.id)).toBeNull();

			await signIn('creator');
			await expectBackendError(
				backend.studio.publishStory(book.id, {} as never),
				'VALIDATION_FAILED'
			);
			await expectBackendError(
				backend.studio.publishStory(book.id, { aiUse: 'assisted' }),
				'VALIDATION_FAILED'
			);
			story = await backend.studio.removeGlossaryEntry(book.id, absent!.id);
			conforms('studio', 'removeGlossaryEntry', story);
			story = await backend.studio.publishStory(book.id, { aiUse: 'assisted' });
			conforms('studio', 'publishStory', story);
			expect(story).toMatchObject({ aiUse: 'assisted', unpublishedChanges: false, problems: [] });
			expect(story.publishedAt).not.toBeNull();

			// A draft change isn't the readers' until it's published again.
			story = await backend.studio.saveRecap(book.id, {
				chapterId: second!.chapterId,
				text: 'What happened next.'
			});
			expect(story.unpublishedChanges).toBe(true);

			await signIn('reader');
			const opened = await backend.content.open(book.id);
			const forReader = await backend.content.storySoFar(book.id);
			conforms('content', 'storySoFar', forReader);
			expect(forReader).toMatchObject({
				bookId: book.id,
				revisionId: opened.revisionId,
				aiUse: 'assisted',
				recaps: [{ chapterId: first!.chapterId, text: 'What happened first.' }]
			});
			expect(forReader!.glossary.map((e) => e.names[0]!.name).sort()).toEqual(
				[inFirstChapter, inSecondChapter].sort()
			);
			const later2 = forReader!.glossary.find((e) => e.names[0]!.name === inSecondChapter)!;
			expect(later2.names[0]!.firstAppearance.startWordId).toBe(
				later!.names[0]!.firstAppearance!.startWordId
			);
		});

		it('names an entry with what it’s also called, one name to one entry, and pictures need alt text', async () => {
			const backend = ctx.backend();
			const { book } = await publishedBook();
			let story = await backend.studio.saveGlossaryEntry(
				book.id,
				null,
				entry(inFirstChapter, [inSecondChapter, inFirstChapter, 'Not In The Text'])
			);
			const [saved] = story.glossary;
			// The entry's own name again is dropped; an alias not in the text yet is allowed.
			expect(saved!.aliases).toEqual([inSecondChapter, 'Not In The Text']);
			expect(saved!.names.map((n) => n.firstAppearance !== null)).toEqual([true, true, false]);
			expect(story.problems).toEqual([]);
			await expectBackendError(
				backend.studio.saveGlossaryEntry(book.id, null, entry(inSecondChapter)),
				'VALIDATION_FAILED'
			);
			const picture = {
				width: 2,
				height: 3,
				dominant: '#336699',
				variants: [{ width: 2, file: blob(PNG, 'image/png') }]
			};
			await expectBackendError(
				backend.studio.saveGlossaryEntry(book.id, saved!.id, {
					...entry(inFirstChapter),
					picture
				}),
				'VALIDATION_FAILED'
			);
			story = await backend.studio.saveGlossaryEntry(book.id, saved!.id, {
				...entry(inFirstChapter),
				picture,
				pictureAlt: 'A portrait.'
			});
			expect(story.glossary[0]!.picture).toMatchObject({ alt: 'A portrait.', width: 2, height: 3 });
			expect(story.glossary[0]!.aliases).toEqual([]);
			story = await backend.studio.saveGlossaryEntry(book.id, saved!.id, {
				...entry(inFirstChapter),
				picture: null
			});
			expect(story.glossary[0]!.picture).toBeNull();
			await expectBackendError(
				backend.studio.removeGlossaryEntry(book.id, 'entry-unknown'),
				'NOT_FOUND'
			);
			await expectBackendError(
				backend.studio.saveRecap(book.id, { chapterId: 'no-such-chapter', text: 'x' }),
				'NOT_FOUND'
			);
		});

		it('finds its names again in a new version, and marks recaps whose Chapter changed', async () => {
			const backend = ctx.backend();
			const { book, revisionId } = await publishedBook();
			const [first, second] = (await backend.studio.getStory(book.id)).recaps;
			await backend.studio.saveRecap(book.id, { chapterId: first!.chapterId, text: 'One.' });
			await backend.studio.saveRecap(book.id, { chapterId: second!.chapterId, text: 'Two.' });
			const before = await backend.studio.saveGlossaryEntry(book.id, null, entry(inSecondChapter));
			await backend.studio.publishStory(book.id, { aiUse: 'none' });
			const anchor = before.glossary[0]!.names[0]!.firstAppearance!;
			expect(anchor.revisionId).toBe(revisionId);

			const upload = await backend.studio.upload(blob(ctx.fixtures.edited), { bookId: book.id });
			await processed(book.id, upload.id);
			await backend.studio.publishRevision(book.id, { revisionId: upload.id, aiUse: 'none' });
			const after = await backend.studio.getStory(book.id);
			expect(after.revisionId).toBe(upload.id);
			// Only the first Chapter's text changed (the fixture's edit).
			expect(after.recaps.map((r) => r.changed)).toEqual(
				after.recaps.map((r) => r.chapterId === first!.chapterId)
			);
			expect(after.glossary[0]!.names[0]!.firstAppearance).toMatchObject({
				revisionId: upload.id,
				startWordId: anchor.startWordId,
				endWordId: anchor.endWordId
			});
			// Saving the recap again says it's been looked at.
			const resaved = await backend.studio.saveRecap(book.id, {
				chapterId: first!.chapterId,
				text: 'One, edited.'
			});
			expect(resaved.recaps[0]!.changed).toBe(false);

			await signIn('reader');
			await backend.checkout.claim(
				(await backend.catalogue.getBook(book.slug)).offers[0]!.productId
			);
			const forReader = await backend.content.storySoFar(book.id);
			expect(forReader!.revisionId).toBe(upload.id);
			expect(forReader!.glossary[0]!.names[0]!.firstAppearance.revisionId).toBe(upload.id);
			expect(forReader!.recaps.map((r) => r.text)).toEqual(['One.', 'Two.']);
		});

		it('is only for the Book’s own Creator, and only for readers who can open the Book', async () => {
			const backend = ctx.backend();
			const { book } = await publishedBook();
			await backend.studio.saveRecap(book.id, {
				chapterId: (await backend.studio.getStory(book.id)).recaps[0]!.chapterId,
				text: 'One.'
			});
			await backend.studio.publishStory(book.id, { aiUse: 'none' });
			await signIn('creator', 1);
			await expectBackendError(backend.studio.getStory(book.id), 'FORBIDDEN');
			await expectBackendError(
				backend.studio.saveGlossaryEntry(book.id, null, entry(inFirstChapter)),
				'FORBIDDEN'
			);
			await expectBackendError(
				backend.studio.publishStory(book.id, { aiUse: 'none' }),
				'FORBIDDEN'
			);
			await signIn('reader');
			await expectBackendError(backend.studio.getStory(book.id), 'FORBIDDEN');
			await expectBackendError(backend.content.storySoFar('book-unknown'), 'NOT_FOUND');
		});
	});

	describe('studio: plans and earnings (P1-STU-04)', () => {
		it('a new plan shows on the Creator’s profile', async () => {
			const backend = ctx.backend();
			const creator = persona('creator');
			await signIn('creator');
			const plan = await backend.studio.savePlan(null, {
				name: 'Supporters',
				description: 'Thank you for reading.',
				price: { amountMinor: 200, currency: 'GBP' },
				earlyAccessBookIds: []
			});
			conforms('studio', 'savePlan', plan);
			const handle = (await backend.catalogue.listBooks({ limit: 100 })).items.find(
				(b) => b.creatorId === creator.user.creatorId
			);
			const profile = handle
				? await backend.catalogue.getBook(handle.slug).then((p) => p.creator.handle)
				: null;
			if (profile) {
				const plans = await backend.support.listPlans(profile);
				expect(plans.map((p) => p.name)).toContain('Supporters');
			}
			expect((await backend.studio.listPlans()).map((p) => p.id)).toContain(plan.id);
		});

		it('earnings are labelled simulated and every split adds up', async () => {
			const backend = ctx.backend();
			await signIn('creator');
			const earnings = await backend.studio.earnings();
			conforms('studio', 'earnings', earnings);
			expect(earnings.simulated).toBe(true);
			expect(earnings.splitNotes.length).toBeGreaterThan(0);
			for (const split of [earnings.total, ...earnings.lines.map((l) => l.split)]) {
				expect(
					split.platform.amountMinor + split.yours.amountMinor + split.others.amountMinor
				).toBe(split.gross.amountMinor);
			}
		});
	});
}
