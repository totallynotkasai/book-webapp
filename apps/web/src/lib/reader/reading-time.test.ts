import type { PointAnchor, ReadingDay, Stores } from '@book/core';
import { DEFAULT_WORDS_PER_MINUTE, wordsPerMinute } from '@book/domain';
import type { VisibleRange } from '@book/reader-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The app leaving the screen (onHide), as the platform adapter reports it.
const hide = vi.hoisted(() => ({ callbacks: [] as (() => void)[] }));
vi.mock('$lib/platform', () => ({
	getPlatform: () => ({
		lifecycle: {
			onHide(callback: () => void) {
				hide.callbacks.push(callback);
				return () => {};
			}
		}
	})
}));

const { IDLE_MS, LISTEN_TAIL_MS, ReadingTime } = await import('./reading-time.svelte');

const MINUTE = 60_000;
const at = (ordinal: number): PointAnchor => ({
	kind: 'point',
	bookId: 'b',
	revisionId: 'r',
	wordId: ordinal + 1,
	ordinal,
	quote: { exact: 'x', prefix: '', suffix: '' }
});
const page = (first: number, cause: VisibleRange['cause'] = 'turn'): VisibleRange => ({
	chapterId: 'c1',
	first: at(first),
	last: at(first + 249),
	progression: first / 10_000,
	cause
});

describe('reading time in the reader (P1-RDR-14, P1-RDR-15)', () => {
	let now: number;
	let days: Omit<ReadingDay, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>[];
	let paces: { words: number; ms: number }[];
	let finishes: string[];
	let options: { learnPace: boolean; keepStats: boolean; listening: boolean };

	function tracker() {
		const stores = {
			readingStats: {
				addToDay: async (entry: (typeof days)[number]) => {
					days.push(entry);
					return entry;
				},
				savePace: async (pace: { words: number; ms: number }) => {
					paces.push(pace);
					return pace;
				},
				finish: async (bookId: string) => {
					finishes.push(bookId);
					return { bookId };
				}
			}
		} as unknown as Stores;
		return new ReadingTime({
			stores,
			bookId: 'b',
			learnPace: () => options.learnPace,
			keepStats: () => options.keepStats,
			listening: () => options.listening,
			now: () => now
		});
	}

	const total = (key: 'readMs' | 'listenedMs' | 'words') =>
		days.reduce((sum, d) => sum + d[key], 0);

	beforeEach(() => {
		vi.useFakeTimers();
		now = 0;
		days = [];
		paces = [];
		finishes = [];
		hide.callbacks = [];
		options = { learnPace: true, keepStats: true, listening: false };
	});
	afterEach(() => vi.useRealTimers());

	it('learns the pace from pages the reader turned at a reading pace, skims and pauses left out', async () => {
		const time = tracker();
		time.relocated(page(0, 'navigation'), false);
		// 250 Words a page at 125 Words a minute: two minutes a page.
		for (let i = 1; i <= 20; i++) {
			now += 2 * MINUTE;
			time.relocated(page(i * 250), false);
		}
		const learnt = wordsPerMinute(time.pace);
		expect(Math.abs(learnt - 125) / 125).toBeLessThan(0.1);
		// A skim (two seconds) and an auto-turn teach nothing.
		now += 2_000;
		time.relocated(page(21 * 250), false);
		now += MINUTE;
		time.relocated(page(22 * 250), true);
		expect(wordsPerMinute(time.pace)).toBeCloseTo(learnt, 6);
		await time.close();
		expect(paces.at(-1)).toEqual(time.pace);
		expect(total('words')).toBe(22 * 250);
	});

	it('stops counting reading time when the reader has done nothing for a while', async () => {
		const time = tracker();
		time.relocated(page(0), false);
		now += IDLE_MS + 20 * MINUTE;
		time.relocated(page(250), false);
		await time.close();
		expect(total('readMs')).toBe(IDLE_MS);
		// A page "read" in 25 minutes is a pause: the pace is the default still.
		expect(wordsPerMinute(time.pace)).toBeCloseTo(DEFAULT_WORDS_PER_MINUTE, 6);
	});

	it('counts listening with the screen off, in full while it still plays', async () => {
		const time = tracker();
		options.listening = true;
		time.relocated(page(0), false);
		now += 20 * MINUTE;
		time.relocated(page(250), true);
		// Stopped at some point in the next 30 minutes: only its first two count.
		options.listening = false;
		now += 30 * MINUTE;
		time.activity();
		await time.close();
		expect(total('listenedMs')).toBe(20 * MINUTE + LISTEN_TAIL_MS);
		expect(total('readMs')).toBe(0);
		// Words heard count; the pace learns nothing from narration.
		expect(total('words')).toBe(250);
		expect(paces).toEqual([]);
	});

	it('doesn’t count time while the app is hidden', async () => {
		const time = tracker();
		time.relocated(page(0), false);
		now += MINUTE;
		for (const callback of hide.callbacks) callback();
		now += 10 * MINUTE;
		time.activity();
		await time.close();
		expect(total('readMs')).toBe(MINUTE);
	});

	it('with stats off keeps nothing; with time left off learns no pace', async () => {
		options.keepStats = false;
		options.learnPace = false;
		const time = tracker();
		time.relocated(page(0), false);
		now += MINUTE;
		time.relocated(page(250), false);
		time.finished();
		await time.close();
		expect(days).toEqual([]);
		expect(paces).toEqual([]);
		expect(finishes).toEqual([]);
		expect(wordsPerMinute(time.pace)).toBeCloseTo(DEFAULT_WORDS_PER_MINUTE, 6);
	});

	it('finishes a Book once', async () => {
		const time = tracker();
		time.finished();
		time.finished();
		await time.close();
		expect(finishes).toEqual(['b']);
	});
});
