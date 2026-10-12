/**
 * The Stores contract (docs/DESIGN.md §6.3, IMPLEMENTATION-PLAN.md §4.5). Run it against every
 * `Stores` implementation: `storage-local` now, `storage-remote` in Phase 2. Passing it is the
 * condition for swapping the implementation in `services.ts`.
 */
import {
	isUuidv7,
	StoreError,
	type AnchoredRecordStore,
	type Annotation,
	type Clock,
	type NewRecord,
	type PlacedBookmark,
	type PointAnchor,
	type RangeAnchor,
	type Stores
} from '@book/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ManualClock } from './clock';

/** Must return a fresh, empty, independent set of stores on every call. */
export type MakeStores = (context: { clock: Clock }) => Promise<Stores>;

const MINUTE = 60_000;

const quote = {
	exact: 'Alice',
	prefix: 'tired of sitting by her sister ',
	suffix: ' was beginning'
};

export function pointAnchor(bookId: string, ordinal: number, revisionId = 'rev-1'): PointAnchor {
	return { kind: 'point', bookId, revisionId, wordId: ordinal + 100, ordinal, quote };
}

export function rangeAnchor(bookId: string, start: number, end: number): RangeAnchor {
	return {
		kind: 'range',
		bookId,
		revisionId: 'rev-1',
		startWordId: start + 100,
		endWordId: end + 100,
		startOrdinal: start,
		endOrdinal: end,
		quote
	};
}

function annotationInput(bookId: string, start = 10): NewRecord<Annotation> {
	return {
		bookId,
		anchor: rangeAnchor(bookId, start, start + 5),
		anchorStatus: 'ok',
		colour: 2,
		note: 'Foreshadowing?'
	};
}

function bookmarkInput(bookId: string, ordinal = 10): NewRecord<PlacedBookmark> {
	return { bookId, anchor: pointAnchor(bookId, ordinal), anchorStatus: 'ok', label: 'Start' };
}

export function describeStoresContract(name: string, makeStores: MakeStores): void {
	describe(`Stores contract: ${name}`, () => {
		let clock: ManualClock;
		let stores: Stores;

		beforeEach(async () => {
			clock = new ManualClock();
			stores = await makeStores({ clock });
		});

		describeAnchoredStore(
			'annotations',
			() => stores.annotations,
			() => clock,
			annotationInput,
			{
				note: 'Edited note'
			}
		);
		describeAnchoredStore(
			'placedBookmarks',
			() => stores.placedBookmarks,
			() => clock,
			bookmarkInput,
			{ label: 'Renamed' }
		);

		describe('progress', () => {
			it('saves, overwrites and keeps Books separate', async () => {
				const anchor = pointAnchor('book-1', 50);
				const first = await stores.progress.save({
					bookId: 'book-1',
					current: anchor,
					progression: 0.1,
					furthest: anchor,
					furthestProgression: 0.1
				});
				expect(first.createdAt).toBe(clock.now().toISOString());
				expect(first.deletedAt).toBeNull();

				clock.advance(MINUTE);
				const second = await stores.progress.save({ ...first, progression: 0.2 });
				expect(second.progression).toBe(0.2);
				expect(second.createdAt).toBe(first.createdAt);
				expect(second.updatedAt).toBe(clock.now().toISOString());

				expect(await stores.progress.get('book-1')).toEqual(second);
				expect(await stores.progress.get('book-2')).toBeUndefined();
			});
		});

		describe('preferences', () => {
			it('keeps global preferences and per-Book overrides separate', async () => {
				await stores.preferences.save({ theme: { mode: 'dark' } });
				await stores.preferences.save({ theme: { mode: 'sepia' }, fontScale: 1.5 }, 'book-1');
				expect(await stores.preferences.get()).toEqual({ theme: { mode: 'dark' } });
				expect(await stores.preferences.get('book-1')).toEqual({
					theme: { mode: 'sepia' },
					fontScale: 1.5
				});
				expect(await stores.preferences.get('book-2')).toBeUndefined();
			});

			it('replaces on save and clears one scope', async () => {
				await stores.preferences.save({ fontScale: 1.2 });
				await stores.preferences.save({ layout: 'scroll' });
				expect(await stores.preferences.get()).toEqual({ layout: 'scroll' });

				await stores.preferences.save({ fontScale: 2 }, 'book-1');
				await stores.preferences.clear('book-1');
				expect(await stores.preferences.get('book-1')).toBeUndefined();
				expect(await stores.preferences.get()).toEqual({ layout: 'scroll' });
			});
		});

		describe('layerSelection', () => {
			it('saves per Book and keeps pack priority order', async () => {
				const saved = await stores.layerSelection.save({
					bookId: 'book-1',
					illustrationPackIds: ['pack-b', 'pack-a'],
					narrationTrackId: null
				});
				expect(saved.updatedAt).toBe(clock.now().toISOString());
				expect((await stores.layerSelection.get('book-1'))?.illustrationPackIds).toEqual([
					'pack-b',
					'pack-a'
				]);
				expect(await stores.layerSelection.get('book-2')).toBeUndefined();
			});
		});

		describe('library', () => {
			const book = {
				id: 'urn:uuid:alice',
				title: "Alice's Adventures in Wonderland",
				creatorName: 'Lewis Carroll',
				lang: 'en',
				currentRevisionId: 'sha-1',
				source: 'import' as const
			};

			it('puts, lists and soft-deletes Books', async () => {
				const saved = await stores.library.putBook(book);
				expect(saved.deletedAt).toBeNull();
				expect(await stores.library.listBooks()).toEqual([saved]);
				expect(await stores.library.getBook(book.id)).toEqual(saved);

				clock.advance(MINUTE);
				const updated = await stores.library.putBook({ ...book, currentRevisionId: 'sha-2' });
				expect(updated.createdAt).toBe(saved.createdAt);
				expect(updated.updatedAt).not.toBe(saved.updatedAt);

				await stores.library.removeBook(book.id);
				expect(await stores.library.listBooks()).toEqual([]);
				expect(await stores.library.getBook(book.id)).toBeUndefined();
			});

			it('treats re-putting the same Revision as a no-op', async () => {
				const revision = { id: 'sha-1', bookId: book.id, chapterCount: 12, wordCount: 26_000 };
				const first = await stores.library.putRevision(revision);
				clock.advance(MINUTE);
				const again = await stores.library.putRevision({ ...revision, wordCount: 1 });
				expect(again).toEqual(first);
				await stores.library.putRevision({ ...revision, id: 'sha-2' });
				expect((await stores.library.listRevisions(book.id)).map((r) => r.id)).toEqual([
					'sha-1',
					'sha-2'
				]);
				expect(await stores.library.getRevision('missing')).toBeUndefined();
			});

			it('stores and returns content files per Revision', async () => {
				await stores.library.putFile('sha-1', 'OEBPS/ch1.xhtml', new Blob(['<p>Alice</p>']));
				const file = await stores.library.getFile('sha-1', 'OEBPS/ch1.xhtml');
				expect(await file?.text()).toBe('<p>Alice</p>');
				expect(await stores.library.getFile('sha-2', 'OEBPS/ch1.xhtml')).toBeUndefined();
			});
		});

		describe('export and delete (P1-APP-04)', () => {
			async function fill() {
				await stores.library.putBook({
					id: 'book-1',
					title: 'Alice',
					lang: 'en',
					currentRevisionId: 'sha-1',
					source: 'import'
				});
				await stores.library.putRevision({
					id: 'sha-1',
					bookId: 'book-1',
					chapterCount: 1,
					wordCount: 3
				});
				await stores.library.putFile('sha-1', 'manifest.json', new Blob(['{}']));
				const annotation = await stores.annotations.create({
					bookId: 'book-1',
					anchor: rangeAnchor('book-1', 0, 2),
					anchorStatus: 'ok',
					colour: 2,
					note: 'Curious'
				});
				const removed = await stores.annotations.create({
					bookId: 'book-1',
					anchor: rangeAnchor('book-1', 0, 2),
					anchorStatus: 'ok',
					colour: 1
				});
				await stores.annotations.remove(removed.id);
				await stores.placedBookmarks.create({
					bookId: 'book-1',
					anchor: pointAnchor('book-1', 1),
					anchorStatus: 'ok'
				});
				await stores.progress.save({
					bookId: 'book-1',
					current: pointAnchor('book-1', 1),
					progression: 0.1,
					furthest: pointAnchor('book-1', 1),
					furthestProgression: 0.1
				});
				await stores.preferences.save({ fontScale: 1.2 });
				await stores.preferences.save({ justify: true }, 'book-1');
				await stores.layerSelection.save({
					bookId: 'book-1',
					illustrationPackIds: ['pack-a'],
					narrationTrackId: null
				});
				return { annotation, removed };
			}

			it('exports every record, deleted ones marked, and lists files without their bytes', async () => {
				const { annotation, removed } = await fill();
				const snapshot = await stores.exportAll();
				expect(snapshot).toMatchObject({ format: 'book-reader-data', version: 1 });
				expect(snapshot.libraryBooks.map((b) => b.id)).toEqual(['book-1']);
				expect(snapshot.libraryRevisions.map((r) => r.id)).toEqual(['sha-1']);
				expect(snapshot.libraryFiles).toEqual([
					{ revisionId: 'sha-1', path: 'manifest.json', type: '', bytes: 2 }
				]);
				expect(snapshot.annotations.map((a) => a.id).sort()).toEqual(
					[annotation.id, removed.id].sort()
				);
				expect(snapshot.annotations.find((a) => a.id === removed.id)?.deletedAt).not.toBeNull();
				expect(snapshot.placedBookmarks).toHaveLength(1);
				expect(snapshot.progress.map((p) => p.bookId)).toEqual(['book-1']);
				expect(snapshot.preferences).toEqual(
					expect.arrayContaining([
						{ bookId: null, preferences: { fontScale: 1.2 } },
						{ bookId: 'book-1', preferences: { justify: true } }
					])
				);
				expect(snapshot.layerSelection.map((l) => l.bookId)).toEqual(['book-1']);
				// It's plain data: it survives a JSON round trip unchanged.
				expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
			});

			it('deletes everything, and the Stores keep working afterwards', async () => {
				await fill();
				await stores.deleteAll();
				const empty = await stores.exportAll();
				for (const key of [
					'libraryBooks',
					'libraryRevisions',
					'libraryFiles',
					'annotations',
					'placedBookmarks',
					'progress',
					'preferences',
					'layerSelection'
				] as const) {
					expect(empty[key], key).toEqual([]);
				}
				expect(await stores.library.getFile('sha-1', 'manifest.json')).toBeUndefined();
				await stores.preferences.save({ fontScale: 1.1 });
				expect(await stores.preferences.get()).toEqual({ fontScale: 1.1 });
			});
		});

		it('returns independent stores on every call', async () => {
			await stores.annotations.create(annotationInput('book-1'));
			const other = await makeStores({ clock });
			expect(await other.annotations.list('book-1')).toEqual([]);
		});
	});
}

function describeAnchoredStore<T extends Annotation | PlacedBookmark>(
	name: string,
	store: () => AnchoredRecordStore<T>,
	clock: () => ManualClock,
	input: (bookId: string, ordinal?: number) => NewRecord<T>,
	changes: Partial<T>
): void {
	describe(name, () => {
		it('creates records with a UUIDv7, clock timestamps and no tombstone', async () => {
			const created = await store().create(input('book-1'));
			expect(isUuidv7(created.id)).toBe(true);
			expect(created.createdAt).toBe(clock().now().toISOString());
			expect(created.updatedAt).toBe(created.createdAt);
			expect(created.deletedAt).toBeNull();
		});

		it('round-trips the Anchor field by field', async () => {
			const created = await store().create(input('book-1'));
			expect((await store().get(created.id))?.anchor).toEqual(input('book-1').anchor);
		});

		it('lists live records for one Book, oldest first', async () => {
			const a = await store().create(input('book-1', 40));
			clock().advance(MINUTE);
			const b = await store().create(input('book-1', 20));
			await store().create(input('book-2'));
			expect((await store().list('book-1')).map((r) => r.id)).toEqual([a.id, b.id]);
		});

		it('updates changes and updatedAt, never createdAt or the Book', async () => {
			const created = await store().create(input('book-1'));
			clock().advance(MINUTE);
			const updated = await store().update(created.id, {
				...changes,
				bookId: 'book-2'
			} as Partial<T>);
			expect(updated).toMatchObject(changes);
			expect(updated.bookId).toBe('book-1');
			expect(updated.createdAt).toBe(created.createdAt);
			expect(updated.updatedAt).toBe(clock().now().toISOString());
		});

		it('soft-deletes, hiding the record from list and get', async () => {
			const created = await store().create(input('book-1'));
			await store().remove(created.id);
			expect(await store().list('book-1')).toEqual([]);
			expect(await store().get(created.id)).toBeUndefined();
			await expect(store().remove(created.id)).resolves.toBeUndefined();
			await expect(store().remove('missing')).resolves.toBeUndefined();
		});

		it('rejects updates to missing or deleted records with NOT_FOUND', async () => {
			await expect(store().update('missing', changes)).rejects.toMatchObject({
				code: 'NOT_FOUND'
			});
			const created = await store().create(input('book-1'));
			await store().remove(created.id);
			const error = await store()
				.update(created.id, changes)
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(StoreError);
		});
	});
}
