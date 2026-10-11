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
	type RecordChanges,
	type Stores
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
			await db.put('libraryFiles', { revisionId, path, data });
		},
		async getFile(revisionId, path) {
			return (await db.get('libraryFiles', [revisionId, path]))?.data;
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

/** Creates the full set of stores backed by the browser's IndexedDB. */
export async function createLocalStores(options: LocalStoresOptions = {}): Promise<Stores> {
	const clock = options.clock ?? systemClock;
	const db = await openReaderDB(options.dbName ?? DEFAULT_DB_NAME);
	return {
		library: libraryStore(db, clock),
		annotations: anchoredStore<Annotation>(db, 'annotations', clock),
		placedBookmarks: anchoredStore<PlacedBookmark>(db, 'placedBookmarks', clock),
		progress: progressStore(db, clock),
		preferences: preferencesStore(db),
		layerSelection: layerSelectionStore(db, clock)
	};
}
