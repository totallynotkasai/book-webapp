import { describe, expect, it } from 'vitest';
import { tokenise, words } from './tokenise';

describe('tokenise (D-026)', () => {
	it('splits on spaces and punctuation', () => {
		expect(words('Alice was beginning to get very tired.')).toEqual([
			'Alice',
			'was',
			'beginning',
			'to',
			'get',
			'very',
			'tired'
		]);
		expect(words('“Well!” thought Alice—to herself;')).toEqual([
			'Well',
			'thought',
			'Alice',
			'to',
			'herself'
		]);
	});

	it('keeps apostrophes and full stops between letters inside a Word', () => {
		expect(words("can't don’t rock'n'roll e.g. Mr. Wonderland’s")).toEqual([
			"can't",
			'don’t',
			"rock'n'roll",
			'e.g',
			'Mr',
			'Wonderland’s'
		]);
		expect(words("'Tis the cats' tea")).toEqual(['Tis', 'the', 'cats', 'tea']);
	});

	it('joins digits across , . and keeps letters with digits', () => {
		expect(words('1,000,000 and 3.14 or 1st, 2nd; 10:30')).toEqual([
			'1,000,000',
			'and',
			'3.14',
			'or',
			'1st',
			'2nd',
			'10',
			'30'
		]);
		expect(words('3, 4. 5')).toEqual(['3', '4', '5']);
	});

	it('splits at hyphens and colons', () => {
		expect(words('well-known c:a')).toEqual(['well', 'known', 'c', 'a']);
	});

	it('keeps combining marks, soft hyphens and connectors inside Words', () => {
		expect(words('café dé­jà snake_case __')).toEqual(['café', 'dé­jà', 'snake_case']);
	});

	it('handles other alphabets, and makes Han, Kana and Thai one Word per character', () => {
		expect(words('Привет мир Γειά σου שלום')).toEqual(['Привет', 'мир', 'Γειά', 'σου', 'שלום']);
		expect(words('日本語のテキスト')).toEqual(['日', '本', '語', 'の', 'テ', 'キ', 'ス', 'ト']);
		expect(words('한국어 문장')).toEqual(['한국어', '문장']);
		expect(words('สวัสดี')).toEqual(['ส', 'วั', 'ส', 'ดี']);
	});

	it('handles characters outside the BMP and skips emoji', () => {
		expect(words('𝐀𝐁 ok 😀 x')).toEqual(['𝐀𝐁', 'ok', 'x']);
	});

	it('reports UTF-16 offsets', () => {
		expect(tokenise('a 𝐀𝐁 b')).toEqual([
			{ start: 0, end: 1 },
			{ start: 2, end: 6 },
			{ start: 7, end: 8 }
		]);
	});

	it('finds nothing in text without letters or digits', () => {
		expect(tokenise('  —  … ! ')).toEqual([]);
		expect(tokenise('')).toEqual([]);
	});
});
