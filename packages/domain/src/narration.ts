/**
 * Narration rules for the Studio's narration manager (DESIGN.md §7.2, P1-STU-03), shared with
 * the Phase 3 `align-narration` job: a Chapter's Sync Map status, the low-confidence regions a
 * creator reviews, and the checks an uploaded Sync Map must pass before readers hear it.
 */
import { isInterpolated, type SyncMap, type SyncMapStatus, type SyncMapWord } from '@book/core';

/** Below this coverage a Sync Map needs a creator's review (§7.2 step 6, configurable). */
export const REVIEW_BELOW = 0.9;

export function syncMapStatus(
	coverage: number,
	stale: boolean,
	reviewBelow = REVIEW_BELOW
): SyncMapStatus {
	if (stale) return 'stale';
	return coverage < reviewBelow ? 'needs_review' : 'ready';
}

/**
 * `coverage = matched / total` (§7.2 step 6), recomputed rather than trusted from the file:
 * Words heard in the transcript over every Word in the Chapter.
 */
export function coverageOf(words: readonly SyncMapWord[], chapterWordCount: number): number {
	if (chapterWordCount === 0) return 1;
	const heard = words.filter((w) => !isInterpolated(w)).length;
	return Math.min(1, heard / chapterWordCount);
}

export interface ReviewRegion {
	index: number;
	/** Positions in the Sync Map's `words` (audio order), inclusive. */
	from: number;
	to: number;
	startMs: number;
	endMs: number;
	firstWordId: number;
	lastWordId: number;
	/** Interpolated Words in it. */
	wordCount: number;
}

/**
 * Runs of interpolated Words (§7.2 step 5), in audio order. Runs with fewer than `mergeGap`
 * heard Words between them are one region, so a creator listens to a stretch once rather
 * than word by word.
 */
export function lowConfidenceRegions(words: readonly SyncMapWord[], mergeGap = 3): ReviewRegion[] {
	const regions: ReviewRegion[] = [];
	let current: ReviewRegion | null = null;
	words.forEach((word, i) => {
		if (!isInterpolated(word)) return;
		if (current && i - current.to <= mergeGap) {
			current.to = i;
			current.endMs = Math.max(current.endMs, word[2]);
			current.lastWordId = word[0];
			current.wordCount++;
			return;
		}
		current = {
			index: regions.length,
			from: i,
			to: i,
			startMs: word[1],
			endMs: word[2],
			firstWordId: word[0],
			lastWordId: word[0],
			wordCount: 1
		};
		regions.push(current);
	});
	return regions;
}

/**
 * Why an uploaded Sync Map can't be used for a Chapter, in words a creator can act on; empty
 * when it can. It must be for this Revision and Chapter and name only the Chapter's Words.
 */
export function syncMapProblems(
	map: Pick<SyncMap, 'revisionId' | 'chapterId' | 'words'>,
	chapter: { revisionId: string; chapterId: string; wordIds: ReadonlySet<number> }
): string[] {
	const problems: string[] = [];
	if (map.revisionId !== chapter.revisionId) {
		problems.push(
			'This Sync Map was made for another version of the book. Align the audio against the version you’re narrating.'
		);
	}
	if (map.chapterId !== chapter.chapterId) {
		problems.push(`This Sync Map is for another chapter (${map.chapterId}).`);
	}
	const unknown = map.words.filter((w) => !chapter.wordIds.has(w[0])).length;
	if (unknown > 0 && problems.length === 0) {
		problems.push(
			`${unknown} ${unknown === 1 ? 'word in it isn’t' : 'words in it aren’t'} in this chapter.`
		);
	}
	if (map.words.length === 0) problems.push('This Sync Map has no words.');
	return problems;
}
