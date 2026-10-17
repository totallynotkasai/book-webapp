/**
 * `Backend.highlights` in the browser (P1-COM-04; plan §6 Phase 1.20; Phase 6 serves it for real):
 * the passages at least a minimum number of other readers highlighted (`popularPassages` in
 * `@book/domain`), on the Book's current Revision, in the Chapters the reader can open. The
 * highlights counted are seeded: the reader's own stay on their device (§6.3, §10.5). The count
 * leaves; who highlighted never does.
 */
import type { HighlightsApi } from '@book/core';
import { POPULAR_HIGHLIGHT_MIN_READERS, popularPassages } from '@book/domain';
import type { ContentModule } from './content';
import type { BackendDatabase } from './db';
import type { Placements } from './placements';

export function createHighlightsApi(deps: {
	db: BackendDatabase;
	content: Pick<ContentModule, 'reading'>;
	placements: Placements;
}): HighlightsApi {
	const { db, placements } = deps;

	return {
		async popular(bookId) {
			const { revisionId, readable } = await deps.content.reading(bookId);
			const highlights = await placements.serially(bookId, async () => {
				const all = await db.getAllFromIndex('sharedHighlights', 'bookId', bookId);
				const placed = await placements.onRevision(all, revisionId);
				const moved = placed.filter((h, i) => h !== all[i]);
				if (moved.length) {
					const tx = db.transaction('sharedHighlights', 'readwrite');
					for (const h of moved) await tx.store.put(h);
					await tx.done;
				}
				return placed;
			});
			const counted = highlights.flatMap(({ readerId, place }) =>
				place.anchor && place.status !== 'orphaned' && readable(place.chapterId)
					? [
							{
								readerId,
								chapterId: place.chapterId,
								startOrdinal: place.anchor.startOrdinal,
								endOrdinal: place.anchor.endOrdinal
							}
						]
					: []
			);
			const text = await placements.textOf(revisionId);
			const passages = popularPassages(counted, POPULAR_HIGHLIGHT_MIN_READERS).flatMap((p) => {
				const at = text.words.between(p.startOrdinal, p.endOrdinal);
				return at ? [{ anchor: at.anchor, chapterId: at.chapterId, readers: p.readers }] : [];
			});
			return { bookId, revisionId, minReaders: POPULAR_HIGHLIGHT_MIN_READERS, passages };
		}
	};
}
