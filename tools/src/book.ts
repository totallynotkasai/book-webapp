/**
 * The catalogue *Alice* as `backend-local` processes it (same EPUB, same Book ID, same
 * text-pipeline), so Anchors made here match the Revision readers open.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RevisionManifest } from '@book/core';
import {
	ingestEpub,
	readRevisionWords,
	RevisionIndex,
	type RevisionWords
} from '@book/text-pipeline';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface LoadedBook {
	manifest: RevisionManifest;
	revision: RevisionWords;
	index: RevisionIndex;
}

export async function loadBook(
	epub = 'apps/web/static/books/alice.epub',
	bookId = 'book-alice'
): Promise<LoadedBook> {
	const result = await ingestEpub(new Uint8Array(readFileSync(join(ROOT, epub))), { bookId });
	const files = new Map(result.files.map((f) => [f.path, new TextDecoder().decode(f.data)]));
	const revision = readRevisionWords((path) => files.get(path));
	return { manifest: result.manifest, revision, index: new RevisionIndex(revision) };
}
