/**
 * Storage interfaces.
 *
 * The app only ever talks to these. Implementations are swappable: `@book/storage-local`
 * (browser IndexedDB) for the proof of concept, a backend-backed version later.
 */
import type { Annotation, Bookmark, ReadingProgress } from './models';
import type { ReaderSettings } from './settings';

/** Fields the store fills in itself. */
type NewRecord<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>;
type Editable<T> = Partial<Omit<T, 'id' | 'editionId' | 'createdAt' | 'updatedAt'>>;

export interface BookmarkStore {
	list(editionId: string): Promise<Bookmark[]>;
	create(input: NewRecord<Bookmark>): Promise<Bookmark>;
	update(id: string, changes: Editable<Bookmark>): Promise<Bookmark>;
	remove(id: string): Promise<void>;
}

export interface AnnotationStore {
	list(editionId: string): Promise<Annotation[]>;
	create(input: NewRecord<Annotation>): Promise<Annotation>;
	update(id: string, changes: Editable<Annotation>): Promise<Annotation>;
	remove(id: string): Promise<void>;
}

export interface ProgressStore {
	get(editionId: string): Promise<ReadingProgress | undefined>;
	save(progress: ReadingProgress): Promise<void>;
}

export interface SettingsStore {
	/** Global settings when `bookId` is omitted, otherwise the per-book overrides. */
	get(bookId?: string): Promise<Partial<ReaderSettings> | undefined>;
	save(settings: Partial<ReaderSettings>, bookId?: string): Promise<void>;
}

/** Everything the app needs from storage, bundled so it can be swapped in one place. */
export interface Stores {
	bookmarks: BookmarkStore;
	annotations: AnnotationStore;
	progress: ProgressStore;
	settings: SettingsStore;
}
