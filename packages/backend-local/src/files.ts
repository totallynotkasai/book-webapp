/**
 * Files the simulated backend keeps itself: Studio uploads in `layerFiles` (P1-STU-01 to
 * P1-STU-03, P1-LAY-05) and processed Revisions in `content`. Layers built in the Studio are
 * addressed as `studio:<layerId>/<path>`, so the code that reads seeded Layers from static files
 * reads them the same way. Things the app shows directly (covers, audio) get object URLs, made
 * once per session: Phase 2 serves them from object storage instead (§6.7).
 */
import type { BackendDatabase } from './db';
import type { StoredFileRef } from './seed';

export const STUDIO_PREFIX = 'studio:';

/** `studio:<layerId>/<path>` → its parts, or null for any other URL. */
export function parseStudioUrl(url: string): { layerId: string; path: string } | null {
	if (!url.startsWith(STUDIO_PREFIX)) return null;
	const rest = url.slice(STUDIO_PREFIX.length);
	const slash = rest.indexOf('/');
	if (slash <= 0) return null;
	return { layerId: rest.slice(0, slash), path: rest.slice(slash + 1) };
}

export const studioUrl = (layerId: string, path: string) => `${STUDIO_PREFIX}${layerId}/${path}`;

export interface StoredFiles {
	put(layerId: string, path: string, bytes: Uint8Array | ArrayBuffer, type: string): Promise<void>;
	read(layerId: string, path: string): Promise<Uint8Array | undefined>;
	/** Every file of a Layer (e.g. a pack's old images). */
	remove(layerId: string, path?: string): Promise<void>;
	/** An object URL for a stored file, or null if it's gone. */
	url(ref: StoredFileRef): Promise<string | null>;
	/** Text files of a processed Revision by path, for text-pipeline (manifest, Chapters, indexes). */
	revisionText(revisionId: string): Promise<Record<string, string>>;
}

export function createStoredFiles(db: BackendDatabase): StoredFiles {
	const urls = new Map<string, string>();
	const keyOf = (ref: StoredFileRef) => `${ref.store}|${ref.id}|${ref.path}`;

	function forget(layerId: string, path?: string) {
		for (const [key, url] of urls) {
			const [store, id, p] = key.split('|');
			if (store === 'layerFiles' && id === layerId && (path === undefined || p === path)) {
				URL.revokeObjectURL(url);
				urls.delete(key);
			}
		}
	}

	return {
		async put(layerId, path, bytes, type) {
			const buffer =
				bytes instanceof Uint8Array ? (bytes.slice().buffer as ArrayBuffer) : bytes.slice(0);
			forget(layerId, path);
			await db.put('layerFiles', { layerId, path, type, bytes: buffer });
		},

		async read(layerId, path) {
			const file = await db.get('layerFiles', [layerId, path]);
			return file ? new Uint8Array(file.bytes) : undefined;
		},

		async remove(layerId, path) {
			forget(layerId, path);
			if (path !== undefined) {
				await db.delete('layerFiles', [layerId, path]);
				return;
			}
			const range = IDBKeyRange.bound([layerId, ''], [layerId, '￿']);
			await db.delete('layerFiles', range);
		},

		async url(ref) {
			const key = keyOf(ref);
			const known = urls.get(key);
			if (known) return known;
			const file =
				ref.store === 'layerFiles'
					? await db.get('layerFiles', [ref.id, ref.path])
					: await db.get('content', [ref.id, ref.path]);
			if (!file) return null;
			const url = URL.createObjectURL(new Blob([file.bytes], { type: file.type }));
			urls.set(key, url);
			return url;
		},

		async revisionText(revisionId) {
			const range = IDBKeyRange.bound([revisionId, ''], [revisionId, '￿']);
			const files = await db.getAll('content', range);
			const decoder = new TextDecoder();
			const text: Record<string, string> = {};
			for (const file of files) {
				if (file.path === 'manifest.json' || /^(content|index)\//.test(file.path)) {
					text[file.path] = decoder.decode(file.bytes);
				}
			}
			return text;
		}
	};
}
