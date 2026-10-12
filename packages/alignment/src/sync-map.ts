/**
 * Sync Map writer (docs/DESIGN.md §7.2 step 7) and the lookups the narration player needs
 * (§8.3): time → Word by binary search, Word → time through a `Map<WordId, index>`.
 */
import {
	SYNC_MAP_INTERPOLATED,
	SYNC_MAP_VERSION,
	syncMapSchema,
	type SyncMap,
	type SyncMapWord,
	type WordId
} from '@book/core';
import type { ChapterAlignment } from './align';

export interface SyncMapTarget {
	trackId: string;
	revisionId: string;
	chapterId: string;
	audioKey: string;
	durationMs: number;
}

/** Builds and validates the Sync Map for one Chapter. `words` is sorted by `startMs`. */
export function toSyncMap(target: SyncMapTarget, alignment: ChapterAlignment): SyncMap {
	const words: SyncMapWord[] = alignment.timings
		.map((t, order) => ({ t, order }))
		// Stable: Words starting at the same ms keep reading order.
		.sort((x, y) => x.t.startMs - y.t.startMs || x.order - y.order)
		.map(({ t }) => [t.wordId, t.startMs, t.endMs, t.interpolated ? SYNC_MAP_INTERPOLATED : 0]);
	return syncMapSchema.parse({
		version: SYNC_MAP_VERSION,
		...target,
		durationMs: Math.round(target.durationMs),
		coverage: Math.round(alignment.coverage * 10_000) / 10_000,
		words
	}) as SyncMap;
}

/**
 * The index of the Word being spoken at `ms`: the last entry starting at or before it, or -1
 * before the first Word. `words` must be sorted by `startMs`, as every Sync Map is.
 */
export function timeToWordIndex(words: readonly SyncMapWord[], ms: number): number {
	let lo = 0;
	let hi = words.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (words[mid]![1] <= ms) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found;
}

/** WordId → index into `words`, built once when a Sync Map loads (for tap-to-seek). */
export function wordIndexMap(words: readonly SyncMapWord[]): Map<WordId, number> {
	return new Map(words.map((w, i) => [w[0], i]));
}
