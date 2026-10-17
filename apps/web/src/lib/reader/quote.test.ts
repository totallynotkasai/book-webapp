import { describe, expect, it } from 'vitest';
import {
	attribution,
	QUOTE_MAX_WORDS,
	quoteAlt,
	quoteFileName,
	quoteOf,
	quoteText,
	wrapText
} from './quote';

const alice = { title: "Alice's Adventures in Wonderland", author: 'Lewis Carroll' };

/** Every Word of the passage, as the share counts them. */
const words = (text: string) => text.match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu) ?? [];

describe('quoteOf (P1-RDR-16)', () => {
	it('keeps a short selection exactly, spacing tidied', () => {
		expect(quoteOf('  “Curiouser\n and   curiouser!”  cried Alice ')).toEqual({
			text: '“Curiouser and curiouser!” cried Alice',
			shortened: false
		});
	});

	it(`keeps exactly ${QUOTE_MAX_WORDS} Words, and shortens the 61st away with an ellipsis`, () => {
		const sixty = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
		expect(quoteOf(`${sixty}.`)).toEqual({ text: `${sixty}.`, shortened: false });
		const long = quoteOf(`${sixty}, and more besides.`);
		expect(long.shortened).toBe(true);
		expect(long.text).toBe(`${sixty}…`);
		expect(words(long.text)).toHaveLength(60);
	});

	it('counts Words as the tokeniser does: an apostrophe joins, a hyphen or dash splits', () => {
		expect(quoteOf("Alice's Rabbit-Hole—down", 3)).toEqual({
			text: "Alice's Rabbit-Hole…",
			shortened: true
		});
	});

	it('leaves no dangling punctuation or opening quote before the ellipsis', () => {
		expect(quoteOf('one two, “three', 2).text).toBe('one two…');
		expect(quoteOf('one two — three', 2).text).toBe('one two…');
		expect(quoteOf('one two. Three', 2).text).toBe('one two…');
		expect(quoteOf('“One two?” Three', 2).text).toBe('“One two?” …');
	});
});

describe('the text card', () => {
	it('quotes the passage and says who wrote it and where', () => {
		expect(quoteText(quoteOf('So she was considering'), alice)).toBe(
			"“So she was considering”\n\n— Lewis Carroll, Alice's Adventures in Wonderland"
		);
	});

	it('keeps dialogue’s own quotation marks', () => {
		expect(quoteText(quoteOf('“Who are you?” said the Caterpillar.'), alice)).toMatch(
			/^“Who are you\?” said the Caterpillar\.\n/
		);
	});

	it('names the title alone when an imported Book has no author', () => {
		expect(attribution({ title: 'The Quay', author: ' ' })).toBe('The Quay');
	});
});

describe('the image card', () => {
	it('has alt text saying everything the picture does', () => {
		expect(quoteAlt(quoteOf('Curiouser and curiouser!'), alice)).toBe(
			"Quote from Alice's Adventures in Wonderland by Lewis Carroll: Curiouser and curiouser!"
		);
	});

	it('gets a file name from the title', () => {
		expect(quoteFileName(alice)).toBe('alices-adventures-in-wonderland-quote.png');
		expect(quoteFileName({ title: 'Ça va?', author: '' })).toBe('ca-va-quote.png');
		expect(quoteFileName({ title: '…', author: '' })).toBe('book-quote.png');
	});

	it('wraps at spaces, and breaks a Word too long for a line', () => {
		const measure = (s: string) => s.length * 10;
		expect(wrapText('the quick brown fox', 100, measure).map((l) => l.text)).toEqual([
			'the quick',
			'brown fox'
		]);
		const lines = wrapText('a supercalifragilistic b', 80, measure).map((l) => l.text);
		expect(lines).toEqual(['a', 'supercal', 'ifragili', 'stic b']);
		expect(wrapText('', 80, measure)).toEqual([]);
	});
});
