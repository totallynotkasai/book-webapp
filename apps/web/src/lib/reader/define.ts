import {
	dictionaryKey,
	dictionaryPieceOf,
	type DictionaryGroup,
	type DictionaryIndex,
	type DictionaryPiece,
	type DictionaryPos,
	type DictionaryRecord
} from '@book/core';

/**
 * Define (P1-RDR-18, D-043): a Word looked up in the offline dictionary the app ships, Open
 * English WordNet. Its files are the app's own, so nothing the reader looks up leaves the device.
 * Loaded the first time Define is used.
 */

export interface Meaning {
	definition: string;
	example?: string;
}

export interface PartOfSpeech {
	label: 'noun' | 'verb' | 'adjective' | 'adverb';
	/** IPA, without slashes; empty when the dictionary has none. */
	ipa: string;
	meanings: Meaning[];
}

export interface Definition {
	headword: string;
	parts: PartOfSpeech[];
}

export interface LookUp {
	/** The Word as looked up: no possessive, soft hyphens or straggling punctuation. */
	word: string;
	/** Exact spelling first, then the Word's base forms ("antipathies": antipathy). */
	definitions: Definition[];
}

const LABELS: Record<DictionaryPos, PartOfSpeech['label']> = {
	n: 'noun',
	v: 'verb',
	a: 'adjective',
	r: 'adverb'
};

/** At most this many headwords on a card: the spelling itself and a base form or two. */
const MAX_HEADWORDS = 3;

/**
 * The Word to look up from a selection of one Word: soft hyphens and other format characters
 * out, punctuation at either end off, and a possessive dropped ("Alice’s": Alice, "Gryphons’":
 * Gryphons).
 */
export function lookupWord(text: string): string {
	let word = text
		.normalize('NFC')
		.replace(/\p{Cf}/gu, '')
		.replace(/[‘’ʼ]/g, "'")
		.trim()
		.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '');
	if (/\p{L}'s$/iu.test(word)) word = word.slice(0, -2);
	else if (/s'$/iu.test(word)) word = word.slice(0, -1);
	return word.replace(/^'+|'+$/g, '');
}

/** WordNet's detachment rules (morphy): an ending, what replaces it, and the part of speech. */
const RULES: [ending: string, replacement: string, pos: DictionaryPos][] = [
	['s', '', 'n'],
	['ses', 's', 'n'],
	['xes', 'x', 'n'],
	['zes', 'z', 'n'],
	['ches', 'ch', 'n'],
	['shes', 'sh', 'n'],
	['men', 'man', 'n'],
	['ies', 'y', 'n'],
	['s', '', 'v'],
	['ies', 'y', 'v'],
	['es', 'e', 'v'],
	['es', '', 'v'],
	['ed', 'e', 'v'],
	['ed', '', 'v'],
	['ying', 'ie', 'v'],
	['ing', 'e', 'v'],
	['ing', '', 'v'],
	['er', '', 'a'],
	['est', '', 'a'],
	['er', 'e', 'a'],
	['est', 'e', 'a'],
	['ier', 'y', 'a'],
	['iest', 'y', 'a']
];

/**
 * The forms a regular inflection could come from, in rule order, each with the part of speech
 * it would be: "antipathies" → antipathy (noun), "curiouser" → curious (adjective), "stopped" →
 * stop (verb, the doubled consonant undone). Unchecked: the dictionary decides which exist.
 */
export function baseForms(word: string): { base: string; pos: DictionaryPos }[] {
	const lower = dictionaryKey(word);
	const out: { base: string; pos: DictionaryPos }[] = [];
	const add = (base: string, pos: DictionaryPos) => {
		if (base.length < 2 || base === lower) return;
		if (!out.some((o) => o.base === base && o.pos === pos)) out.push({ base, pos });
	};
	for (const [ending, replacement, pos] of RULES) {
		if (!lower.endsWith(ending) || lower.length <= ending.length) continue;
		const stem = lower.slice(0, -ending.length);
		add(stem + replacement, pos);
		// "stopped", "running", "bigger": a doubled last consonant before the ending.
		if (!replacement && /([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1), pos);
	}
	return out;
}

function partsOf(groups: DictionaryGroup[], only?: DictionaryPos): PartOfSpeech[] {
	return groups
		.filter(([pos]) => !only || pos === only)
		.map(([pos, ipa, senses]) => ({
			label: LABELS[pos],
			ipa,
			meanings: senses.map(([definition, example]) =>
				example ? { definition, example } : { definition }
			)
		}));
}

export type Credit = Pick<DictionaryIndex, 'source' | 'licence' | 'licenceUrl' | 'url'>;

/** Reads the dictionary's files: from the app's own static files (`DICTIONARY_PATH`). */
export type ReadDictionaryFile = (name: string) => Promise<unknown>;

export class Dictionary {
	#read: ReadDictionaryFile;
	#index: Promise<DictionaryIndex> | undefined;
	#pieces = new Map<number, Promise<DictionaryPiece>>();

	constructor(read: ReadDictionaryFile) {
		this.#read = read;
	}

	/** The source and licence the card credits (CC BY asks for both, with links). */
	async source(): Promise<Credit> {
		const { source, licence, licenceUrl, url } = await this.#loadIndex();
		return { source, licence, licenceUrl, url };
	}

	#loadIndex(): Promise<DictionaryIndex> {
		this.#index ??= (this.#read('index.json') as Promise<DictionaryIndex>).catch((error) => {
			this.#index = undefined;
			throw error;
		});
		return this.#index;
	}

	async #record(key: string): Promise<DictionaryRecord | undefined> {
		const index = await this.#loadIndex();
		const i = dictionaryPieceOf(index, key);
		let piece = this.#pieces.get(i);
		if (!piece) {
			piece = (this.#read(`${i}.json`) as Promise<DictionaryPiece>).catch((error) => {
				// Offline on the web: try again next time.
				this.#pieces.delete(i);
				throw error;
			});
			this.#pieces.set(i, piece);
		}
		const all = await piece;
		return Object.hasOwn(all, key) ? all[key] : undefined;
	}

	/**
	 * The Word's definitions: its own spelling (that exact case first), then what it's a form of,
	 * irregular ("went": go) or by the rules ("antipathies": antipathy), each showing only the
	 * part of speech it's a form of. Rejects when the dictionary's files can't be read.
	 */
	async lookUp(text: string): Promise<LookUp> {
		const word = lookupWord(text);
		const definitions: Definition[] = [];
		const add = (headword: string, parts: PartOfSpeech[]) => {
			if (!parts.length) return;
			const same = definitions.find((d) => d.headword === headword);
			if (!same) {
				if (definitions.length < MAX_HEADWORDS) definitions.push({ headword, parts });
				return;
			}
			for (const part of parts) {
				if (!same.parts.some((p) => p.label === part.label)) same.parts.push(part);
			}
		};
		if (!word) return { word, definitions };
		const key = dictionaryKey(word);
		const own = await this.#record(key);
		const headwords = [...(own?.e ?? [])].sort(
			([a], [b]) => Number(b === word) - Number(a === word)
		);
		for (const [headword, groups] of headwords) add(headword, partsOf(groups));
		const bases = [
			...(own?.f ?? []).map(([base, pos]) => ({ base, pos })),
			...baseForms(word).filter((b) => !own?.f?.some(([base]) => dictionaryKey(base) === b.base))
		];
		for (const { base, pos } of bases) {
			if (definitions.length >= MAX_HEADWORDS) break;
			const record = await this.#record(dictionaryKey(base));
			for (const [headword, groups] of record?.e ?? []) {
				// A rule's base is lower case: it never makes "Polish" of "polishes".
				if (headword !== base && dictionaryKey(headword) !== headword) continue;
				add(headword, partsOf(groups, pos));
			}
		}
		return { word, definitions };
	}
}

/** Wiktionary's page for a Word: only ever opened on the reader's tap (D-043). */
export function wiktionaryUrl(word: string): string {
	return `https://en.wiktionary.org/wiki/${encodeURIComponent(word.replace(/ /g, '_'))}`;
}
