import { describe, expect, it } from 'vitest';
import {
	commentOrder,
	commentVisibleTo,
	oldestFirst,
	popularPassages,
	POPULAR_HIGHLIGHT_MIN_READERS,
	RevisionWordTexts,
	type ReaderHighlight
} from './index';

describe('paragraph comments (P1-COM-03)', () => {
	const comment = (
		id: string,
		userId: string,
		state: 'visible' | 'hidden' | 'deleted' = 'visible',
		createdAt = '2026-10-01T00:00:00.000Z',
		startOrdinal = 0,
		seq = 0
	) => ({ id, userId, state, createdAt, startOrdinal, seq });

	it('a hidden comment is seen only by its writer; a deleted one keeps its place for everyone', () => {
		expect(commentVisibleTo(comment('a', 'u1'), null)).toBe(true);
		expect(commentVisibleTo(comment('a', 'u1', 'hidden'), 'u2')).toBe(false);
		expect(commentVisibleTo(comment('a', 'u1', 'hidden'), null)).toBe(false);
		expect(commentVisibleTo(comment('a', 'u1', 'hidden'), 'u1')).toBe(true);
		expect(commentVisibleTo(comment('a', 'u1', 'deleted'), 'u2')).toBe(true);
	});

	it('are in reading order, then oldest first', () => {
		const list = [
			comment('c', 'u', 'visible', '2026-10-03T00:00:00.000Z', 40),
			comment('b', 'u', 'visible', '2026-10-02T00:00:00.000Z', 10),
			comment('a', 'u', 'visible', '2026-10-05T00:00:00.000Z', 10),
			comment('d', 'u', 'visible', '2026-10-01T00:00:00.000Z', 90)
		];
		expect([...list].sort(commentOrder).map((c) => c.id)).toEqual(['b', 'a', 'c', 'd']);
		expect([...list].sort(oldestFirst).map((c) => c.id)).toEqual(['d', 'b', 'c', 'a']);
	});

	it('written in the same instant, keep the order they were written in', () => {
		const at = '2026-10-01T00:00:00.000Z';
		const list = [comment('z', 'u', 'visible', at, 0, 2), comment('y', 'u', 'visible', at, 0, 1)];
		expect([...list].sort(oldestFirst).map((c) => c.id)).toEqual(['y', 'z']);
	});
});

describe('popular highlights (P1-COM-04)', () => {
	/** `n` readers named `${prefix}1…n`, each highlighting the same Words. */
	const readers = (
		prefix: string,
		n: number,
		startOrdinal: number,
		endOrdinal: number,
		chapterId = 'ch1'
	): ReaderHighlight[] =>
		Array.from({ length: n }, (_, i) => ({
			readerId: `${prefix}${i + 1}`,
			chapterId,
			startOrdinal,
			endOrdinal
		}));

	it('shows a passage only once enough different readers highlighted it (a placeholder minimum)', () => {
		expect(POPULAR_HIGHLIGHT_MIN_READERS).toBe(5);
		expect(popularPassages(readers('r', 4, 10, 20))).toEqual([]);
		expect(popularPassages(readers('r', 5, 10, 20))).toEqual([
			{ chapterId: 'ch1', startOrdinal: 10, endOrdinal: 20, readers: 5 }
		]);
	});

	it('counts a reader once, however many times they highlighted the same Words', () => {
		const one = readers('r', 1, 10, 20);
		expect(popularPassages([...one, ...one, ...one, ...one, ...one])).toEqual([]);
		expect(popularPassages([...readers('r', 4, 10, 20), ...one], 2)).toEqual([
			{ chapterId: 'ch1', startOrdinal: 10, endOrdinal: 20, readers: 4 }
		]);
	});

	it('joins overlapping highlights into one passage, counting every reader who touched it', () => {
		// 9 readers highlighted the whole sentence; 4 more only its second half.
		const passages = popularPassages([
			...readers('whole', 9, 100, 130),
			...readers('half', 4, 115, 130)
		]);
		expect(passages).toEqual([
			{ chapterId: 'ch1', startOrdinal: 100, endOrdinal: 130, readers: 13 }
		]);
	});

	it('keeps only the Words enough readers share when their highlights only overlap a little', () => {
		// 3 readers from 0 to 20 and 3 from 15 to 30: only 15–20 has 6.
		const passages = popularPassages([...readers('a', 3, 0, 20), ...readers('b', 3, 15, 30)]);
		expect(passages).toEqual([{ chapterId: 'ch1', startOrdinal: 15, endOrdinal: 20, readers: 6 }]);
	});

	it('never joins passages across Chapters, and lists them in reading order', () => {
		const passages = popularPassages([
			...readers('x', 6, 500, 510, 'ch2'),
			...readers('y', 5, 490, 499, 'ch1'),
			...readers('z', 7, 50, 60, 'ch1')
		]);
		expect(passages).toEqual([
			{ chapterId: 'ch1', startOrdinal: 50, endOrdinal: 60, readers: 7 },
			{ chapterId: 'ch1', startOrdinal: 490, endOrdinal: 499, readers: 5 },
			{ chapterId: 'ch2', startOrdinal: 500, endOrdinal: 510, readers: 6 }
		]);
	});

	it('never says who', () => {
		const [passage] = popularPassages(readers('secret-reader-', 8, 1, 3));
		expect(JSON.stringify(passage)).not.toContain('secret-reader');
	});
});

describe('finding a passage in the text (seeded comments and highlights)', () => {
	const text = new RevisionWordTexts('book', 'rev', [
		{
			chapterId: 'ch1',
			firstOrdinal: 0,
			wordIds: [1, 2, 3, 4, 5, 6],
			texts: ['Down', 'down', 'down', 'Would', 'the', 'fall']
		},
		{
			chapterId: 'ch2',
			firstOrdinal: 6,
			wordIds: [7, 8, 9, 10],
			texts: ['Down', 'down', 'Curiouser', 'and']
		}
	]);

	it('finds a passage in one Chapter', () => {
		expect(text.find('Down, down.', 'ch2')?.anchor).toMatchObject({
			startOrdinal: 6,
			endOrdinal: 7,
			startWordId: 7,
			endWordId: 8
		});
		expect(text.find('Down, down.')?.anchor.startOrdinal).toBe(0);
		expect(text.find('Curiouser', 'ch1')).toBeNull();
	});

	it('gives the Words between two Ordinals as an Anchor, within one Chapter', () => {
		const found = text.between(3, 5);
		expect(found?.chapterId).toBe('ch1');
		expect(found?.anchor).toMatchObject({
			revisionId: 'rev',
			startWordId: 4,
			endWordId: 6,
			quote: { exact: 'Would the fall' }
		});
		expect(text.between(4, 7)).toBeNull();
		expect(text.between(5, 99)).toBeNull();
	});
});
