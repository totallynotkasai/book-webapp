import { isInterpolated, parseSyncMap } from '@book/core';
import { describe, expect, it } from 'vitest';
import index from '../fixtures/sync/alice-word-index.json';
import ch01 from '../apps/web/static/demo/sync/alice/ch01.json';
import ch02 from '../apps/web/static/demo/sync/alice/ch02.json';

// SPIKE (P0-06): the demo Sync Maps the narration spike plays. Each must match DESIGN.md §7.2
// and time every Word of its chapter, by the WordIds the reader spike assigns.
describe('demo Sync Maps', () => {
	it.each([
		[1, ch01],
		[2, ch02]
	])('chapter %i is a valid Sync Map covering every Word', (chapter, json) => {
		const map = parseSyncMap(json);
		const section = index.chapters.find((c) => c.chapter === chapter)!;
		const ids = section.words.map(([id]) => Number(id));
		expect(new Set(map.words.map((w) => w[0]))).toEqual(new Set(ids));
		expect(map.coverage).toBeGreaterThanOrEqual(0.95);
		const interpolated = map.words.filter(isInterpolated).length;
		expect(1 - interpolated / map.words.length).toBeCloseTo(map.coverage, 3);
		expect(map.words.at(-1)![2]).toBeLessThanOrEqual(map.durationMs);
	});
});
