import type { SyncMap } from '@book/core';
import { describe, expect, it } from 'vitest';
import { coverageLabel, lastAtOrBefore, makeTiming, startOf, wordAt } from './narration-timing';

// A Chapter of six Words in two sentences; the recording says Word 13 before 12 (an aside), and
// Word 15 wasn't heard at all.
const text = {
	chapterId: 'ch1',
	firstOrdinal: 100,
	wordIds: [10, 11, 12, 13, 14, 15],
	texts: ['Alice', 'was', 'tired.', 'She', 'sat', 'down.'],
	blocks: [0, 0, 0, 0, 0, 0]
};
const map: SyncMap = {
	version: 1,
	trackId: 't',
	revisionId: 'r',
	chapterId: 'ch1',
	audioKey: 'a',
	durationMs: 5000,
	coverage: 5 / 6,
	words: [
		[10, 1000, 1300, 0],
		[11, 1300, 1500, 0],
		[13, 1500, 1800, 0],
		[12, 1800, 2200, 0],
		[14, 2400, 2700, 0]
	]
};

describe('narration timing (§8.3)', () => {
	const timing = makeTiming(map, text);

	it('finds the Word narrated at a time by binary search, nothing before the first', () => {
		expect(lastAtOrBefore([1, 3, 3, 7], 0)).toBe(-1);
		expect(lastAtOrBefore([1, 3, 3, 7], 3)).toBe(2);
		expect(lastAtOrBefore([1, 3, 3, 7], 99)).toBe(3);
		expect(wordAt(timing, 500).word).toBeNull();
		expect(wordAt(timing, 1350).word).toMatchObject({ wordId: 11, ordinal: 101, text: 'was' });
		// Audio order, not text order: Word 13 is heard first.
		expect(wordAt(timing, 1600).word?.wordId).toBe(13);
		// The last Word stays highlighted until the next starts.
		expect(wordAt(timing, 4000).word?.wordId).toBe(14);
	});

	it('gives each Word its sentence, as Ordinals and WordIds', () => {
		expect(wordAt(timing, 1000).word?.sentence).toEqual({
			first: 100,
			last: 102,
			firstWordId: 10,
			lastWordId: 12
		});
		expect(wordAt(timing, 2500).word?.sentence).toEqual({
			first: 103,
			last: 105,
			firstWordId: 13,
			lastWordId: 15
		});
	});

	it('finds when a Word starts, or the next one with a time', () => {
		expect(startOf(timing, 0)).toBe(1000);
		expect(startOf(timing, 2)).toBe(1800);
		expect(startOf(timing, 5)).toBeNull();
	});

	it('describes what the narration covers', () => {
		expect(
			coverageLabel([
				'CHAPTER I. Down the Rabbit-Hole',
				'CHAPTER II. The Pool of Tears',
				'CHAPTER III. A Caucus-Race'
			])
		).toBe('chapters 1–3');
		expect(coverageLabel(['Chapter 4', 'Chapter 1', 'Chapter 2', 'Chapter 9'])).toBe(
			'chapters 1–2, 4 and 9'
		);
		expect(coverageLabel(['CHAPTER XII. Alice’s Evidence'])).toBe('chapter 12');
		expect(coverageLabel(['Prologue', 'The Storm'])).toBe('“Prologue” and “The Storm”');
	});
});
