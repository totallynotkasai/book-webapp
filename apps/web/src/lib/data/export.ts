/**
 * "Export all data" and "Export all notes" (P1-APP-04, DESIGN.md §18): what lives only on this
 * device, in files the reader keeps. The JSON is every Stores record; the Markdown is every
 * Book's notes and bookmarks, a heading per Chapter, the same as the reader's own export.
 */
import {
	revisionManifestSchema,
	type Annotation,
	type PlacedBookmark,
	type RevisionManifest,
	type StoresSnapshot
} from '@book/core';
import { highlightLabels } from '@book/tokens';
import { chapterTitleAt } from '$lib/reader/chapters';
import { notesMarkdown } from '$lib/reader/notes-export';
import { getBackend, getStores } from '$lib/services';

export async function exportAllData(): Promise<StoresSnapshot> {
	return (await getStores()).exportAll();
}

interface BookInfo {
	title: string;
	creator?: string;
	manifest: RevisionManifest | null;
}

/** A Book's title and current manifest: from the device for imports, else from the backend. */
async function bookInfo(bookId: string, snapshot: StoresSnapshot): Promise<BookInfo> {
	const imported = snapshot.libraryBooks.find((b) => b.id === bookId && !b.deletedAt);
	if (imported) {
		const stores = await getStores();
		const file = await stores.library.getFile(imported.currentRevisionId, 'manifest.json');
		const manifest = file ? revisionManifestSchema.parse(JSON.parse(await file.text())) : null;
		return { title: imported.title, creator: imported.creatorName, manifest };
	}
	try {
		const backend = await getBackend();
		const opened = await backend.content.open(bookId);
		const blob = await backend.content.read(opened.contentToken, 'manifest.json');
		const manifest = revisionManifestSchema.parse(JSON.parse(await blob.text()));
		return { title: opened.title, creator: opened.creatorName || undefined, manifest };
	} catch {
		// Offline, or no longer in the library: the notes still export, without Chapter headings.
		return { title: 'A book from the store', manifest: null };
	}
}

export async function exportAllNotes(): Promise<string> {
	const snapshot = await exportAllData();
	const annotations = snapshot.annotations.filter((a) => !a.deletedAt);
	const bookmarks = snapshot.placedBookmarks.filter((b) => !b.deletedAt);
	const bookIds = [...new Set([...annotations, ...bookmarks].map((r) => r.bookId))];
	const exportedOn = new Date().toLocaleDateString(undefined, { dateStyle: 'long' });
	const sections: string[] = [];
	for (const bookId of bookIds) {
		const info = await bookInfo(bookId, snapshot);
		const live = <T extends Annotation | PlacedBookmark>(r: T) =>
			r.anchorStatus !== 'orphaned' &&
			(!info.manifest || r.anchor.revisionId === info.manifest.revisionId);
		const mine = <T extends { bookId: string }>(r: T) => r.bookId === bookId;
		const start = (a: Annotation) => a.anchor.startOrdinal;
		sections.push(
			notesMarkdown({
				title: info.title,
				creator: info.creator,
				chapterOf: (ordinal) => (info.manifest ? chapterTitleAt(info.manifest, ordinal) : null),
				annotations: annotations
					.filter(mine)
					.filter(live)
					.sort((a, b) => start(a) - start(b)),
				bookmarks: bookmarks
					.filter(mine)
					.filter(live)
					.sort((a, b) => a.anchor.ordinal - b.anchor.ordinal),
				orphaned: [
					...annotations.filter(mine).filter((a) => !live(a)),
					...bookmarks.filter(mine).filter((b) => !live(b))
				],
				colourName: (c) => highlightLabels[c],
				exportedOn
			})
		);
	}
	return sections.length
		? sections.join('\n---\n\n')
		: `# Notes\n\nNo highlights, notes or bookmarks yet (exported ${exportedOn}).\n`;
}

/** Deletes this Persona's data on this device: notes, progress, imports and preferences. */
export async function deleteDeviceData(): Promise<void> {
	await (await getStores()).deleteAll();
}
