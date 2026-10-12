import type {
	Annotation,
	LayerSelection,
	LibraryBook,
	LibraryRevision,
	PlacedBookmark,
	ReaderPreferencesPatch,
	ReadingProgress
} from '@book/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const GLOBAL_PREFERENCES_KEY = '__global__';

/**
 * Anchors are kept as nested objects of typed fields (not JSON strings), so they can be indexed
 * and migrated cheaply (docs/DESIGN.md §6.1).
 */
/**
 * A Book file. Kept as bytes plus a media type rather than a Blob: some WebKit builds can't put
 * Blobs in IndexedDB, and bytes work in every engine. `getFile` hands back a Blob.
 */
export interface StoredFile {
	revisionId: string;
	path: string;
	type: string;
	bytes: ArrayBuffer;
}

export interface ReaderDB extends DBSchema {
	libraryBooks: { key: string; value: LibraryBook };
	libraryRevisions: { key: string; value: LibraryRevision; indexes: { bookId: string } };
	libraryFiles: { key: [string, string]; value: StoredFile };
	annotations: { key: string; value: Annotation; indexes: { bookId: string } };
	placedBookmarks: { key: string; value: PlacedBookmark; indexes: { bookId: string } };
	progress: { key: string; value: ReadingProgress };
	preferences: { key: string; value: ReaderPreferencesPatch };
	layerSelection: { key: string; value: LayerSelection };
}

export type Database = IDBPDatabase<ReaderDB>;

/** Bump when the schema changes, and add a matching step in `upgrade`. */
const VERSION = 2;

/** Object stores from version 1 (the v0.1 Locator model), dropped in version 2. */
const V1_STORES = ['bookmarks', 'annotations', 'progress', 'settings'];

/** The default database name. In the PoC each Persona gets `book-reader:<userId>` (§6.3). */
export const DEFAULT_DB_NAME = 'book-reader';

export async function openReaderDB(name = DEFAULT_DB_NAME): Promise<Database> {
	const db = await openDB<ReaderDB>(name, VERSION, {
		// Another tab (or "Wipe device data") wants to delete or upgrade this database: let it.
		blocking() {
			db.close();
		},
		upgrade(db, oldVersion) {
			if (oldVersion < 2) {
				// Version 1 stored v0.1 Locators (CFIs and character offsets), which Invariant 2 forbids.
				// There are no real users yet, so its data is dropped rather than converted (Appendix B).
				const legacy = db as unknown as IDBDatabase;
				for (const store of V1_STORES) {
					if (legacy.objectStoreNames.contains(store)) legacy.deleteObjectStore(store);
				}
				db.createObjectStore('libraryBooks', { keyPath: 'id' });
				db.createObjectStore('libraryRevisions', { keyPath: 'id' }).createIndex('bookId', 'bookId');
				db.createObjectStore('libraryFiles', { keyPath: ['revisionId', 'path'] });
				db.createObjectStore('annotations', { keyPath: 'id' }).createIndex('bookId', 'bookId');
				db.createObjectStore('placedBookmarks', { keyPath: 'id' }).createIndex('bookId', 'bookId');
				db.createObjectStore('progress', { keyPath: 'bookId' });
				db.createObjectStore('preferences');
				db.createObjectStore('layerSelection', { keyPath: 'bookId' });
			}
		}
	});
	return db;
}
