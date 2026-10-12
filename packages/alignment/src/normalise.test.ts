import { describe, expect, it } from 'vitest';
import { normaliseWord, numberToWords, romanToNumber, tokenise } from './normalise';
import { editDistance, isFuzzyMatch } from './similarity';

describe('numberToWords', () => {
	it('spells out whole numbers', () => {
		expect(numberToWords(0)).toEqual(['zero']);
		expect(numberToWords(7)).toEqual(['seven']);
		expect(numberToWords(42)).toEqual(['forty', 'two']);
		expect(numberToWords(90)).toEqual(['ninety']);
		expect(numberToWords(105)).toEqual(['one', 'hundred', 'five']);
		expect(numberToWords(1865)).toEqual(['one', 'thousand', 'eight', 'hundred', 'sixty', 'five']);
		expect(numberToWords(4_000_000)).toEqual(['four', 'million']);
	});

	it('rejects what it cannot spell', () => {
		expect(() => numberToWords(-1)).toThrow(RangeError);
		expect(() => numberToWords(1.5)).toThrow(RangeError);
	});
});

describe('romanToNumber', () => {
	it('reads well-formed numerals only', () => {
		expect(romanToNumber('I')).toBe(1);
		expect(romanToNumber('iv')).toBe(4);
		expect(romanToNumber('XII')).toBe(12);
		expect(romanToNumber('MCMLXXXIV')).toBe(1984);
		expect(romanToNumber('IIII')).toBeUndefined();
		expect(romanToNumber('alice')).toBeUndefined();
	});
});

describe('normaliseWord', () => {
	it('lowercases and strips punctuation', () => {
		expect(normaliseWord('Alice,')).toEqual(['alice']);
		expect(normaliseWord('“Oh!')).toEqual(['oh']);
		expect(normaliseWord('...')).toEqual([]);
	});

	it('collapses contractions and possessives, whatever the apostrophe', () => {
		expect(normaliseWord("didn't")).toEqual(['didnt']);
		expect(normaliseWord('didn’t')).toEqual(['didnt']);
		expect(normaliseWord('Alice’s')).toEqual(['alices']);
		expect(normaliseWord("o'clock")).toEqual(['oclock']);
	});

	it('splits hyphenated words into parts', () => {
		expect(normaliseWord('rabbit-hole')).toEqual(['rabbit', 'hole']);
		expect(normaliseWord('Rabbit—Hole')).toEqual(['rabbit', 'hole']);
	});

	it('expands numbers so digits and words meet ("42" ↔ "forty-two")', () => {
		expect(normaliseWord('42')).toEqual(normaliseWord('forty-two'));
		expect(normaliseWord('1,000')).toEqual(['one', 'thousand']);
		expect(normaliseWord('3rd')).toEqual(['third']);
		expect(normaliseWord('21st')).toEqual(['twenty', 'first']);
		expect(normaliseWord('20th')).toEqual(['twentieth']);
		expect(normaliseWord('2.5')).toEqual(['two', 'point', 'five']);
	});

	it('removes diacritics', () => {
		expect(normaliseWord('Café')).toEqual(['cafe']);
	});
});

describe('tokenise', () => {
	it('reads a Roman numeral after "chapter" as a number', () => {
		expect(tokenise(['CHAPTER', 'IV', 'The', 'Rabbit']).map((t) => t.text)).toEqual([
			'chapter',
			'four',
			'the',
			'rabbit'
		]);
		// "I" elsewhere is the pronoun.
		expect(tokenise(['said', 'I']).map((t) => t.text)).toEqual(['said', 'i']);
	});

	it('remembers which word each token came from', () => {
		expect(tokenise(['42', 'cats', '!'])).toEqual([
			{ text: 'forty', source: 0, part: 0, parts: 2 },
			{ text: 'two', source: 0, part: 1, parts: 2 },
			{ text: 'cats', source: 1, part: 0, parts: 1 }
		]);
	});
});

describe('similarity', () => {
	it('computes edit distance with an early exit', () => {
		expect(editDistance('kitten', 'sitting')).toBe(3);
		expect(editDistance('same', 'same')).toBe(0);
		expect(editDistance('a', 'abcdef', 2)).toBe(3);
	});

	it('treats close spellings of longer words as the same Word', () => {
		expect(isFuzzyMatch('alis', 'alice')).toBe(true);
		expect(isFuzzyMatch('dina', 'dinah')).toBe(true);
		expect(isFuzzyMatch('he', 'she')).toBe(false);
		expect(isFuzzyMatch('rabbit', 'pocket')).toBe(false);
	});
});
