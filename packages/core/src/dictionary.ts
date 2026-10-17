/**
 * The offline dictionary's files (P1-RDR-18, D-043): Open English WordNet, written by
 * `npm run dictionary` (tools) into the app's static files and read by Define in the reader. The
 * app ships it, so a look-up never leaves the device.
 *
 * Words are keyed by `dictionaryKey`: lower case, NFC, straight apostrophes. The keys are sorted
 * and cut into pieces of about 100 KB, so a look-up reads one small file; `index.json` names
 * each piece's first key.
 */

/** Parts of speech, as WordNet writes them (satellite adjectives are adjectives here). */
export type DictionaryPos = 'n' | 'v' | 'a' | 'r';

/** A meaning: its definition, and an example of it in use when WordNet has one. */
export type DictionarySense = [definition: string, example?: string];

/** One part of speech of a headword: its pronunciation (IPA, British where given) and meanings. */
export type DictionaryGroup = [pos: DictionaryPos, ipa: string, senses: DictionarySense[]];

/** A headword as the dictionary spells it ("polish", "Polish"), with its parts of speech. */
export type DictionaryHeadword = [headword: string, groups: DictionaryGroup[]];

/** What a key holds: headwords spelt that way, and irregular forms of others ("mice": mouse). */
export interface DictionaryRecord {
	e?: DictionaryHeadword[];
	/** This key is an irregular form of these headwords, with the part of speech it's a form of. */
	f?: [base: string, pos: DictionaryPos][];
}

export type DictionaryPiece = Record<string, DictionaryRecord>;

export interface DictionaryIndex {
	/** The source's name and edition, as the card credits it. */
	source: string;
	licence: string;
	licenceUrl: string;
	/** Where the source is described. */
	url: string;
	/** The first key of each piece; piece `i` is `<i>.json` beside the index. */
	pieces: string[];
}

/** Where the files are, under the app's static files. */
export const DICTIONARY_PATH = '/dictionary/oewn-2025';

/** The key a word is filed under: lower case, NFC, curly apostrophes straightened. */
export function dictionaryKey(word: string): string {
	return word.normalize('NFC').replace(/[‘’ʼ]/g, "'").toLowerCase();
}

/** Which piece holds a key: the last whose first key isn't after it. */
export function dictionaryPieceOf(index: Pick<DictionaryIndex, 'pieces'>, key: string): number {
	let lo = 0;
	let hi = index.pieces.length - 1;
	let found = 0;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (index.pieces[mid]! <= key) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found;
}
