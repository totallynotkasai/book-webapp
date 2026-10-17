import { describe, expect, it } from 'vitest';
import {
	chaptersToCome,
	dueReleases,
	nextReleaseAt,
	releaseStates,
	scheduleBlocker,
	scheduleProblem,
	stuckReleases,
	type ReleaseLike
} from './releases';

const chapter = (chapterId: string, wordCount = 100, linear = true) => ({
	chapterId,
	wordCount,
	linear
});
/** A cover with no Words, then four Chapters. */
const CHAPTERS = [chapter('cover', 0), chapter('c1'), chapter('c2'), chapter('c3'), chapter('c4')];
const at = (day: number) => new Date(Date.UTC(2026, 9, day, 9)).toISOString();
const release = (chapterId: string, day: number, released = false): ReleaseLike => ({
	chapterId,
	releaseAt: at(day),
	releasedAt: released ? at(day) : null
});
const NOW = new Date(at(20));

describe('release states (P1-STU-06)', () => {
	it('leaves out Chapters without Words; a published Chapter with no release is out', () => {
		const states = releaseStates(CHAPTERS, [], new Set(['c1', 'c2', 'c3', 'c4']));
		expect(states.map((s) => s.chapterId)).toEqual(['c1', 'c2', 'c3', 'c4']);
		expect(states.every((s) => s.state === 'out')).toBe(true);
	});

	it('a new Chapter with no time comes out with its version, or with the scheduled one before it', () => {
		const states = releaseStates(CHAPTERS, [release('c3', 24)], new Set(['c1', 'c2']));
		expect(states.map((s) => s.state)).toEqual(['out', 'out', 'scheduled', 'scheduled']);
		expect(states[3]).toMatchObject({ at: new Date(at(24)), own: null });
		expect(releaseStates(CHAPTERS, [], new Set(['c1', 'c2']))[2]!.state).toBe('with_version');
	});

	it('never brings a Chapter out before the one ahead of it', () => {
		const states = releaseStates(
			CHAPTERS,
			[release('c3', 25), release('c4', 22)],
			new Set(['c1', 'c2', 'c3', 'c4'])
		);
		expect(states[3]).toMatchObject({ state: 'scheduled', at: new Date(at(25)) });
		expect(states[3]).toMatchObject({ own: new Date(at(22)) });
	});

	it('a released Chapter is out, whatever its time', () => {
		const states = releaseStates(CHAPTERS, [release('c4', 18, true)], new Set(['c1', 'c4']));
		expect(states[3]!.state).toBe('out');
	});

	it('tells what is still to come, what is due, and when the next comes out', () => {
		const all = new Set(['c1', 'c2', 'c3', 'c4']);
		const states = releaseStates(CHAPTERS, [release('c3', 19), release('c4', 23)], all);
		expect([...chaptersToCome(states, NOW).keys()]).toEqual(['c4']);
		expect(dueReleases(states, NOW)).toEqual([{ chapterId: 'c3', at: new Date(at(19)) }]);
		expect(nextReleaseAt(states, NOW)).toEqual(new Date(at(23)));
		expect(nextReleaseAt(releaseStates(CHAPTERS, [], all), NOW)).toBeNull();
	});
});

describe('scheduling a Chapter (P1-STU-06)', () => {
	const published = new Set(['c1', 'c2']);

	it('only a Chapter still to come, never the first, and none after one already out', () => {
		const states = releaseStates(CHAPTERS, [], published);
		expect(scheduleBlocker(states, 'c1')?.code).toBe('conflict');
		expect(scheduleBlocker(states, 'c2')?.code).toBe('conflict');
		expect(scheduleBlocker(states, 'nope')?.code).toBe('not_found');
		expect(scheduleBlocker(states, 'c3')).toBeNull();
		const first = releaseStates(CHAPTERS, [], new Set());
		expect(scheduleBlocker(first, 'c1')?.message).toMatch(/first chapter/);
		expect(scheduleBlocker(first, 'c2')).toBeNull();
		// c3 still to come, but c4 already out: c3 can't wait.
		const gap = releaseStates(CHAPTERS, [release('c4', 18, true)], published);
		expect(scheduleBlocker(gap, 'c3')?.code).toBe('conflict');
	});

	it('at a time in the future, in reading order', () => {
		const states = releaseStates(CHAPTERS, [release('c3', 24), release('c4', 26)], published);
		expect(scheduleProblem(states, 'c3', new Date(at(19)), NOW)?.code).toBe('invalid');
		expect(scheduleProblem(states, 'c3', new Date(at(25)), NOW)).toBeNull();
		// After c4's own time, or before c3 comes out: out of order.
		expect(scheduleProblem(states, 'c3', new Date(at(27)), NOW)?.message).toMatch(/c4.*earlier/);
		expect(scheduleProblem(states, 'c4', new Date(at(23)), NOW)?.message).toMatch(/c3.*or later/);
		// Now: only once the Chapter before it is out.
		expect(scheduleProblem(states, 'c4', 'now', NOW)?.code).toBe('invalid');
		expect(scheduleProblem(states, 'c3', 'now', NOW)).toBeNull();
		// No time of its own is always in order.
		expect(scheduleProblem(states, 'c4', null, NOW)).toBeNull();
	});

	it('finds a scheduled Chapter a new version would leave between Chapters already out', () => {
		// The new version puts c3 (scheduled) before c4, which readers already have.
		const states = releaseStates(CHAPTERS, [release('c3', 24)], new Set(['c1', 'c2', 'c4']));
		expect(stuckReleases(states)).toEqual(['c3']);
		expect(stuckReleases(releaseStates(CHAPTERS, [release('c4', 24)], published))).toEqual([]);
	});
});
