import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DICTIONARY_PATH, type DictionaryPiece } from '@book/core';
import { describe, expect, it, vi } from 'vitest';
import { baseForms, Dictionary, lookupWord, wiktionaryUrl } from './define';

/** The dictionary the app ships (`npm run dictionary`), read from the static files. */
const shipped = join(__dirname, '../../../static', DICTIONARY_PATH);
const readShipped = (name: string) =>
	Promise.resolve(JSON.parse(readFileSync(join(shipped, name), 'utf8')) as unknown);

/** A small dictionary in two pieces, for the rules. */
function tiny(pieces: DictionaryPiece[]) {
	const read = vi.fn((name: string) => {
		if (name === 'index.json') {
			return Promise.resolve({
				source: 'Tiny',
				licence: 'CC0',
				licenceUrl: 'https://example.invalid/cc0',
				url: 'https://example.invalid/',
				pieces: pieces.map((p) => Object.keys(p).sort()[0]!)
			});
		}
		return Promise.resolve(pieces[Number(name.replace('.json', ''))]);
	});
	return { dictionary: new Dictionary(read), read };
}

describe('lookupWord (P1-RDR-18)', () => {
	it('drops possessives, soft hyphens and punctuation at either end', () => {
		expect(lookupWord('Alice’s')).toBe('Alice');
		expect(lookupWord("Gryphons'")).toBe('Gryphons');
		expect(lookupWord('anti­pathies')).toBe('antipathies');
		expect(lookupWord('“Curiouser!”')).toBe('Curiouser');
		expect(lookupWord('o’clock')).toBe("o'clock");
		expect(lookupWord('—')).toBe('');
	});
});

describe('baseForms (P1-RDR-18)', () => {
	it('undoes regular endings, with the part of speech each would be', () => {
		expect(baseForms('antipathies')).toContainEqual({ base: 'antipathy', pos: 'n' });
		expect(baseForms('curiouser')).toContainEqual({ base: 'curious', pos: 'a' });
		expect(baseForms('stopped')).toContainEqual({ base: 'stop', pos: 'v' });
		expect(baseForms('lying')).toContainEqual({ base: 'lie', pos: 'v' });
		expect(baseForms('happiest')).toContainEqual({ base: 'happy', pos: 'a' });
		expect(baseForms('Boxes')).toContainEqual({ base: 'box', pos: 'n' });
	});

	it('never offers the word itself or a stub', () => {
		expect(baseForms('is').map((b) => b.base)).not.toContain('i');
		expect(baseForms('cat')).toEqual([]);
	});
});

describe('Dictionary (P1-RDR-18)', () => {
	const pieces: DictionaryPiece[] = [
		{
			go: { e: [['go', [['v', 'ɡəʊ', [['move', 'go home']]]]]] },
			mouse: { e: [['mouse', [['n', 'maʊs', [['a small rodent']]]]]] },
			mice: { f: [['mouse', 'n']] }
		},
		{
			polish: {
				e: [
					['polish', [['v', 'ˈpɒlɪʃ', [['make shine']]]]],
					['Polish', [['a', 'ˈpəʊlɪʃ', [['of Poland']]]]]
				]
			},
			saw: { e: [['saw', [['n', '', [['a tool']]]]]], f: [['see', 'v']] },
			see: {
				e: [
					[
						'see',
						[
							['n', '', [['a bishop’s seat']]],
							['v', 'siː', [['perceive by sight']]]
						]
					]
				]
			},
			went: { f: [['go', 'v']] }
		}
	];

	it('finds a Word as spelt, its exact case first', async () => {
		const { dictionary } = tiny(pieces);
		const polish = await dictionary.lookUp('Polish');
		expect(polish.definitions.map((d) => d.headword)).toEqual(['Polish', 'polish']);
		const lower = await dictionary.lookUp('polish');
		expect(lower.definitions.map((d) => d.headword)).toEqual(['polish', 'Polish']);
	});

	it('follows irregular forms, showing only the part of speech they belong to', async () => {
		const { dictionary } = tiny(pieces);
		const saw = await dictionary.lookUp('saw');
		expect(saw.definitions.map((d) => d.headword)).toEqual(['saw', 'see']);
		expect(saw.definitions[1]!.parts.map((p) => p.label)).toEqual(['verb']);
		const went = await dictionary.lookUp('went');
		expect(went.definitions).toEqual([
			{
				headword: 'go',
				parts: [
					{ label: 'verb', ipa: 'ɡəʊ', meanings: [{ definition: 'move', example: 'go home' }] }
				]
			}
		]);
	});

	it('reads only the pieces it needs, once each', async () => {
		const { dictionary, read } = tiny(pieces);
		await dictionary.lookUp('mice');
		await dictionary.lookUp('mouse');
		expect(read.mock.calls.map(([name]) => name)).toEqual(['index.json', '0.json']);
	});

	it('finds nothing for a Word it hasn’t got, and tries a failed piece again', async () => {
		const read = vi.fn((name: string) =>
			name === 'index.json'
				? Promise.resolve({ source: '', licence: '', licenceUrl: '', url: '', pieces: ['a'] })
				: Promise.reject(new TypeError('Failed to fetch'))
		);
		const dictionary = new Dictionary(read);
		await expect(dictionary.lookUp('zyzzyva')).rejects.toThrow('Failed to fetch');
		await expect(dictionary.lookUp('zyzzyva')).rejects.toThrow('Failed to fetch');
		expect(read).toHaveBeenCalledTimes(3);
		const { dictionary: other } = tiny(pieces);
		expect((await other.lookUp('frabjous')).definitions).toEqual([]);
	});
});

describe('the shipped dictionary (Open English WordNet, D-043)', () => {
	const dictionary = new Dictionary(readShipped);

	it('has "antipathies" from Chapter I of Alice, as antipathy', async () => {
		const result = await dictionary.lookUp('antipathies');
		expect(result.definitions[0]!.headword).toBe('antipathy');
		expect(result.definitions[0]!.parts[0]!.label).toBe('noun');
		expect(result.definitions[0]!.parts[0]!.meanings[0]!.definition).toBe(
			'a feeling of intense dislike'
		);
	});

	it('has Carroll’s "curiouser" as curious, and "went" as go', async () => {
		expect((await dictionary.lookUp('Curiouser')).definitions[0]!.headword).toBe('curious');
		expect((await dictionary.lookUp('went')).definitions[0]!.headword).toBe('go');
	});

	it('credits its source and licence', async () => {
		expect(await dictionary.source()).toEqual({
			source: 'Open English WordNet 2025',
			licence: 'CC BY 4.0',
			licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
			url: 'https://en-word.net/'
		});
	});
});

describe('wiktionaryUrl', () => {
	it('links to the Word’s page', () => {
		expect(wiktionaryUrl('frabjous')).toBe('https://en.wiktionary.org/wiki/frabjous');
		expect(wiktionaryUrl("o'clock")).toBe("https://en.wiktionary.org/wiki/o'clock");
	});
});
