/**
 * One Library list (P1-APP-03): catalogue Books the user owns (from `Backend.library`) and Books
 * they imported (from `Stores.library`), with "Continue reading" from Reading Progress. Imported
 * Books are on the device, so they still show when the backend can't be reached.
 */
import { revisionManifestSchema, type BookSummaryDto, type ReadingProgress } from '@book/core';
import { describeError, type DescribedError } from '$lib/errors';
import { progressSaved } from '$lib/reader/progress';
import { getBackend, getStores } from '$lib/services';

export interface LibraryItem {
	bookId: string;
	title: string;
	creatorName: string;
	/** A static path, a blob URL for an imported cover, or null for a generated cover. */
	coverUrl: string | null;
	source: 'catalogue' | 'import';
	book: BookSummaryDto;
	progress: ReadingProgress | undefined;
}

export interface LibraryView {
	items: LibraryItem[];
	continueReading: LibraryItem[];
	/** Set when the catalogue part couldn't load (imports are still listed). */
	backendError: DescribedError | null;
}

/** Imported covers as blob URLs, kept for the session (one per Revision). */
const coverUrls = new Map<string, Promise<string | null>>();

function importedCover(revisionId: string): Promise<string | null> {
	let url = coverUrls.get(revisionId);
	if (!url) {
		url = (async () => {
			const stores = await getStores();
			const manifestFile = await stores.library.getFile(revisionId, 'manifest.json');
			if (!manifestFile) return null;
			const manifest = revisionManifestSchema.parse(JSON.parse(await manifestFile.text()));
			if (!manifest.coverPath) return null;
			const cover = await stores.library.getFile(revisionId, `res/${manifest.coverPath}`);
			return cover ? URL.createObjectURL(cover) : null;
		})().catch(() => null);
		coverUrls.set(revisionId, url);
	}
	return url;
}

export async function loadLibrary(): Promise<LibraryView> {
	const stores = await getStores();
	await progressSaved();
	let backendError: DescribedError | null = null;
	let catalogue: BookSummaryDto[] = [];
	try {
		const backend = await getBackend();
		catalogue = (await backend.library.list({ limit: 100 })).items.map((entry) => entry.book);
	} catch (error) {
		backendError = describeError(error);
	}

	const imported = await stores.library.listBooks();
	const items: LibraryItem[] = [];
	for (const book of catalogue) {
		items.push({
			bookId: book.id,
			title: book.title,
			creatorName: book.creatorName,
			coverUrl: book.coverUrl,
			source: 'catalogue',
			book,
			progress: await stores.progress.get(book.id)
		});
	}
	for (const book of imported) {
		items.push({
			bookId: book.id,
			title: book.title,
			creatorName: book.creatorName ?? '',
			coverUrl: await importedCover(book.currentRevisionId),
			source: 'import',
			book: {
				id: book.id,
				slug: book.id,
				title: book.title,
				creatorId: '',
				creatorName: book.creatorName ?? '',
				lang: book.lang,
				aiUse: 'none',
				coverUrl: null,
				price: { amountMinor: 0, currency: 'GBP' },
				contentRating: 'all_ages',
				hasIllustrations: false,
				hasNarration: false,
				inLibrary: true
			},
			progress: await stores.progress.get(book.id)
		});
	}
	items.sort((a, b) => a.title.localeCompare(b.title));
	const continueReading = items
		.filter((i) => i.progress && i.progress.progression > 0)
		.sort((a, b) => b.progress!.updatedAt.localeCompare(a.progress!.updatedAt))
		.slice(0, 4);
	return { items, continueReading, backendError };
}
