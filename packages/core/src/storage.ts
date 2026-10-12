/**
 * `Stores`: the storage interfaces for user-owned, local-first records (docs/DESIGN.md §6.3,
 * Invariant 7). The app persists data only through these. The implementation is chosen in
 * `apps/web/src/lib/services.ts`: `@book/storage-local` now, `storage-remote` in Phase 2.
 * Every implementation must pass `describeStoresContract` from `@book/contract-tests`.
 */
import type {
	Annotation,
	LayerSelection,
	LibraryBook,
	LibraryRevision,
	PlacedBookmark,
	ReadingProgress
} from './models';
import type { Timestamp } from './ids';
import type { ReaderPreferencesPatch } from './preferences';

type ManagedFields = 'id' | 'createdAt' | 'updatedAt' | 'deletedAt';

/** What callers supply to create a record; the store fills in ID and timestamps. */
export type NewRecord<T> = Omit<T, ManagedFields>;
/** What callers may change. The Book a record belongs to never changes. */
export type RecordChanges<T> = Partial<Omit<T, ManagedFields | 'bookId'>>;

export type StoreErrorCode = 'NOT_FOUND';

export class StoreError extends Error {
	constructor(
		readonly code: StoreErrorCode,
		message: string
	) {
		super(message);
		this.name = 'StoreError';
	}
}

/** CRUD for records attached to a Book's text by an Anchor. */
export interface AnchoredRecordStore<T extends { id: string; bookId: string }> {
	/** Live records for the Book (soft-deleted ones are left out), oldest first. */
	list(bookId: string): Promise<T[]>;
	get(id: string): Promise<T | undefined>;
	create(input: NewRecord<T>): Promise<T>;
	/** Rejects with `StoreError('NOT_FOUND')` if the record is missing or deleted. */
	update(id: string, changes: RecordChanges<T>): Promise<T>;
	/** Soft delete: sets `deletedAt`. Removing a missing record is a no-op. */
	remove(id: string): Promise<void>;
}

export type AnnotationStore = AnchoredRecordStore<Annotation>;
export type PlacedBookmarkStore = AnchoredRecordStore<PlacedBookmark>;

/** Imported Books, their Revisions and processed content files. */
export interface LibraryStore {
	listBooks(): Promise<LibraryBook[]>;
	getBook(bookId: string): Promise<LibraryBook | undefined>;
	/** Creates or replaces the Book record. `id` is the Book's `bookId` (§6.3). */
	putBook(book: NewRecord<LibraryBook> & { id: string }): Promise<LibraryBook>;
	/** Soft-deletes the Book. Its Revisions and files stay until sync confirms (§6.3). */
	removeBook(bookId: string): Promise<void>;

	listRevisions(bookId: string): Promise<LibraryRevision[]>;
	getRevision(revisionId: string): Promise<LibraryRevision | undefined>;
	/** Revisions are immutable: putting an existing `id` again is a no-op (re-import, §6.3). */
	putRevision(revision: NewRecord<LibraryRevision> & { id: string }): Promise<LibraryRevision>;

	putFile(revisionId: string, path: string, data: Blob): Promise<void>;
	getFile(revisionId: string, path: string): Promise<Blob | undefined>;
}

export interface ProgressStore {
	get(bookId: string): Promise<ReadingProgress | undefined>;
	save(progress: NewRecord<ReadingProgress>): Promise<ReadingProgress>;
}

export interface PreferencesStore {
	/** Global preferences when `bookId` is omitted, otherwise that Book's overrides. */
	get(bookId?: string): Promise<ReaderPreferencesPatch | undefined>;
	/** Replaces the stored patch for that scope. */
	save(preferences: ReaderPreferencesPatch, bookId?: string): Promise<void>;
	/** Removes a scope's patch ("Reset to my defaults" for a Book). */
	clear(bookId?: string): Promise<void>;
}

export interface LayerSelectionStore {
	get(bookId: string): Promise<LayerSelection | undefined>;
	save(selection: NewRecord<LayerSelection>): Promise<LayerSelection>;
}

/**
 * Every record the Stores hold, for "Export all data" (P1-APP-04, DESIGN.md §18). Soft-deleted
 * records are included with their `deletedAt` (they're kept until sync confirms, §6.3). A Book's
 * processed files are listed, not included: the EPUB they came from can be imported again.
 */
export interface StoresSnapshot {
	format: 'book-reader-data';
	version: 1;
	exportedAt: Timestamp;
	libraryBooks: LibraryBook[];
	libraryRevisions: LibraryRevision[];
	libraryFiles: { revisionId: string; path: string; type: string; bytes: number }[];
	annotations: Annotation[];
	placedBookmarks: PlacedBookmark[];
	progress: ReadingProgress[];
	/** `bookId` null for the global preferences, else that Book's overrides. */
	preferences: { bookId: string | null; preferences: ReaderPreferencesPatch }[];
	layerSelection: LayerSelection[];
}

/** Everything the app stores for one user, bundled so it can be swapped in one place. */
export interface Stores {
	library: LibraryStore;
	annotations: AnnotationStore;
	placedBookmarks: PlacedBookmarkStore;
	progress: ProgressStore;
	preferences: PreferencesStore;
	layerSelection: LayerSelectionStore;
	/** Every record, for "Export all data". */
	exportAll(): Promise<StoresSnapshot>;
	/** Removes every record and file ("Delete my data on this device"). */
	deleteAll(): Promise<void>;
}
