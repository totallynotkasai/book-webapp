import { describe, expect, it } from 'vitest';
import type { ChapterText } from '@book/reader-core';
import {
	bareWord,
	findInChapter,
	foldWord,
	queryWords,
	searchChapter,
	SearchIndex
} from './search';

function chapter(texts: string[], blocks?: number[]): ChapterText {
	return {
		chapterId: 'c1',
		firstOrdinal: 1000,
		wordIds: texts.map((_, i) => 5000 + i),
		texts,
		blocks: blocks ?? texts.map(() => 0)
	};
}

describe('folding (P1-RDR-10)', () => {
	it('ignores case and accents, and the punctuation around a Word', () => {
		expect(foldWord('Café')).toBe('cafe');
		expect(foldWord('NAÏVE')).toBe('naive');
		expect(bareWord('“Well!”')).toBe('well');
		expect(bareWord('Alice’s')).toBe("alice's");
		expect(queryWords('  Cheshire-Cat ')).toEqual(['cheshire', 'cat']);
		expect(queryWords('don’t')).toEqual(["don't"]);
		expect(queryWords('“Off with”')).toEqual(['off', 'with']);
		expect(queryWords('—')).toEqual([]);
	});
});

describe('findInChapter', () => {
	const alice = searchChapter(
		chapter(
			[
				'Would',
				'the',
				'fall',
				'never',
				'come',
				'to',
				'an',
				'end?', // block 0
				'“It’s',
				'a',
				'friend',
				'of',
				'mine—a',
				'Cheshire',
				'Cat,”',
				'said',
				'Alice.', // block 1
				'The',
				'CHESHIRE',
				'cat',
				'grinned',
				'at',
				'Alice’s',
				'café.' // block 2
			],
			[0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2]
		)
	);

	it('finds a Word wherever it is, whatever its case', () => {
		const hits = findInChapter(alice, queryWords('cheshire'));
		expect(hits.map((h) => h.match)).toEqual(['Cheshire', 'CHESHIRE']);
		expect(hits[0]).toMatchObject({ first: 13, startOrdinal: 1013, startWordId: 5013 });
	});

	it('finds a phrase across Words, which may come from different markup', () => {
		const [hit] = findInChapter(alice, queryWords('fall never come'));
		expect(hit).toMatchObject({ first: 2, last: 4, endOrdinal: 1004, endWordId: 5004 });
		expect(hit!.match).toBe('fall never come');
	});

	it('matches possessives and, for the last Word, the start of a Word', () => {
		expect(findInChapter(alice, queryWords('alice grinned'))).toHaveLength(0);
		expect(findInChapter(alice, queryWords('alice')).map((h) => h.match)).toEqual([
			'Alice.',
			'Alice’s'
		]);
		expect(findInChapter(alice, queryWords('chesh')).length).toBe(2);
		expect(findInChapter(alice, queryWords('alice cafe')).map((h) => h.match)).toEqual([
			'Alice’s café.'
		]);
		expect(findInChapter(alice, queryWords('cafe'))).toHaveLength(1);
	});

	it('shows a line of context from the same paragraph, cut with an ellipsis', () => {
		const [hit] = findInChapter(alice, queryWords('cheshire cat'));
		expect(hit!.before).toBe('“It’s a friend of mine—a ');
		// A hyphen or dash joins Words on the page, so it does in the context too.
		const rabbit = searchChapter(chapter(['Down', 'the', 'Rabbit-', 'Hole']));
		expect(findInChapter(rabbit, ['hole'])[0]!.before).toBe('Down the Rabbit-');
		expect(findInChapter(rabbit, ['rabbit'])[0]!.after).toBe('Hole');
		expect(hit!.match).toBe('Cheshire Cat,”');
		expect(hit!.after).toBe(' said Alice.');
		const long = searchChapter(chapter(Array.from({ length: 40 }, (_, i) => `w${i}`)));
		const [middle] = findInChapter(long, ['w20']);
		expect(middle!.before).toBe('… w13 w14 w15 w16 w17 w18 w19 ');
		expect(middle!.after).toBe(' w21 w22 w23 w24 w25 w26 w27 …');
	});

	it('finds nothing for an empty query', () => {
		expect(findInChapter(alice, [])).toEqual([]);
	});

	it('searches a 150 000-Word Book in well under the interaction budget (§12.3)', () => {
		const vocabulary = ['the', 'cat', 'sat', 'on', 'mat', 'and', 'grinned', 'Cheshire', 'alice'];
		const chapters = Array.from({ length: 30 }, (_, c) =>
			searchChapter({
				chapterId: `c${c}`,
				firstOrdinal: c * 5000,
				wordIds: Array.from({ length: 5000 }, (_, i) => c * 5000 + i),
				texts: Array.from({ length: 5000 }, (_, i) => vocabulary[(i * 7 + c) % vocabulary.length]!),
				blocks: Array.from({ length: 5000 }, (_, i) => Math.floor(i / 80))
			})
		);
		const started = performance.now();
		let total = 0;
		for (const query of ['cheshire', 'the cat', 'grinned alice', 'zebra']) {
			for (const c of chapters) total += findInChapter(c, queryWords(query)).length;
		}
		const elapsed = performance.now() - started;
		expect(total).toBeGreaterThan(0);
		// Four searches of 150 000 Words; each well inside a 100 ms frame budget.
		expect(elapsed / 4).toBeLessThan(100);
	});
});

describe('SearchIndex', () => {
	it('readies each Chapter once, and again after a failure', async () => {
		let loads = 0;
		let fail = true;
		const index = new SearchIndex(async () => {
			loads++;
			if (fail) throw new Error('offline');
			return chapter(['Alice']);
		});
		await expect(index.chapter('c1')).rejects.toThrow('offline');
		fail = false;
		const [a, b] = await Promise.all([index.chapter('c1'), index.chapter('c1')]);
		expect(a).toBe(b);
		expect(a.words).toEqual(['alice']);
		expect(loads).toBe(2);
	});
});
