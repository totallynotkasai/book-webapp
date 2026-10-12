/**
 * Importing an EPUB (P1-ING-02, DESIGN.md §4.6, §6.3): processed by text-pipeline in a Web Worker,
 * then stored through `Stores.library`. The Revision ID is the file's SHA-256, so importing the
 * same file again changes nothing; the Book ID is the EPUB's dc:identifier, or a new UUIDv7.
 */
import { revisionManifestSchema, uuidv7, type IngestReport, type LibraryBook } from '@book/core';
import { ImportFailure, ingestInWorker } from '$lib/import/ingest';
import { getStores } from '$lib/services';

export type ImportOutcome =
	| { kind: 'imported'; bookId: string; title: string; report: IngestReport; newRevision: boolean }
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
		let result = await ingestInWorker(bytes, { newBookId: uuidv7(), onProgress: progress });
		const previous = await stores.library.getBook(result.bookId);
		let newRevision = false;
		if (previous && previous.currentRevisionId !== result.revisionId) {
			// A new Revision of a Book already here: WordIds continue from its counter (§6.2). Carrying
			// unchanged Words' IDs forward and migrating Anchors is P1-ING-03.
			const manifestFile = await stores.library.getFile(
				previous.currentRevisionId,
				'manifest.json'
			);
			const old = manifestFile
				? revisionManifestSchema.parse(JSON.parse(await manifestFile.text()))
				: null;
			if (old) {
				result = await ingestInWorker(bytes, {
					bookId: result.bookId,
					firstWordId: old.nextWordId,
					onProgress: progress
				});
			}
			newRevision = true;
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
		await stores.library.putBook(book);
		return {
			kind: 'imported',
			bookId: book.id,
			title: book.title,
			report: result.report,
			newRevision
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

/** "Imported Title: 23 chapters, 98,000 words." (plan §6, Phase 1.2 UX notes) */
export function reportSummary(title: string, report: IngestReport): string {
	const words = report.wordCount.toLocaleString();
	return `Imported ${title}: ${report.chapterCount} ${report.chapterCount === 1 ? 'chapter' : 'chapters'}, ${words} words.`;
}
