import { describe, expect, it } from 'vitest';
import type { ChapterText } from '@book/reader-core';
import {
	charOfWord,
	SpokenChapters,
	spokenSentences,
	utterancesOf,
	voiceFor,
	wordAtChar
} from './speech-text';

const text: ChapterText = {
	chapterId: 'c1',
	firstOrdinal: 100,
	wordIds: [1, 2, 3, 4, 5, 6, 7, 8],
	texts: ['“Well!”', 'thought', 'Alice.', 'She', 'sat', 'down.', 'CHAPTER', 'II.'],
	blocks: [0, 0, 0, 0, 0, 0, 1, 1]
};

describe('spokenSentences (P1-LAY-08)', () => {
	it('speaks each sentence with its punctuation, and knows where each Word starts', () => {
		const sentences = spokenSentences(text);
		expect(sentences.map((s) => s.text)).toEqual([
			'“Well!” thought Alice.',
			'She sat down.',
			'CHAPTER II.'
		]);
		expect(sentences[0]).toMatchObject({ first: 0, last: 2, starts: [0, 8, 16] });
		expect(sentences[1]).toMatchObject({ first: 3, last: 5, starts: [0, 4, 8] });
	});

	it('maps a boundary back to its Word, wherever in the Word it falls', () => {
		const [first] = spokenSentences(text);
		expect(wordAtChar(first!, 0)).toBe(0);
		// A voice may report the letter after the opening quote, or the space before a Word.
		expect(wordAtChar(first!, 1)).toBe(0);
		expect(wordAtChar(first!, 8)).toBe(1);
		expect(wordAtChar(first!, 15)).toBe(1);
		expect(wordAtChar(first!, 17)).toBe(2);
		expect(wordAtChar(first!, 999)).toBe(2);
		expect(charOfWord(first!, 2)).toBe(16);
		expect(charOfWord(first!, 0)).toBe(0);
	});
});

describe('voiceFor', () => {
	const voices = [
		{ id: 'george', name: 'George', lang: 'en-GB', default: false },
		{ id: 'zira', name: 'Zira', lang: 'en-US', default: true },
		{ id: 'amelie', name: 'Amélie', lang: 'fr-CA', default: false }
	];

	it("uses the reader's choice for the Book's language, else the language's default", () => {
		expect(voiceFor(voices, 'en', 'george')?.id).toBe('george');
		expect(voiceFor(voices, 'en-GB', undefined)?.id).toBe('zira');
		expect(voiceFor(voices, 'en', 'gone')?.id).toBe('zira');
		expect(voiceFor(voices, 'fr', undefined)?.id).toBe('amelie');
	});

	it('never reads a Book in a voice for another language', () => {
		expect(voiceFor(voices, 'en', 'amelie')?.id).toBe('zira');
		expect(voiceFor(voices, 'de', undefined)).toBeNull();
	});

	it('uses any voice for a Book that does not say its language', () => {
		expect(voiceFor(voices, 'und', undefined)?.id).toBe('zira');
		expect(voiceFor(voices, 'und', 'amelie')?.id).toBe('amelie');
	});
});

describe('SpokenChapters', () => {
	it('loads a Chapter once, gives each sentence an id, and maps an id back', async () => {
		let loads = 0;
		const chapters = new SpokenChapters(async () => {
			loads++;
			return text;
		});
		const [a, b] = await Promise.all([chapters.get('c1'), chapters.get('c1')]);
		expect(a).toBe(b);
		expect(loads).toBe(1);
		expect(a.ids).toHaveLength(3);
		expect(new Set(a.ids).size).toBe(3);
		expect(chapters.locate(a.ids[1]!)).toMatchObject({ index: 1, sentence: { first: 3 } });
		expect(chapters.locate(999)).toBeNull();
		expect(utterancesOf(a, 1).map((u) => u.text)).toEqual(['She sat down.', 'CHAPTER II.']);
	});

	it('tries again after a failed load', async () => {
		let fail = true;
		const chapters = new SpokenChapters(async () => {
			if (fail) throw new Error('offline');
			return text;
		});
		await expect(chapters.get('c1')).rejects.toThrow('offline');
		fail = false;
		await expect(chapters.get('c1')).resolves.toMatchObject({ chapterId: 'c1' });
	});
});
