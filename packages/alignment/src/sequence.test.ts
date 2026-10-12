import { describe, expect, it } from 'vitest';
import { alignSequences, type AlignedPair } from './sequence';

const split = (s: string) => s.split(' ').filter(Boolean);
/** Pairs as "a-range→b-range:kind" for compact assertions. */
const show = (pairs: AlignedPair[]) =>
	pairs.map((p) => `${p.aStart}-${p.aEnd}→${p.bStart}-${p.bEnd}:${p.kind}`);

/** A small deterministic PRNG (mulberry32) so property-style tests are repeatable. */
function random(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const VOCAB = split(
	'alice was beginning to get very tired of sitting by her sister on the bank and having nothing do once or twice she had peeped into book reading but it no pictures conversations in what is use a thought without'
);

/** A text, and a "transcript" of it with words dropped, inserted, and misheard. */
function noisy(seed: number, length: number) {
	const rnd = random(seed);
	const text = Array.from({ length }, () => VOCAB[Math.floor(rnd() * VOCAB.length)]!);
	const heard: string[] = [];
	for (const word of text) {
		const r = rnd();
		if (r < 0.03) continue; // dropped
		if (r < 0.06)
			heard.push(VOCAB[Math.floor(rnd() * VOCAB.length)]!); // misheard
		else heard.push(word);
		if (rnd() < 0.03) heard.push('um'); // inserted
	}
	return { text, heard };
}

describe('alignSequences', () => {
	it('matches identical sequences one to one', () => {
		const words = split('alice was beginning to get very tired');
		const result = alignSequences(words, words);
		expect(result.pairs).toHaveLength(words.length);
		expect(
			result.pairs.every((p, i) => p.aStart === i && p.bStart === i && p.kind === 'exact')
		).toBe(true);
	});

	it('handles empty input', () => {
		expect(alignSequences([], split('a b')).pairs).toEqual([]);
		expect(alignSequences(split('a b'), []).pairs).toEqual([]);
	});

	it('lets transcript words before and after the text go unmatched for free', () => {
		const text = split('alice was beginning to get very tired');
		const heard = split(
			'chapter one of alices adventures this is a librivox recording alice was beginning to get very tired end of chapter one'
		);
		const result = alignSequences(text, heard);
		expect(result.pairs.map((p) => heard[p.bStart])).toEqual(text);
		expect(result.pairs.every((p) => p.kind === 'exact')).toBe(true);
	});

	it('keeps a skipped phrase together as one gap', () => {
		const text = split(
			'she had peeped into the book her sister was reading but it had no pictures'
		);
		const heard = split('she had peeped into the book but it had no pictures');
		const result = alignSequences(text, heard);
		expect(result.pairs.every((p) => p.kind === 'exact')).toBe(true);
		expect(result.pairs.map((p) => p.aStart)).toEqual([0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14]);
	});

	it('marks fuzzy matches and substitutions', () => {
		const result = alignSequences(
			split('thought alice without pictures'),
			split('thought alis within pictures')
		);
		expect(result.pairs.map((p) => p.kind)).toEqual(['exact', 'fuzzy', 'mismatch', 'exact']);
	});

	it('merges a compound written as one word on one side and two on the other', () => {
		expect(show(alignSequences(split('to day is fine'), split('today is fine')).pairs)).toEqual([
			'0-2→0-1:merge',
			'2-3→1-2:exact',
			'3-4→2-3:exact'
		]);
		expect(show(alignSequences(split('anyone else'), split('any one else')).pairs)).toEqual([
			'0-1→0-2:merge',
			'1-2→2-3:exact'
		]);
	});

	it('widens the band when the path runs into its edge', () => {
		const text = Array.from({ length: 400 }, (_, i) => `w${i}`);
		// 150 extra words in the middle push the path far off the diagonal.
		const heard = [
			...text.slice(0, 200),
			...Array.from({ length: 150 }, (_, i) => `x${i}`),
			...text.slice(200)
		];
		const narrow = alignSequences(text, heard, { band: 8 });
		const full = alignSequences(text, heard, { band: 10_000 });
		expect(narrow.band).toBeGreaterThan(8);
		expect(narrow.score).toBe(full.score);
		expect(narrow.pairs).toEqual(full.pairs);
		expect(narrow.pairs.filter((p) => p.kind === 'exact')).toHaveLength(400);
	});

	it('gives the same alignment banded as with the full matrix', () => {
		for (let seed = 1; seed <= 20; seed++) {
			const { text, heard } = noisy(seed, 300);
			const banded = alignSequences(text, heard, { band: 32 });
			const full = alignSequences(text, heard, { band: 10_000 });
			expect(banded.score, `seed ${seed}`).toBe(full.score);
			expect(banded.pairs, `seed ${seed}`).toEqual(full.pairs);
		}
	});

	it('aligns a chapter-sized pair quickly in bounded memory', () => {
		const { text, heard } = noisy(99, 2500);
		const started = performance.now();
		const result = alignSequences(text, heard);
		const elapsed = performance.now() - started;
		// The band keeps the work well under the 6.25 M cells of the full matrix.
		expect(result.cells).toBeLessThan(2500 * 401 + 1000);
		expect(elapsed).toBeLessThan(2000);
		const matched = result.pairs.filter((p) => p.kind !== 'mismatch').length;
		expect(matched / text.length).toBeGreaterThan(0.9);
	});
});
