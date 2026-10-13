import { describe, expect, it } from 'vitest';
import type { SyncMapWord } from '@book/core';
import {
	addSplits,
	coverageOf,
	earlyAccessFreeAt,
	layerPublishProblems,
	lowConfidenceRegions,
	money,
	PLACEHOLDER_SPLITS,
	publishProblems,
	revisionChanges,
	slugFor,
	splitRevenue,
	syncMapProblems,
	syncMapStatus
} from './index';

const gbp = (n: number) => money(n, 'GBP');

describe('revision changes (§6.2, P1-STU-01)', () => {
	const before = [
		{ chapterId: 'c1', wordIds: [1, 2, 3] },
		{ chapterId: 'c2', wordIds: [4, 5, 6] },
		{ chapterId: 'c3', wordIds: [7, 8] }
	];

	it('finds nothing changed in the same Revision', () => {
		expect(revisionChanges(before, before)).toEqual({
			changedChapterIds: [],
			addedChapterIds: [],
			removedChapterIds: [],
			wordsAdded: 0,
			wordsRemoved: 0
		});
	});

	it('marks a Chapter changed when a Word is replaced, and counts Words both ways', () => {
		const after = [before[0]!, { chapterId: 'c2', wordIds: [4, 9, 10, 6] }, before[2]!];
		expect(revisionChanges(before, after)).toMatchObject({
			changedChapterIds: ['c2'],
			wordsAdded: 2,
			wordsRemoved: 1
		});
	});

	it('lists added and removed Chapters separately from changed ones', () => {
		const after = [before[0]!, before[1]!, { chapterId: 'c4', wordIds: [11, 12] }];
		expect(revisionChanges(before, after)).toMatchObject({
			changedChapterIds: [],
			addedChapterIds: ['c4'],
			removedChapterIds: ['c3'],
			wordsAdded: 2,
			wordsRemoved: 2
		});
	});
});

describe('publishing (P1-STU-02, P1-LAY-05)', () => {
	it('blocks a Revision until the AI question is answered, and until it is processed', () => {
		expect(publishProblems({ state: 'ready', aiUse: null })).toEqual([
			'Answer “Was AI used to make this?” first.'
		]);
		expect(publishProblems({ state: 'ready', aiUse: 'none' })).toEqual([]);
		expect(publishProblems({ state: 'processing', aiUse: 'none' })).toHaveLength(1);
	});

	it('blocks a pack while any Illustration lacks alt text', () => {
		const pack = {
			aiUse: 'none' as const,
			items: 3,
			itemName: { one: 'picture', many: 'pictures' }
		};
		expect(layerPublishProblems({ ...pack, missingAlt: 0 })).toEqual([]);
		expect(layerPublishProblems({ ...pack, missingAlt: 1 })[0]).toMatch(
			/^1 picture needs alt text/
		);
		expect(layerPublishProblems({ ...pack, missingAlt: 2 })[0]).toMatch(
			/^2 pictures need alt text/
		);
		expect(layerPublishProblems({ ...pack, items: 0 })).toEqual([
			'Add at least one picture first.'
		]);
	});
});

describe('store addresses', () => {
	it('come from the title, unique', () => {
		const taken = new Set(['my-book']);
		expect(slugFor('Crème Brûlée’s Ledger!', () => false)).toBe('creme-brulees-ledger');
		expect(slugFor('My Book', (s) => taken.has(s))).toBe('my-book-2');
		expect(slugFor('???', () => false)).toBe('book');
	});
});

describe('early access (SIMULATION, OPEN-10)', () => {
	it('ends 30 days after a publish', () => {
		expect(earlyAccessFreeAt('2026-10-01T00:00:00.000Z')).toBe('2026-10-31T00:00:00.000Z');
	});
});

describe('revenue splits (SIMULATION, OPEN-08, P1-STU-04)', () => {
	it('come from one placeholder config, each described', () => {
		for (const rule of Object.values(PLACEHOLDER_SPLITS)) expect(rule.note).toMatch(/placeholder/);
	});

	it('always add up to the gross, rounding the platform and author down', () => {
		const split = splitRevenue(gbp(249), 'community_sale');
		expect(split.platform).toEqual(gbp(24));
		expect(split.author).toEqual(gbp(37));
		expect(split.creator).toEqual(gbp(188));
		for (const gross of [0, 1, 99, 100, 101, 12345]) {
			for (const kind of ['sale', 'community_sale', 'tip', 'subscription'] as const) {
				const s = splitRevenue(gbp(gross), kind);
				expect(s.platform.amountMinor + s.author.amountMinor + s.creator.amountMinor).toBe(gross);
			}
		}
	});

	it('adds up splits, refusing mixed currencies', () => {
		const total = addSplits([splitRevenue(gbp(100), 'sale'), splitRevenue(gbp(300), 'tip')], 'GBP');
		expect(total.gross).toEqual(gbp(400));
		expect(total.platform).toEqual(gbp(25));
		expect(() => addSplits([splitRevenue(money(100, 'EUR'), 'sale')], 'GBP')).toThrow(RangeError);
	});
});

describe('narration review (§7.2, P1-STU-03)', () => {
	const heard = (id: number, ms: number): SyncMapWord => [id, ms, ms + 300, 0];
	const guessed = (id: number, ms: number): SyncMapWord => [id, ms, ms + 300, 1];

	it('needs review below 0.90 coverage, at and above it is ready, and stale wins', () => {
		expect(syncMapStatus(0.89, false)).toBe('needs_review');
		expect(syncMapStatus(0.9, false)).toBe('ready');
		expect(syncMapStatus(0.99, false)).toBe('ready');
		expect(syncMapStatus(0.99, true)).toBe('stale');
	});

	it('recomputes coverage from the Words heard, counting Words the map leaves out', () => {
		const words = [heard(1, 0), guessed(2, 300), heard(3, 600)];
		expect(coverageOf(words, 3)).toBeCloseTo(2 / 3);
		expect(coverageOf(words, 4)).toBe(0.5);
		expect(coverageOf([], 0)).toBe(1);
	});

	it('groups guessed Words into regions, merging ones a couple of Words apart', () => {
		const words = [
			heard(1, 0),
			guessed(2, 300),
			guessed(3, 600),
			heard(4, 900),
			guessed(5, 1200),
			heard(6, 1500),
			heard(7, 1800),
			heard(8, 2100),
			heard(9, 2400),
			guessed(10, 2700)
		];
		expect(lowConfidenceRegions(words)).toEqual([
			{
				index: 0,
				from: 1,
				to: 4,
				startMs: 300,
				endMs: 1500,
				firstWordId: 2,
				lastWordId: 5,
				wordCount: 3
			},
			{
				index: 1,
				from: 9,
				to: 9,
				startMs: 2700,
				endMs: 3000,
				firstWordId: 10,
				lastWordId: 10,
				wordCount: 1
			}
		]);
		expect(lowConfidenceRegions(words.filter((w) => w[3] === 0))).toEqual([]);
	});

	it('accepts a Sync Map only for its own Revision, Chapter and Words', () => {
		const chapter = { revisionId: 'r1', chapterId: 'c1', wordIds: new Set([1, 2, 3]) };
		const map = { revisionId: 'r1', chapterId: 'c1', words: [heard(1, 0), heard(2, 300)] };
		expect(syncMapProblems(map, chapter)).toEqual([]);
		expect(syncMapProblems({ ...map, revisionId: 'r0' }, chapter)[0]).toMatch(/another version/);
		expect(syncMapProblems({ ...map, chapterId: 'c2' }, chapter)[0]).toMatch(/another chapter/);
		expect(syncMapProblems({ ...map, words: [heard(9, 0)] }, chapter)).toEqual([
			'1 word in it isn’t in this chapter.'
		]);
	});
});
