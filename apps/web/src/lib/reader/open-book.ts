/**
 * Opening a Book (P1-APP-03): imported Books come from `Stores.library`, catalogue Books from
 * `Backend.content` (Entitlement-checked, read with a content token). Either way the reader gets a
 * manifest and a `ContentLoader`, so it behaves the same whatever a Book's source.
 *
 * A sample, or a serial with early-access Chapters, comes with Chapters the reader can't open
 * yet (P1-STO-01, P1-STO-04). They're left out of the manifest the engine lays out, so turning
 * pages ends where the readable text does and the reader shows why there.
 */
import {
	BackendError,
	isBackendError,
	revisionManifestSchema,
	type LockedChapterDto,
	type RevisionManifest
} from '@book/core';
import type { ContentLoader } from '@book/reader-core';
import { getBackend, getStores } from '$lib/services';

export interface OpenedBook {
	source: 'import' | 'catalogue';
	/** What the engine lays out: the Revision less any locked Chapters. */
	manifest: RevisionManifest;
	loader: ContentLoader;
	/** `sample`: "Read sample" for a Book the reader doesn't own. */
	access: 'full' | 'sample';
	/** Locked Chapters, in reading order, with their titles. */
	locked: (LockedChapterDto & { title: string })[];
	/** The store page's slug (catalogue Books). */
	slug: string | null;
}

async function readManifest(loader: ContentLoader): Promise<RevisionManifest> {
	const blob = await loader.read('manifest.json');
	return revisionManifestSchema.parse(JSON.parse(await blob.text()));
}

/** The manifest without locked Chapters. Ordinals are unchanged; locked ones are at the end. */
function withoutLocked(manifest: RevisionManifest, locked: Set<string>): RevisionManifest {
	if (!locked.size) return manifest;
	const chapters = manifest.chapters.filter((c) => !locked.has(c.chapterId));
	const last = chapters.findLast((c) => c.wordCount > 0);
	return {
		...manifest,
		chapters,
		toc: manifest.toc.filter((t) => !locked.has(t.chapterId)),
		wordCount: last ? last.lastOrdinal + 1 : 0
	};
}

export async function openBook(
	bookId: string,
	options: { sample?: boolean } = {}
): Promise<OpenedBook> {
	const stores = await getStores();
	const imported = await stores.library.getBook(bookId);
	if (imported) {
		const revisionId = imported.currentRevisionId;
		const loader: ContentLoader = {
			async read(path) {
				const file = await stores.library.getFile(revisionId, path);
				if (!file) throw new BackendError('NOT_FOUND', `This book has no file ${path}.`);
				return file;
			}
		};
		return {
			source: 'import',
			manifest: await readManifest(loader),
			loader,
			access: 'full',
			locked: [],
			slug: null
		};
	}

	const backend = await getBackend();
	let opened = await backend.content.open(bookId, options);
	const loader: ContentLoader = {
		async read(path) {
			try {
				return await backend.content.read(opened.contentToken, path);
			} catch (error) {
				// Tokens are short-lived (§10.3): open again and retry once.
				if (!isBackendError(error, 'UNAUTHENTICATED')) throw error;
				opened = await backend.content.open(bookId, options);
				return backend.content.read(opened.contentToken, path);
			}
		}
	};
	const full = await readManifest(loader);
	const titleOf = (chapterId: string) =>
		full.toc.find((t) => t.chapterId === chapterId)?.label ||
		full.chapters.find((c) => c.chapterId === chapterId)?.title ||
		'Next chapter';
	return {
		source: 'catalogue',
		manifest: withoutLocked(full, new Set(opened.locked.map((l) => l.chapterId))),
		loader,
		access: opened.access,
		locked: opened.locked.map((l) => ({ ...l, title: titleOf(l.chapterId) })),
		slug: opened.slug
	};
}
