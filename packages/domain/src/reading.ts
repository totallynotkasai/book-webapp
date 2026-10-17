/**
 * Reading time left (P1-RDR-14, DESIGN.md §4.9), from the reader's own pace, and the local date
 * reading is counted under (P1-RDR-15). Kept apart from the stats (reading-stats.ts), which only
 * You → Your reading needs, so the reader's bundle carries just this. Pure functions; nothing
 * here ever reaches a Backend.
 */

// ---- Pace and time left (P1-RDR-14) ----

/**
 * The stated default pace, before the reader's own is known: 238 Words a minute, the average
 * silent reading rate of adults reading non-fiction in English (Brysbaert, 2019, a review of
 * 190 studies; fiction is about 260). Slower is the safer guess for "time left".
 */
export const DEFAULT_WORDS_PER_MINUTE = 238;

/**
 * A page "read" faster or slower than this isn't reading: a skim or a flick past it (too fast),
 * or the reader stopped to do something else (too slow). Neither teaches the pace.
 */
export const READING_PACE = { min: 60, max: 900 } as const;

/** How much of the default pace the reader starts with, in Words: their own soon outweighs it. */
const PRIOR_WORDS = 200;

/** After this many Words read, a page counts half as much, so the pace follows the reader. */
export const PACE_HALF_LIFE_WORDS = 4000;

/** The reader's pace: Words over time, older pages counting less (decayed sums). */
export interface Pace {
	words: number;
	ms: number;
}

/** The pace a new reader starts from. */
export function defaultPace(wordsPerMinute = DEFAULT_WORDS_PER_MINUTE): Pace {
	return { words: PRIOR_WORDS, ms: (PRIOR_WORDS / wordsPerMinute) * 60_000 };
}

export function wordsPerMinute(pace: Pace): number {
	return pace.ms > 0 ? (pace.words / pace.ms) * 60_000 : DEFAULT_WORDS_PER_MINUTE;
}

/** Whether `words` in `ms` was read at a reading pace (not a skim, not a pause). */
export function isReadingPace(words: number, ms: number): boolean {
	if (words <= 0 || ms <= 0) return false;
	const wpm = (words / ms) * 60_000;
	return wpm >= READING_PACE.min && wpm <= READING_PACE.max;
}

/** The pace with a page read added: `words` in `ms`. Pages not read at a reading pace are left out. */
export function withPage(pace: Pace, words: number, ms: number): Pace {
	if (!isReadingPace(words, ms)) return pace;
	const keep = 2 ** (-words / PACE_HALF_LIFE_WORDS);
	return { words: pace.words * keep + words, ms: pace.ms * keep + ms };
}

/** How long `words` take at the reader's pace. */
export function timeLeftMs(words: number, pace: Pace): number {
	return words <= 0 ? 0 : (words / wordsPerMinute(pace)) * 60_000;
}

/** The local calendar date of a time (a Date or epoch milliseconds): `YYYY-MM-DD`. */
export function localDate(time: Date | number): string {
	const at = typeof time === 'number' ? new Date(time) : time;
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
