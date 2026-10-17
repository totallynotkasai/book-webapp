import { describe, expect, it } from 'vitest';
import {
	DEFAULT_WORDS_PER_MINUTE,
	defaultPace,
	isReadingPace,
	localDate,
	timeLeftMs,
	withPage,
	wordsPerMinute
} from './reading';
import {
	achievements,
	addDays,
	lastSevenDays,
	streaks,
	type ReadingDayLike
} from './reading-stats';

const MINUTE = 60_000;

/** A scripted reader: pages of `words` at `wpm`, with a pause and a skim along the way. */
function read(pages: number, words: number, wpm: number) {
	let pace = defaultPace();
	for (let i = 0; i < pages; i++) {
		pace = withPage(pace, words, (words / wpm) * MINUTE);
		if (i === 3) pace = withPage(pace, words, 20 * MINUTE); // put down to make tea
		if (i === 5) pace = withPage(pace, words, 1_500); // flicked past
	}
	return pace;
}

describe('pace and time left (P1-RDR-14)', () => {
	it('starts from the stated default pace', () => {
		expect(wordsPerMinute(defaultPace())).toBeCloseTo(DEFAULT_WORDS_PER_MINUTE, 6);
		expect(timeLeftMs(DEFAULT_WORDS_PER_MINUTE * 8, defaultPace())).toBeCloseTo(8 * MINUTE, 0);
		expect(timeLeftMs(0, defaultPace())).toBe(0);
	});

	it.each([120, 180, 300, 450])(
		'converges on a scripted reader at %i words a minute to within a tenth in ten minutes',
		(wpm) => {
			// Pages of 250 Words for ten minutes of reading.
			const pages = Math.ceil((10 * wpm) / 250);
			expect(Math.abs(wordsPerMinute(read(pages, 250, wpm)) - wpm) / wpm).toBeLessThan(0.1);
		}
	);

	it('ignores pauses and skims', () => {
		expect(isReadingPace(250, 20 * MINUTE)).toBe(false);
		expect(isReadingPace(250, 1_500)).toBe(false);
		expect(isReadingPace(250, MINUTE)).toBe(true);
		expect(isReadingPace(0, MINUTE)).toBe(false);
		const pace = defaultPace();
		expect(withPage(pace, 250, 20 * MINUTE)).toBe(pace);
	});

	it('follows a reader whose pace changes', () => {
		let pace = read(40, 250, 300);
		for (let i = 0; i < 40; i++) pace = withPage(pace, 250, (250 / 150) * MINUTE);
		expect(Math.abs(wordsPerMinute(pace) - 150) / 150).toBeLessThan(0.1);
	});
});

const day = (
	date: string,
	minutes: number,
	extra: Partial<ReadingDayLike> = {}
): ReadingDayLike => ({
	date,
	bookId: 'book',
	readMs: minutes * MINUTE,
	listenedMs: 0,
	words: minutes * 200,
	...extra
});

describe('stats, streaks and achievements (P1-RDR-15)', () => {
	it('local dates and their arithmetic cross months and years', () => {
		expect(localDate(new Date(2026, 9, 7, 23, 59))).toBe('2026-10-07');
		expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
		expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
	});

	it('a day counts after 5 minutes, any Books together, listening too', () => {
		const days = [
			day('2026-10-15', 3),
			day('2026-10-15', 2, { bookId: 'other' }),
			day('2026-10-16', 0, { listenedMs: 6 * MINUTE }),
			day('2026-10-17', 4)
		];
		// Today (the 17th) doesn't count yet, so the streak runs to yesterday.
		expect(streaks(days, '2026-10-17')).toEqual({ current: 2, longest: 2 });
		expect(streaks([...days, day('2026-10-17', 1)], '2026-10-17').current).toBe(3);
		// A missed day starts it again.
		expect(streaks(days, '2026-10-19')).toEqual({ current: 0, longest: 2 });
	});

	it('the last seven days include today', () => {
		const days = [day('2026-10-10', 30), day('2026-10-11', 10), day('2026-10-17', 20)];
		expect(lastSevenDays(days, '2026-10-17')).toEqual({
			ms: 30 * MINUTE,
			listenedMs: 0,
			words: 6000
		});
	});

	it('earns each achievement on the day it was reached', () => {
		const week = Array.from({ length: 7 }, (_, i) =>
			day(addDays('2026-10-01', i), 90, { words: 1000 })
		);
		const earned = new Map(
			achievements(
				[...week, day('2026-10-09', 0, { listenedMs: 61 * MINUTE })],
				[{ bookId: 'book', date: '2026-10-05' }]
			).map((a) => [a.id, a.earnedOn])
		);
		expect(earned.get('first-book')).toBe('2026-10-05');
		expect(earned.get('five-books')).toBeNull();
		expect(earned.get('week-streak')).toBe('2026-10-07');
		expect(earned.get('month-streak')).toBeNull();
		// 90 minutes a day: ten hours on the seventh day.
		expect(earned.get('ten-hours')).toBe('2026-10-07');
		expect(earned.get('hundred-thousand-words')).toBeNull();
		expect(earned.get('an-hour-listening')).toBe('2026-10-09');
		expect(achievements([], []).every((a) => a.earnedOn === null)).toBe(true);
	});
});
