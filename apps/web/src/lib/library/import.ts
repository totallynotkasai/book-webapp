/**
 * Importing an EPUB (P1-ING-02, DESIGN.md §4.6, §6.3): processed by text-pipeline in a Web Worker,
 * then stored through `Stores.library`. The Revision ID is the file's SHA-256, so importing the
 * same file again changes nothing; the Book ID is the EPUB's dc:identifier, or a new UUIDv7.
 *
 * A different file with the ID of a Book already here is a new Revision of it (P1-ING-03, §6.2):
 * unchanged Words keep their WordIds, and the Book's Annotations, Placed Bookmarks and Reading
 * Progress move to the new Revision, or are kept as orphaned with their quoted text.
 */
import {
	revisionManifestSchema,
	revisionPaths,
	uuidv7,
	type Anchor,
	type IngestReport,
	type LibraryBook,
	type PointAnchor,
	type Stores
} from '@book/core';
import { requestPersistentStorage } from '$lib/data/persistence';
import { ImportFailure, ingestInWorker, type IngestOutput } from '$lib/import/ingest';
import type { PreviousRevisionRequest } from '$lib/import/protocol';
import { getStores } from '$lib/services';

/** What happened to the reader's notes when a new version of a Book came in. */
export interface MigrationSummary {
	moved: number;
	orphaned: number;
}

export type ImportOutcome =
	| {
			kind: 'imported';
			bookId: string;
			title: string;
			report: IngestReport;
			newRevision: boolean;
			migration?: MigrationSummary;
	  }
	| { kind: 'already'; bookId: string; title: string }
	| { kind: 'failed'; message: string };

async function sha256(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function importEpub(
	bytes: Uint8Array,
	onProgress?: (fraction: number) => void
): Promise<ImportOutcome> {
	const stores = await getStores();
	const revisionId = await sha256(bytes);
	const existing = await stores.library.getRevision(revisionId);
	if (existing) {
		const book = await stores.library.getBook(existing.bookId);
		if (book) return { kind: 'already', bookId: book.id, title: book.title };
	}

	try {
		const progress = (done: number, total: number) => onProgress?.(total ? done / total : 1);
		let result: IngestOutput = await ingestInWorker(bytes, {
			newBookId: uuidv7(),
			onProgress: progress
		});
		const previous = await stores.library.getBook(result.bookId);
		let newRevision = false;
		let attached: Attached | null = null;
		if (previous && previous.currentRevisionId !== result.revisionId) {
			newRevision = true;
			attached = await attachedTo(stores, result.bookId, previous.currentRevisionId);
			if (attached) {
				result = await ingestInWorker(bytes, {
					bookId: result.bookId,
					previous: attached.request,
					onProgress: progress
				});
			}
		}

		for (const file of result.files) {
			await stores.library.putFile(
				result.revisionId,
				file.path,
				new Blob([file.data as Uint8Array<ArrayBuffer>], { type: file.mediaType })
			);
		}
		await stores.library.putRevision({
			id: result.revisionId,
			bookId: result.bookId,
			chapterCount: result.report.chapterCount,
			wordCount: result.report.wordCount
		});
		const book: Omit<LibraryBook, 'createdAt' | 'updatedAt' | 'deletedAt'> = {
			id: result.bookId,
			title: result.manifest.title,
			creatorName: result.manifest.creator || undefined,
			lang: result.manifest.lang,
			currentRevisionId: result.revisionId,
			source: 'import'
		};
		const migration =
			attached && result.migration ? await applyMigration(stores, attached, result) : undefined;
		await stores.library.putBook(book);
		void requestPersistentStorage();
		return {
			kind: 'imported',
			bookId: book.id,
			title: book.title,
			report: result.report,
			newRevision,
			migration
		};
	} catch (error) {
		if (error instanceof ImportFailure) return { kind: 'failed', message: error.message };
		console.error(error);
		return {
			kind: 'failed',
			message:
				'Something went wrong while importing. Try again; if it keeps happening, the file may be damaged.'
		};
	}
}

interface Attached {
	request: PreviousRevisionRequest;
	annotationIds: string[];
	bookmarkIds: string[];
	progress: boolean;
}

/** The current Revision's files and everything anchored to it, for the worker (§6.2). */
async function attachedTo(stores: Stores, bookId: string, revisionId: string) {
	const read = async (path: string) => {
		const file = await stores.library.getFile(revisionId, path);
		return file ? file.text() : undefined;
	};
	const manifestText = await read(revisionPaths.manifest);
	if (!manifestText) return null;
	const manifest = revisionManifestSchema.parse(JSON.parse(manifestText));
	const files: Record<string, string> = { [revisionPaths.manifest]: manifestText };
	for (const chapter of manifest.chapters) {
		for (const path of [
			revisionPaths.chapter(chapter.chapterId),
			revisionPaths.wordIndex(chapter.chapterId)
		]) {
			const text = await read(path);
			if (text === undefined) return null;
			files[path] = text;
		}
	}
	const onRevision = (anchor: Anchor) => anchor.revisionId === revisionId;
	const annotations = (await stores.annotations.list(bookId)).filter(
		(a) => a.anchorStatus !== 'orphaned' && onRevision(a.anchor)
	);
	const bookmarks = (await stores.placedBookmarks.list(bookId)).filter(
		(b) => b.anchorStatus !== 'orphaned' && onRevision(b.anchor)
	);
	const reading = await stores.progress.get(bookId);
	const progress: PointAnchor[] =
		reading && onRevision(reading.current) ? [reading.current, reading.furthest] : [];
	return {
		request: {
			files,
			anchors: [...annotations.map((a) => a.anchor), ...bookmarks.map((b) => b.anchor)],
			progress
		},
		annotationIds: annotations.map((a) => a.id),
		bookmarkIds: bookmarks.map((b) => b.id),
		progress: progress.length > 0
	} satisfies Attached;
}

/** Writes migrated Anchors back; orphaned records keep their old Anchor (§6.2 step 3). */
async function applyMigration(
	stores: Stores,
	attached: Attached,
	result: IngestOutput
): Promise<MigrationSummary> {
	const { anchors, progress } = result.migration!;
	let moved = 0;
	let orphaned = 0;
	for (const [k, migrated] of anchors.entries()) {
		const anchorStatus = migrated.status === 'orphaned' ? 'orphaned' : 'migrated';
		if (anchorStatus === 'orphaned') orphaned++;
		else moved++;
		if (k < attached.annotationIds.length) {
			await stores.annotations.update(attached.annotationIds[k]!, {
				anchorStatus,
				...(anchorStatus === 'migrated' && migrated.anchor.kind === 'range'
					? { anchor: migrated.anchor }
					: {})
			});
		} else {
			await stores.placedBookmarks.update(
				attached.bookmarkIds[k - attached.annotationIds.length]!,
				{
					anchorStatus,
					...(anchorStatus === 'migrated' && migrated.anchor.kind === 'point'
						? { anchor: migrated.anchor }
						: {})
				}
			);
		}
	}
	const [current, furthest] = progress;
	if (attached.progress && current && furthest) {
		const total = Math.max(1, result.manifest.wordCount - 1);
		await stores.progress.save({
			bookId: result.bookId,
			current: current.anchor,
			progression: Math.min(1, current.anchor.ordinal / total),
			furthest: furthest.anchor,
			furthestProgression: Math.min(1, furthest.anchor.ordinal / total)
		});
	}
	return { moved, orphaned };
}

/** What a new version did to the reader's notes, in plain words. */
export function migrationText(migration: MigrationSummary | undefined): string {
	const base = 'This is a new version of a book you already had.';
	if (!migration || migration.moved + migration.orphaned === 0) return base;
	const items = (n: number) => `${n} ${n === 1 ? 'note or bookmark' : 'notes and bookmarks'}`;
	if (migration.orphaned === 0) return `${base} Your ${items(migration.moved)} moved to it.`;
	return `${base} ${items(migration.moved)} moved to it. ${items(migration.orphaned)} couldn’t be placed because their text changed; they’re listed under “Orphaned” in the book’s notes.`;
}

/** "Imported Title: 23 chapters, 98,000 words." (plan §6, Phase 1.2 UX notes) */
export function reportSummary(title: string, report: IngestReport): string {
	const words = report.wordCount.toLocaleString();
	return `Imported ${title}: ${report.chapterCount} ${report.chapterCount === 1 ? 'chapter' : 'chapters'}, ${words} words.`;
}
