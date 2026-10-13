import { describe, expect, it } from 'vitest';
import { sentenceAt, sentenceSpans } from './index';

/** Words of one Block, split on spaces, as the reader's word index gives them. */
function spans(text: string, blocks?: number[]) {
	const words = text.split(' ');
	return sentenceSpans(words, blocks ?? words.map(() => 0)).map(([a, b]) =>
		words.slice(a, b + 1).join(' ')
	);
}

describe('sentences (narration, §8.3)', () => {
	it('splits after full stops, question and exclamation marks before a new sentence', () => {
		expect(spans('Alice was tired. Was she? She was! So… Then what')).toEqual([
			'Alice was tired.',
			'Was she?',
			'She was!',
			'So…',
			'Then what'
		]);
	});

	it('keeps speech followed by its speaker in one sentence', () => {
		expect(spans('“Well!” thought Alice to herself. “After such a fall…”')).toEqual([
			'“Well!” thought Alice to herself.',
			'“After such a fall…”'
		]);
	});

	it('never ends a sentence at an abbreviation or an initial', () => {
		expect(spans('Mr. Dodgson and J. Tenniel, e.g. Tuesday. Then')).toEqual([
			'Mr. Dodgson and J. Tenniel, e.g. Tuesday.',
			'Then'
		]);
	});

	it('ends a sentence at the end of every Block, punctuated or not', () => {
		expect(spans('CHAPTER I Down the Rabbit-Hole Alice was', [0, 0, 1, 1, 1, 2, 2])).toEqual([
			'CHAPTER I',
			'Down the Rabbit-Hole',
			'Alice was'
		]);
	});

	it('covers every Word, in order, and finds the sentence holding a Word', () => {
		const words = 'One. Two three. Four'.split(' ');
		const s = sentenceSpans(
			words,
			words.map(() => 0)
		);
		expect(s).toEqual([
			[0, 0],
			[1, 2],
			[3, 3]
		]);
		expect([0, 1, 2, 3].map((i) => sentenceAt(s, i))).toEqual([0, 1, 1, 2]);
		expect(sentenceAt(s, 9)).toBe(-1);
		expect(sentenceSpans([], [])).toEqual([]);
	});
});
