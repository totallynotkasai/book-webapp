/**
 * Readers' things attached to a Book's text on the "server" (P1-COM-03, P1-COM-04): comments and
 * other readers' highlights, each kept as a `Placement` and moved to the Book's current Revision
 * whenever they're read on it (§6.2's re-anchoring, done as they're read rather than when the
 * author publishes; Phase 6 runs it at publish). A seeded passage is found in its Chapter's text;
 * an Anchor on an older Revision is migrated by its WordIds, then by its quote; what can't be
 * placed is orphaned: kept, but not shown.
 */
import { revisionManifestSchema, revisionPaths, type RevisionManifest } from '@book/core';
import { RevisionWordTexts } from '@book/domain';
import type { BackendDatabase, Placement } from './db';
import type { StoredFiles } from './files';
import type { Pipeline } from './pipeline';

export interface RevisionText {
	manifest: RevisionManifest;
	words: RevisionWordTexts;
}

export interface Placements {
	/** A Revision's Words, to find passages in. Revisions never change, so it's kept. */
	textOf(revisionId: string): Promise<RevisionText>;
	/**
	 * Each record's place on `revisionId`, in the same order; a record already placed there comes
	 * back as it was (the same object), so the caller saves only the ones that changed.
	 */
	onRevision<T extends { place: Placement }>(records: T[], revisionId: string): Promise<T[]>;
	/** One Book's placing at a time, so two readers can't move the same records twice. */
	serially<T>(bookId: string, run: () => Promise<T>): Promise<T>;
}

/** The Chapter an Ordinal is in. */
export function chapterAt(manifest: RevisionManifest, ordinal: number) {
	return manifest.chapters.find(
		(c) => c.wordCount > 0 && ordinal >= c.firstOrdinal && ordinal <= c.lastOrdinal
	);
}

export function createPlacements(deps: {
	db: BackendDatabase;
	pipeline: Pipeline;
	files: StoredFiles;
}): Placements {
	const { db, files } = deps;
	const texts = new Map<string, Promise<RevisionText>>();
	const queues = new Map<string, Promise<unknown>>();

	async function manifestOf(revisionId: string): Promise<RevisionManifest> {
		const file = await db.get('content', [revisionId, revisionPaths.manifest]);
		if (!file) throw new Error(`Revision ${revisionId} has no manifest.`);
		return revisionManifestSchema.parse(JSON.parse(new TextDecoder().decode(file.bytes)));
	}

	function textOf(revisionId: string): Promise<RevisionText> {
		let cached = texts.get(revisionId);
		if (!cached) {
			cached = (async () => {
				const manifest = await manifestOf(revisionId);
				const chapters = await deps.pipeline.words(await files.revisionText(revisionId));
				const first = new Map(manifest.chapters.map((c) => [c.chapterId, c.firstOrdinal]));
				const words = new RevisionWordTexts(
					manifest.bookId,
					revisionId,
					chapters.map((c) => ({ ...c, firstOrdinal: first.get(c.chapterId) ?? 0 }))
				);
				return { manifest, words };
			})();
			cached.catch(() => texts.delete(revisionId));
			texts.set(revisionId, cached);
		}
		return cached;
	}

	/** Found by its Words in its Chapter (a seeded passage, or one whose WordIds are gone). */
	function found(text: RevisionText, passage: string, chapterId: string): Placement | null {
		const at = text.words.find(passage, chapterId) ?? text.words.find(passage);
		return at
			? {
					revisionId: text.manifest.revisionId,
					chapterId: at.chapterId,
					anchor: at.anchor,
					status: 'migrated',
					passage: null
				}
			: null;
	}

	async function onRevision<T extends { place: Placement }>(
		records: T[],
		revisionId: string
	): Promise<T[]> {
		const out = [...records];
		const stale = out.flatMap((r, i) => (r.place.revisionId === revisionId ? [] : [i]));
		if (!stale.length) return out;
		const text = await textOf(revisionId);
		const orphaned = (place: Placement): Placement => ({
			...place,
			revisionId,
			status: 'orphaned'
		});
		// Anchors on older Revisions move by WordIds, a Revision at a time.
		const byRevision = new Map<string, number[]>();
		for (const i of stale) {
			const { place } = out[i]!;
			if (!place.anchor) {
				// A seeded passage: found in its Chapter, or tried again on the next Revision.
				const at = place.passage ? found(text, place.passage, place.chapterId) : null;
				out[i] = { ...out[i]!, place: at ? { ...at, status: 'ok' } : orphaned(place) };
				continue;
			}
			const list = byRevision.get(place.anchor.revisionId) ?? [];
			list.push(i);
			byRevision.set(place.anchor.revisionId, list);
		}
		for (const [from, indexes] of byRevision) {
			let migrated: Awaited<ReturnType<Pipeline['migrate']>>['anchors'] | null = null;
			try {
				const [before, after] = await Promise.all([
					files.revisionText(from),
					files.revisionText(revisionId)
				]);
				migrated = (
					await deps.pipeline.migrate({
						before,
						after,
						anchors: indexes.map((i) => out[i]!.place.anchor!),
						progress: []
					})
				).anchors;
			} catch {
				// The older Revision's text is gone: fall back to each quote.
			}
			indexes.forEach((i, k) => {
				const { place } = out[i]!;
				const moved = migrated?.[k];
				const chapter =
					moved && moved.status !== 'orphaned' && moved.anchor.kind === 'range'
						? chapterAt(text.manifest, moved.anchor.startOrdinal)
						: undefined;
				if (moved && chapter && moved.anchor.kind === 'range') {
					out[i] = {
						...out[i]!,
						place: {
							revisionId,
							chapterId: chapter.chapterId,
							anchor: moved.anchor,
							status: moved.status,
							passage: null
						}
					};
					return;
				}
				const again = migrated ? null : found(text, place.anchor!.quote.exact, place.chapterId);
				out[i] = { ...out[i]!, place: again ?? orphaned(place) };
			});
		}
		return out;
	}

	function serially<T>(bookId: string, run: () => Promise<T>): Promise<T> {
		const next = (queues.get(bookId) ?? Promise.resolve()).then(run, run);
		queues.set(
			bookId,
			next.catch(() => {})
		);
		return next;
	}

	return { textOf, onRevision, serially };
}
