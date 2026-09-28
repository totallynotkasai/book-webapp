import type { Annotation, Bookmark, ReaderSettings, ReadingProgress } from '@book/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const GLOBAL_SETTINGS_KEY = '__global__';

export interface ReaderDB extends DBSchema {
	bookmarks: { key: string; value: Bookmark; indexes: { editionId: string } };
	annotations: { key: string; value: Annotation; indexes: { editionId: string } };
	progress: { key: string; value: ReadingProgress };
	settings: { key: string; value: Partial<ReaderSettings> };
}

export type Database = IDBPDatabase<ReaderDB>;

/** Bump when the schema changes, and add a matching step in `upgrade`. */
const VERSION = 1;

export function openReaderDB(name = 'book-reader'): Promise<Database> {
	return openDB<ReaderDB>(name, VERSION, {
		upgrade(db, oldVersion) {
			if (oldVersion < 1) {
				db.createObjectStore('bookmarks', { keyPath: 'id' }).createIndex('editionId', 'editionId');
				db.createObjectStore('annotations', { keyPath: 'id' }).createIndex(
					'editionId',
					'editionId'
				);
				db.createObjectStore('progress', { keyPath: 'editionId' });
				db.createObjectStore('settings');
			}
		}
	});
}
