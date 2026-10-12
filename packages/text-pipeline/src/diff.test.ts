import { describe, expect, it } from 'vitest';
import { matchTokens, normaliseToken } from './diff';

const words = (s: string) => s.split(' ').filter(Boolean);

/** Brute-force LCS length, to check the diff finds a longest common subsequence. */
function lcs(a: string[], b: string[]): number {
	const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
	return t[0]![0]!;
}

describe('matchTokens (WordId carry-forward, §6.2)', () => {
	it('matches everything when nothing changed', () => {
		const a = words('alice was beginning to get very tired');
		expect(matchTokens(a, a)).toEqual(a.map((_, i) => [i, i]));
	});

	it('keeps unchanged Words around an edit, insertion and deletion', () => {
		const a = words('one two three four five six seven eight nine ten eleven twelve');
		const b = words('one two three FOUR five six seven eight nine ten eleven twelve thirteen');
		const pairs = matchTokens(a, b);
		expect(pairs.map(([i]) => a[i])).toEqual(
			words('one two three five six seven eight nine ten eleven twelve')
		);
		for (const [i, j] of pairs) expect(a[i]).toBe(b[j]);
	});

	it('finds a longest common subsequence (minRun 1) on random inputs', () => {
		let seed = 7;
		const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
		for (let round = 0; round < 50; round++) {
			const a = Array.from({ length: 30 }, () => 'abcde'[Math.floor(rand() * 5)]!);
			const b = Array.from({ length: 28 }, () => 'abcde'[Math.floor(rand() * 5)]!);
			const pairs = matchTokens(a, b, { minRun: 1 });
			expect(pairs).toHaveLength(lcs(a, b));
			for (let k = 1; k < pairs.length; k++) {
				expect(pairs[k]![0]).toBeGreaterThan(pairs[k - 1]![0]);
				expect(pairs[k]![1]).toBeGreaterThan(pairs[k - 1]![1]);
			}
		}
	});

	it('drops stray short matches inside rewritten text', () => {
		const a = words('start of it all and the old paragraph said one thing entirely end of it');
		const b = words('start of it all but a new text says the other thing instead end of it');
		const matched = matchTokens(a, b).map(([i]) => a[i]);
		expect(matched).toEqual(words('start of it all end of it'));
	});

	it('treats too many edits as a rewrite, still keeping the unchanged ends', () => {
		const a = ['x', ...Array.from({ length: 50 }, (_, i) => `a${i}`), 'y'];
		const b = ['x', ...Array.from({ length: 50 }, (_, i) => `b${i}`), 'y'];
		expect(matchTokens(a, b, { maxEdits: 10 })).toEqual([
			[0, 0],
			[51, 51]
		]);
	});

	it('normalises case and compatibility forms', () => {
		expect(normaliseToken('The')).toBe('the');
		expect(normaliseToken('ﬁne')).toBe('fine');
	});
});
