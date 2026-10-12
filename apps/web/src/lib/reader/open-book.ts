/**
 * Opening a Book (P1-APP-03): imported Books come from `Stores.library`, catalogue Books from
 * `Backend.content` (Entitlement-checked, read with a content token). Either way the reader gets a
 * manifest and a `ContentLoader`, so it behaves the same whatever a Book's source.
 */
import {
	BackendError,
	isBackendError,
	revisionManifestSchema,
	type RevisionManifest
} from '@book/core';
import type { ContentLoader } from '@book/reader-core';
import { getBackend, getStores } from '$lib/services';

export interface OpenedBook {
	source: 'import' | 'catalogue';
	manifest: RevisionManifest;
	loader: ContentLoader;
}

async function readManifest(loader: ContentLoader): Promise<RevisionManifest> {
	const blob = await loader.read('manifest.json');
	return revisionManifestSchema.parse(JSON.parse(await blob.text()));
}

export async function openBook(bookId: string): Promise<OpenedBook> {
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
		return { source: 'import', manifest: await readManifest(loader), loader };
	}

	const backend = await getBackend();
	let opened = await backend.content.open(bookId);
	const loader: ContentLoader = {
		async read(path) {
			try {
				return await backend.content.read(opened.contentToken, path);
			} catch (error) {
				// Tokens are short-lived (§10.3): open again and retry once.
				if (!isBackendError(error, 'UNAUTHENTICATED')) throw error;
				opened = await backend.content.open(bookId);
				return backend.content.read(opened.contentToken, path);
			}
		}
	};
	return { source: 'catalogue', manifest: await readManifest(loader), loader };
}
