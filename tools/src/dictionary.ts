/**
 * Builds the offline dictionary for Define (P1-RDR-18, D-043) from Open English WordNet's JSON
 * release into `apps/web/static/dictionary/oewn-2025/`, which is committed: the app ships it.
 *
 * - Only single Words: the reader looks up one Word, and the tokeniser splits at spaces and
 *   hyphens, so phrases ("a cappella") and hyphenated entries could never be found.
 * - Each headword keeps every meaning in WordNet's order, with the first example of each and one
 *   pronunciation per part of speech (British where given).
 * - Irregular forms ("mice", "went") point at their headword; regular ones are the reader's
 *   rules (`apps/web/src/lib/reader/define.ts`).
 *
 *   npm run dictionary [-- --zip english-wordnet-2025-json.zip]
 *
 * Without `--zip` it downloads the release (10 MB) into `tools/.cache/`, checking its SHA-256.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
	dictionaryKey,
	type DictionaryGroup,
	type DictionaryIndex,
	type DictionaryPiece,
	type DictionaryPos,
	type DictionaryRecord,
	type DictionarySense
} from '@book/core';
import { unzipSync } from 'fflate';
import { ROOT } from './book';

const RELEASE = {
	url: 'https://en-word.net/static/english-wordnet-2025-json.zip',
	sha256: '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51'
};
const OUT = join(ROOT, 'apps/web/static/dictionary/oewn-2025');
/** About 100 KB of JSON a piece: a quick download on the web, a quick parse on a phone. */
const PIECE_SIZE = 100_000;

interface Sense {
	synset: string;
}
interface EntryPos {
	sense: Sense[];
	form?: string[];
	pronunciation?: { value: string; variety?: string }[];
}
interface Synset {
	definition: string[];
	example?: (string | { text: string })[];
	partOfSpeech: string;
}

const POS: Record<string, DictionaryPos> = { n: 'n', v: 'v', a: 'a', s: 'a', r: 'r' };

/** One Word, as the tokeniser would leave it: no spaces, hyphens or underscores. */
const single = (lemma: string) => !/[\s\-_]/u.test(lemma);

function sha256(data: Uint8Array): string {
	return createHash('sha256').update(data).digest('hex');
}

async function release(zipPath: string | undefined): Promise<Uint8Array> {
	if (zipPath) return readFileSync(zipPath);
	const cache = join(ROOT, 'tools/.cache/english-wordnet-2025-json.zip');
	if (existsSync(cache)) return readFileSync(cache);
	console.log(`Downloading ${RELEASE.url}…`);
	const response = await fetch(RELEASE.url);
	if (!response.ok) throw new Error(`The download failed: ${response.status}`);
	const data = new Uint8Array(await response.arrayBuffer());
	mkdirSync(join(ROOT, 'tools/.cache'), { recursive: true });
	writeFileSync(cache, data);
	return data;
}

function build(files: Record<string, Uint8Array>) {
	const decoder = new TextDecoder();
	const json = (name: string) => JSON.parse(decoder.decode(files[name]!)) as unknown;
	const names = Object.keys(files).filter((n) => n.endsWith('.json'));
	const synsets = new Map<string, Synset>();
	for (const name of names.filter((n) => /(^|\/)(noun|verb|adj|adv)\.[^/]+\.json$/.test(n))) {
		for (const [id, synset] of Object.entries(json(name) as Record<string, Synset>)) {
			synsets.set(id, synset);
		}
	}
	const records = new Map<string, DictionaryRecord>();
	const record = (key: string) => {
		let r = records.get(key);
		if (!r) records.set(key, (r = {}));
		return r;
	};
	for (const name of names.filter((n) => /(^|\/)entries-[^/]+\.json$/.test(n))) {
		const entries = json(name) as Record<string, Record<string, EntryPos>>;
		for (const [lemma, byPos] of Object.entries(entries)) {
			if (!single(lemma)) continue;
			const groups: DictionaryGroup[] = [];
			for (const [pos, entry] of Object.entries(byPos)) {
				const p = POS[pos];
				if (!p) continue;
				const senses: DictionarySense[] = entry.sense.flatMap((s) => {
					const synset = synsets.get(s.synset);
					const definition = synset?.definition[0]?.trim();
					if (!definition) return [];
					const example = synset?.example?.[0];
					const text = typeof example === 'string' ? example : example?.text;
					return [text ? [definition, text.trim()] : [definition]];
				});
				const ipa =
					(entry.pronunciation?.find((x) => x.variety === 'GB') ?? entry.pronunciation?.[0])
						?.value ?? '';
				// Satellite adjectives join the adjectives.
				const same = groups.find((g) => g[0] === p);
				if (same) same[2].push(...senses);
				else if (senses.length) groups.push([p, ipa, senses]);
				for (const form of entry.form ?? []) {
					if (!single(form)) continue;
					const r = record(dictionaryKey(form));
					r.f ??= [];
					if (!r.f.some(([b, q]) => b === lemma && q === p)) r.f.push([lemma, p]);
				}
			}
			if (!groups.length) continue;
			const r = record(dictionaryKey(lemma));
			r.e ??= [];
			r.e.push([lemma, groups]);
		}
	}
	// "polish" before "Polish": the lower-case spelling is the commoner reading.
	for (const r of records.values()) {
		r.e?.sort(([a], [b]) => Number(a !== a.toLowerCase()) - Number(b !== b.toLowerCase()));
	}
	return records;
}

async function main() {
	const { values } = parseArgs({ options: { zip: { type: 'string' } } });
	const data = await release(values.zip);
	const hash = sha256(data);
	if (!values.zip && hash !== RELEASE.sha256) {
		throw new Error(`The release's SHA-256 is ${hash}, not ${RELEASE.sha256}.`);
	}
	const records = build(unzipSync(data));
	// Code-unit order, as `dictionaryPieceOf` compares keys.
	const keys = [...records.keys()].sort();
	rmSync(OUT, { recursive: true, force: true });
	mkdirSync(OUT, { recursive: true });
	const pieces: string[] = [];
	let piece: DictionaryPiece = {};
	let size = 0;
	const flush = () => {
		writeFileSync(join(OUT, `${pieces.length - 1}.json`), JSON.stringify(piece));
		piece = {};
		size = 0;
	};
	for (const key of keys) {
		const value = records.get(key)!;
		const length = key.length + JSON.stringify(value).length + 4;
		if (!pieces.length || size + length > PIECE_SIZE) {
			if (pieces.length) flush();
			pieces.push(key);
		}
		piece[key] = value;
		size += length;
	}
	flush();
	const index: DictionaryIndex = {
		source: 'Open English WordNet 2025',
		licence: 'CC BY 4.0',
		licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
		url: 'https://en-word.net/',
		pieces
	};
	writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
	writeFileSync(
		join(OUT, 'LICENSE.txt'),
		[
			'Open English WordNet 2025 (https://en-word.net/), by John P. McCrae and the',
			'Open English WordNet contributors, based on Princeton WordNet 3.0',
			'(https://wordnet.princeton.edu/).',
			'',
			'Licensed under the Creative Commons Attribution 4.0 International licence:',
			'https://creativecommons.org/licenses/by/4.0/',
			'',
			"Changed for this app by tools/src/dictionary.ts: only single words, each meaning's",
			'first example and one pronunciation per part of speech, cut into pieces by word.',
			`Source: ${RELEASE.url} (SHA-256 ${hash}).`,
			''
		].join('\n')
	);
	const headwords = [...records.values()].reduce((n, r) => n + (r.e?.length ?? 0), 0);
	console.log(
		`${headwords} headwords and ${keys.length} keys in ${pieces.length} pieces under ${OUT}`
	);
}

await main();
