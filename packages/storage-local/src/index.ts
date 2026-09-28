import type {
	Annotation,
	AnnotationStore,
	Bookmark,
	BookmarkStore,
	ProgressStore,
	SettingsStore,
	Stores
} from '@book/core';
import { GLOBAL_SETTINGS_KEY, openReaderDB, type Database } from './db';

const now = () => new Date().toISOString();

type RecordStoreName = 'bookmarks' | 'annotations';

/** Shared CRUD for the per-edition record stores (bookmarks, annotations). */
function recordStore<T extends Bookmark | Annotation>(db: Database, name: RecordStoreName) {
	return {
		async list(editionId: string): Promise<T[]> {
			return (await db.getAllFromIndex(name, 'editionId', editionId)) as T[];
		},
		async create(input: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T> {
			const timestamp = now();
			const record = {
				...input,
				id: crypto.randomUUID(),
				createdAt: timestamp,
				updatedAt: timestamp
			} as T;
			await db.add(name, record);
			return record;
		},
		async update(id: string, changes: Partial<T>): Promise<T> {
			const tx = db.transaction(name, 'readwrite');
			const existing = await tx.store.get(id);
			if (!existing) throw new Error(`No ${name} record with id ${id}`);
			const updated = { ...existing, ...changes, id, updatedAt: now() } as T;
			await tx.store.put(updated);
			await tx.done;
			return updated;
		},
		async remove(id: string): Promise<void> {
			await db.delete(name, id);
		}
	};
}

function progressStore(db: Database): ProgressStore {
	return {
		get: (editionId) => db.get('progress', editionId),
		save: async (progress) => {
			await db.put('progress', progress);
		}
	};
}

function settingsStore(db: Database): SettingsStore {
	return {
		get: (bookId) => db.get('settings', bookId ?? GLOBAL_SETTINGS_KEY),
		save: async (settings, bookId) => {
			await db.put('settings', settings, bookId ?? GLOBAL_SETTINGS_KEY);
		}
	};
}

/** Creates the full set of stores backed by the browser's IndexedDB. */
export async function createLocalStores(dbName?: string): Promise<Stores> {
	const db = await openReaderDB(dbName);
	return {
		bookmarks: recordStore<Bookmark>(db, 'bookmarks') satisfies BookmarkStore,
		annotations: recordStore<Annotation>(db, 'annotations') satisfies AnnotationStore,
		progress: progressStore(db),
		settings: settingsStore(db)
	};
}
