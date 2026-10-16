/**
 * Opening a Book (P1-APP-03): imported Books come from `Stores.library`, catalogue Books from
 * `Backend.content` (Entitlement-checked, read with a content token). Either way the reader gets a
 * manifest and a `ContentLoader`, so it behaves the same whatever a Book's source.
 *
 * A sample, or a serial with early-access Chapters, comes with Chapters the reader can't open
 * yet (P1-STO-01, P1-STO-04). They're left out of the manifest the engine lays out, so turning
 * pages ends where the readable text does and the reader shows why there.
 *
 * A Creator previewing one of their own Revisions (P1-STU-01), or building a pack on it in
 * Creator mode (P1-LAY-05), opens it through `Backend.studio.previewRevision` instead.
 */
import {
	BackendError,
	isBackendError,
	revisionManifestSchema,
	revisionPaths,
	wordIndexSchema,
	type LockedChapterDto,
	type PointAnchor,
	type RevisionManifest
} from '@book/core';
import { textStart } from '@book/domain';
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
		...(manifest.landmarks
			? { landmarks: manifest.landmarks.filter((l) => !locked.has(l.chapterId)) }
			: {}),
		wordCount: last ? last.lastOrdinal + 1 : 0
	};
}

/**
 * Where a Book opened for the first time starts (P1-RDR-09): the first Word of its text, past
 * any front matter (`textStart` in `@book/domain`). Undefined leaves the engine's own default.
 *
 * Only a place to open at, never stored, so the quote stays empty: the engine reports the
 * Anchor on screen, quote and all, as soon as it has laid the page out.
 */
export async function startOfText(book: OpenedBook): Promise<PointAnchor | undefined> {
	const { manifest, loader } = book;
	const start = textStart(manifest);
	const chapter = start && manifest.chapters.find((c) => c.chapterId === start.chapterId);
	if (!start || !chapter) return undefined;
	let wordId = start.ordinal === chapter.firstOrdinal ? chapter.firstWordId : null;
	if (wordId === null) {
		// The start is inside the Chapter (a landmark or contents entry with a fragment).
		const file = await loader.read(revisionPaths.wordIndex(chapter.chapterId));
		const index = wordIndexSchema.parse(JSON.parse(await file.text()));
		wordId = index.words[start.ordinal - index.firstOrdinal]?.[0] ?? null;
	}
	if (wordId === null) return undefined;
	return {
		kind: 'point',
		bookId: manifest.bookId,
		revisionId: manifest.revisionId,
		wordId,
		ordinal: start.ordinal,
		quote: { exact: '', prefix: '', suffix: '' }
	};
}

export interface OpenOptions {
	sample?: boolean;
	/** A Creator's own Revision: this one, or the newest when the ID is omitted. */
	preview?: { revisionId?: string };
}

export async function openBook(bookId: string, options: OpenOptions = {}): Promise<OpenedBook> {
	const stores = await getStores();
	const imported = options.preview ? undefined : await stores.library.getBook(bookId);
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
	const { preview, sample } = options;
	const openIt = () =>
		preview
			? backend.studio.previewRevision(bookId, preview.revisionId)
			: backend.content.open(bookId, { sample });
	let opened = await openIt();
	const loader: ContentLoader = {
		async read(path) {
			try {
				return await backend.content.read(opened.contentToken, path);
			} catch (error) {
				// Tokens are short-lived (§10.3): open again and retry once.
				if (!isBackendError(error, 'UNAUTHENTICATED')) throw error;
				opened = await openIt();
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
