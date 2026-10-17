import {
	idGenerator,
	StoreError,
	systemClock,
	timestamp,
	type AnchoredRecordStore,
	type Annotation,
	type Clock,
	type LayerSelectionStore,
	type LibraryStore,
	type NewRecord,
	type PlacedBookmark,
	type PreferencesStore,
	type ProgressStore,
	type ReadingStatsStore,
	type RecordChanges,
	type Stores,
	type StoresSnapshot
} from '@book/core';
import { DEFAULT_DB_NAME, GLOBAL_PREFERENCES_KEY, openReaderDB, type Database } from './db';

export { DEFAULT_DB_NAME } from './db';

export interface LocalStoresOptions {
	/** IndexedDB database name. Per Persona in the PoC: `book-reader:<userId>`. */
	dbName?: string;
	clock?: Clock;
}

type AnchoredStoreName = 'annotations' | 'placedBookmarks';

function anchoredStore<T extends Annotation | PlacedBookmark>(
	db: Database,
	name: AnchoredStoreName,
	clock: Clock
): AnchoredRecordStore<T> {
	const newId = idGenerator(clock);
	const live = (record: T | undefined) =>
		record && record.deletedAt === null ? record : undefined;

	return {
		async list(bookId) {
			const records = (await db.getAllFromIndex(name, 'bookId', bookId)) as T[];
			return records
				.filter((r) => r.deletedAt === null)
				.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
		},
		async get(id) {
			return live((await db.get(name, id)) as T | undefined);
		},
		async create(input: NewRecord<T>) {
			const now = timestamp(clock);
			const record = {
				...input,
				id: newId(),
				createdAt: now,
				updatedAt: now,
				deletedAt: null
			} as T;
			await db.add(name, record);
			return record;
		},
		async update(id, changes: RecordChanges<T>) {
			const tx = db.transaction(name, 'readwrite');
			const existing = live((await tx.store.get(id)) as T | undefined);
			if (!existing) throw new StoreError('NOT_FOUND', `No ${name} record with id ${id}`);
			const updated = {
				...existing,
				...changes,
				id,
				bookId: existing.bookId,
				createdAt: existing.createdAt,
				deletedAt: null,
				updatedAt: timestamp(clock)
			} as T;
			await tx.store.put(updated);
			await tx.done;
			return updated;
		},
		async remove(id) {
			const tx = db.transaction(name, 'readwrite');
			const existing = (await tx.store.get(id)) as T | undefined;
			if (existing && existing.deletedAt === null) {
				const now = timestamp(clock);
				await tx.store.put({ ...existing, deletedAt: now, updatedAt: now });
			}
			await tx.done;
		}
	};
}

function libraryStore(db: Database, clock: Clock): LibraryStore {
	return {
		async listBooks() {
			const books = await db.getAll('libraryBooks');
			return books.filter((b) => b.deletedAt === null);
		},
		async getBook(bookId) {
			const book = await db.get('libraryBooks', bookId);
			return book?.deletedAt === null ? book : undefined;
		},
		async putBook(input) {
			const tx = db.transaction('libraryBooks', 'readwrite');
			const existing = await tx.store.get(input.id);
			const now = timestamp(clock);
			const book = {
				...input,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
				deletedAt: null
			};
			await tx.store.put(book);
			await tx.done;
			return book;
		},
		async removeBook(bookId) {
			const tx = db.transaction('libraryBooks', 'readwrite');
			const existing = await tx.store.get(bookId);
			if (existing && existing.deletedAt === null) {
				const now = timestamp(clock);
				await tx.store.put({ ...existing, deletedAt: now, updatedAt: now });
			}
			await tx.done;
		},
		async listRevisions(bookId) {
			const revisions = await db.getAllFromIndex('libraryRevisions', 'bookId', bookId);
			return revisions
				.filter((r) => r.deletedAt === null)
				.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
		},
		async getRevision(revisionId) {
			const revision = await db.get('libraryRevisions', revisionId);
			return revision?.deletedAt === null ? revision : undefined;
		},
		async putRevision(input) {
			const tx = db.transaction('libraryRevisions', 'readwrite');
			const existing = await tx.store.get(input.id);
			if (existing) {
				await tx.done;
				return existing;
			}
			const now = timestamp(clock);
			const revision = { ...input, createdAt: now, updatedAt: now, deletedAt: null };
			await tx.store.add(revision);
			await tx.done;
			return revision;
		},
		async putFile(revisionId, path, data) {
			const bytes = await data.arrayBuffer();
			await db.put('libraryFiles', { revisionId, path, type: data.type, bytes });
		},
		async getFile(revisionId, path) {
			const file = await db.get('libraryFiles', [revisionId, path]);
			return file && new Blob([file.bytes], { type: file.type });
		}
	};
}

function progressStore(db: Database, clock: Clock): ProgressStore {
	return {
		async get(bookId) {
			const progress = await db.get('progress', bookId);
			return progress?.deletedAt === null ? progress : undefined;
		},
		async save(input) {
			const tx = db.transaction('progress', 'readwrite');
			const existing = await tx.store.get(input.bookId);
			const now = timestamp(clock);
			const progress = {
				...input,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
				deletedAt: null
			};
			await tx.store.put(progress);
			await tx.done;
			return progress;
		}
	};
}

function preferencesStore(db: Database): PreferencesStore {
	return {
		get: (bookId) => db.get('preferences', bookId ?? GLOBAL_PREFERENCES_KEY),
		save: async (preferences, bookId) => {
			await db.put('preferences', preferences, bookId ?? GLOBAL_PREFERENCES_KEY);
		},
		clear: async (bookId) => {
			await db.delete('preferences', bookId ?? GLOBAL_PREFERENCES_KEY);
		}
	};
}

function layerSelectionStore(db: Database, clock: Clock): LayerSelectionStore {
	return {
		async get(bookId) {
			const selection = await db.get('layerSelection', bookId);
			return selection?.deletedAt === null ? selection : undefined;
		},
		async save(input) {
			const tx = db.transaction('layerSelection', 'readwrite');
			const existing = await tx.store.get(input.bookId);
			const now = timestamp(clock);
			const selection = {
				...input,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
				deletedAt: null
			};
			await tx.store.put(selection);
			await tx.done;
			return selection;
		}
	};
}

/**
 * Your reading (P1-RDR-14, P1-RDR-15). Device-only records, so the history is deleted for good
 * rather than soft-deleted (§6.3's tombstones exist for sync, which never sees these).
 */
function readingStatsStore(db: Database, clock: Clock): ReadingStatsStore {
	const PACE_ID = 'pace';
	return {
		async addToDay(entry) {
			const id = `${entry.date}|${entry.bookId}`;
			const tx = db.transaction('readingDays', 'readwrite');
			const existing = await tx.store.get(id);
			const now = timestamp(clock);
			const day = {
				id,
				date: entry.date,
				bookId: entry.bookId,
				readMs: (existing?.readMs ?? 0) + entry.readMs,
				listenedMs: (existing?.listenedMs ?? 0) + entry.listenedMs,
				words: (existing?.words ?? 0) + entry.words,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
				deletedAt: null
			};
			await tx.store.put(day);
			await tx.done;
			return day;
		},
		async listDays() {
			return db.getAllFromIndex('readingDays', 'date');
		},
		async finish(bookId, date) {
			const tx = db.transaction('bookFinishes', 'readwrite');
			const existing = await tx.store.get(bookId);
			if (existing) {
				await tx.done;
				return existing;
			}
			const now = timestamp(clock);
			const finish = { id: bookId, bookId, date, createdAt: now, updatedAt: now, deletedAt: null };
			await tx.store.put(finish);
			await tx.done;
			return finish;
		},
		async listFinishes() {
			return (await db.getAll('bookFinishes')).sort((a, b) => a.date.localeCompare(b.date));
		},
		getPace: () => db.get('readingPace', PACE_ID),
		async savePace(input) {
			const tx = db.transaction('readingPace', 'readwrite');
			const existing = await tx.store.get(PACE_ID);
			const now = timestamp(clock);
			const pace = {
				id: PACE_ID,
				words: input.words,
				ms: input.ms,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
				deletedAt: null
			};
			await tx.store.put(pace);
			await tx.done;
			return pace;
		},
		async clearHistory() {
			const tx = db.transaction(['readingDays', 'bookFinishes'], 'readwrite');
			await Promise.all([
				tx.objectStore('readingDays').clear(),
				tx.objectStore('bookFinishes').clear()
			]);
			await tx.done;
		}
	};
}

/** Every record in one read transaction, so the snapshot is consistent (P1-APP-04). */
async function exportAll(db: Database, clock: Clock): Promise<StoresSnapshot> {
	const tx = db.transaction(
		[
			'libraryBooks',
			'libraryRevisions',
			'libraryFiles',
			'annotations',
			'placedBookmarks',
			'progress',
			'preferences',
			'layerSelection',
			'readingDays',
			'bookFinishes',
			'readingPace'
		],
		'readonly'
	);
	const preferences = tx.objectStore('preferences');
	const [
		libraryBooks,
		libraryRevisions,
		files,
		annotations,
		placedBookmarks,
		progress,
		patches,
		keys,
		layerSelection,
		readingDays,
		bookFinishes,
		readingPace
	] = await Promise.all([
		tx.objectStore('libraryBooks').getAll(),
		tx.objectStore('libraryRevisions').getAll(),
		tx.objectStore('libraryFiles').getAll(),
		tx.objectStore('annotations').getAll(),
		tx.objectStore('placedBookmarks').getAll(),
		tx.objectStore('progress').getAll(),
		preferences.getAll(),
		preferences.getAllKeys(),
		tx.objectStore('layerSelection').getAll(),
		tx.objectStore('readingDays').getAll(),
		tx.objectStore('bookFinishes').getAll(),
		tx.objectStore('readingPace').getAll()
	]);
	await tx.done;
	return {
		format: 'book-reader-data',
		version: 1,
		exportedAt: timestamp(clock),
		libraryBooks,
		libraryRevisions,
		libraryFiles: files.map((f) => ({
			revisionId: f.revisionId,
			path: f.path,
			type: f.type,
			bytes: f.bytes.byteLength
		})),
		annotations,
		placedBookmarks,
		progress,
		preferences: patches.map((patch, i) => ({
			bookId: keys[i] === GLOBAL_PREFERENCES_KEY ? null : String(keys[i]),
			preferences: patch
		})),
		layerSelection,
		readingDays,
		bookFinishes,
		readingPace
	};
}

/** Clears every object store in one transaction: the database stays, empty and usable. */
async function deleteAll(db: Database): Promise<void> {
	const names = [...db.objectStoreNames];
	const tx = db.transaction(names, 'readwrite');
	await Promise.all(names.map((name) => tx.objectStore(name).clear()));
	await tx.done;
}

/** `Stores` plus closing the connection, which only the app's composition root needs. */
export interface LocalStores extends Stores {
	close(): void;
}

export async function createLocalStores(options: LocalStoresOptions = {}): Promise<LocalStores> {
	const clock = options.clock ?? systemClock;
	const db = await openReaderDB(options.dbName ?? DEFAULT_DB_NAME);
	return {
		library: libraryStore(db, clock),
		annotations: anchoredStore<Annotation>(db, 'annotations', clock),
		placedBookmarks: anchoredStore<PlacedBookmark>(db, 'placedBookmarks', clock),
		progress: progressStore(db, clock),
		preferences: preferencesStore(db),
		layerSelection: layerSelectionStore(db, clock),
		readingStats: readingStatsStore(db, clock),
		exportAll: () => exportAll(db, clock),
		deleteAll: () => deleteAll(db),
		close: () => db.close()
	};
}
