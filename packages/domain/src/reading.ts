/**
 * Your reading (P1-RDR-14, P1-RDR-15; DESIGN.md §4.9): reading time left from the reader's own
 * pace, and the stats, daily streak and achievements in You → Your reading. Pure functions over
 * plain numbers and dates, kept on the device (nothing here ever reaches a Backend).
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

// ---- Stats, streaks and achievements (P1-RDR-15) ----

/** A day's reading of one Book, as stored (local date, `YYYY-MM-DD`). */
export interface ReadingDayLike {
	date: string;
	bookId: string;
	/** Time reading: on a page, in view, not idle. */
	readMs: number;
	/** Time listening: narration or the device voice playing. */
	listenedMs: number;
	/** Words passed reading on, or heard. */
	words: number;
}

/** A Book read to its end, as stored. */
export interface BookFinishLike {
	bookId: string;
	/** Local date. */
	date: string;
}

/** A day counts towards the streak after this much reading or listening (D-040). */
export const STREAK_DAY_MS = 5 * 60_000;

/** The local calendar date of a time (a Date or epoch milliseconds): `YYYY-MM-DD`. */
export function localDate(time: Date | number): string {
	const at = typeof time === 'number' ? new Date(time) : time;
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The local date `n` days after `date` (negative: before). */
export function addDays(date: string, n: number): string {
	const [y, m, d] = date.split('-').map(Number) as [number, number, number];
	return localDate(new Date(y, m - 1, d + n));
}

/** Time read and listened each day, every Book together. */
function totalsByDate(days: readonly ReadingDayLike[]): Map<string, ReadingDayLike> {
	const out = new Map<string, ReadingDayLike>();
	for (const day of days) {
		const total = out.get(day.date) ?? {
			date: day.date,
			bookId: '',
			readMs: 0,
			listenedMs: 0,
			words: 0
		};
		total.readMs += day.readMs;
		total.listenedMs += day.listenedMs;
		total.words += day.words;
		out.set(day.date, total);
	}
	return out;
}

const counts = (day: ReadingDayLike | undefined) =>
	!!day && day.readMs + day.listenedMs >= STREAK_DAY_MS;

/**
 * The daily streak: days in a row with at least `STREAK_DAY_MS` of reading or listening. The
 * current one runs to today, or to yesterday while today doesn't count yet (so it isn't lost
 * before the reader has had the chance to read today). A missed day starts it again.
 */
export function streaks(
	days: readonly ReadingDayLike[],
	today: string
): { current: number; longest: number } {
	const byDate = totalsByDate(days);
	let current = 0;
	let date = counts(byDate.get(today)) ? today : addDays(today, -1);
	while (counts(byDate.get(date))) {
		current++;
		date = addDays(date, -1);
	}
	let longest = 0;
	let run = 0;
	let previous: string | null = null;
	for (const day of [...byDate.keys()].sort()) {
		if (!counts(byDate.get(day))) continue;
		run = previous && addDays(previous, 1) === day ? run + 1 : 1;
		longest = Math.max(longest, run);
		previous = day;
	}
	return { current, longest: Math.max(longest, current) };
}

/** Reading and listening in the 7 days up to and including `today`. */
export function lastSevenDays(
	days: readonly ReadingDayLike[],
	today: string
): { ms: number; listenedMs: number; words: number } {
	const from = addDays(today, -6);
	let ms = 0;
	let listenedMs = 0;
	let words = 0;
	for (const day of days) {
		if (day.date < from || day.date > today) continue;
		ms += day.readMs + day.listenedMs;
		listenedMs += day.listenedMs;
		words += day.words;
	}
	return { ms, listenedMs, words };
}

export interface Achievement {
	id: string;
	title: string;
	description: string;
	/** The local date it was earned, or null. */
	earnedOn: string | null;
}

const HOUR = 60 * 60_000;

/**
 * A few quiet badges (D-040), worked out from the stats: never shown while reading, only in
 * You → Your reading.
 */
export function achievements(
	days: readonly ReadingDayLike[],
	finishes: readonly BookFinishLike[]
): Achievement[] {
	const byDate = [...totalsByDate(days).values()].sort((a, b) => a.date.localeCompare(b.date));
	/** The first date a running total reaches `target`. */
	const reached = (value: (d: ReadingDayLike) => number, target: number) => {
		let sum = 0;
		for (const day of byDate) {
			sum += value(day);
			if (sum >= target) return day.date;
		}
		return null;
	};
	const streakOf = (length: number) => {
		let run = 0;
		let previous: string | null = null;
		for (const day of byDate) {
			if (!counts(day)) continue;
			run = previous && addDays(previous, 1) === day.date ? run + 1 : 1;
			previous = day.date;
			if (run >= length) return day.date;
		}
		return null;
	};
	const finished = [...finishes].sort((a, b) => a.date.localeCompare(b.date));
	return [
		{
			id: 'first-book',
			title: 'First book finished',
			description: 'Read a book to its last page.',
			earnedOn: finished[0]?.date ?? null
		},
		{
			id: 'five-books',
			title: 'Five books finished',
			description: 'Read five books to their last page.',
			earnedOn: finished[4]?.date ?? null
		},
		{
			id: 'week-streak',
			title: 'A week in a row',
			description: 'Read on seven days in a row.',
			earnedOn: streakOf(7)
		},
		{
			id: 'month-streak',
			title: 'A month in a row',
			description: 'Read on thirty days in a row.',
			earnedOn: streakOf(30)
		},
		{
			id: 'ten-hours',
			title: 'Ten hours',
			description: 'Read or listen for ten hours in all.',
			earnedOn: reached((d) => d.readMs + d.listenedMs, 10 * HOUR)
		},
		{
			id: 'hundred-thousand-words',
			title: '100,000 words',
			description: 'About a novel’s worth.',
			earnedOn: reached((d) => d.words, 100_000)
		},
		{
			id: 'an-hour-listening',
			title: 'An hour of listening',
			description: 'Listen to narration or the device voice for an hour in all.',
			earnedOn: reached((d) => d.listenedMs, HOUR)
		}
	];
}
