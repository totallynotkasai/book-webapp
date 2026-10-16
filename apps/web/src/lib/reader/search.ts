/**
 * Search in the Book (P1-RDR-10, DESIGN.md §4.9): over Words, not characters, so a phrase is
 * found across a line break or inline markup (`fall <i>never</i> come`), and case and accents
 * don't matter. Each Chapter's Words come from the engine's `chapterText`, folded once into a
 * plain array; a query is then a scan of that array. Plain functions and a cache, tested without
 * a reader.
 */
import type { ChapterText } from '@book/reader-core';
import { gapAfter, joinWords } from './words';

/** How many Words of context a result shows on each side, within its paragraph. */
const CONTEXT_WORDS = 7;

/** Lower case, no accents, straight apostrophes: how search compares Words. */
export function foldWord(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[‘’ʼ′]/g, "'");
}

/** A Word as `chapterText` gives it (`“Well!”`), without the punctuation around it, folded. */
export function bareWord(punctuated: string): string {
	return foldWord(punctuated).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * The Words of a query, folded. Hyphens and other punctuation split Words, as the tokeniser
 * does, so "Cheshire-Cat" finds "Cheshire Cat"; apostrophes inside a Word stay ("don't").
 */
export function queryWords(query: string): string[] {
	return foldWord(query)
		.split(/[^\p{L}\p{N}']+/u)
		.map((w) => w.replace(/^'+|'+$/g, ''))
		.filter(Boolean);
}

/** A Chapter ready to search: its folded Words, and the text to show around a result. */
export interface SearchChapter {
	chapterId: string;
	firstOrdinal: number;
	wordIds: number[];
	/** Each Word folded and bare. */
	words: string[];
	/** Each Word as on the page, for the line of context. */
	texts: string[];
	blocks: number[];
}

export function searchChapter(text: ChapterText): SearchChapter {
	return {
		chapterId: text.chapterId,
		firstOrdinal: text.firstOrdinal,
		wordIds: text.wordIds,
		words: text.texts.map(bareWord),
		texts: text.texts,
		blocks: text.blocks
	};
}

export interface SearchHit {
	chapterId: string;
	/** The matched Words, as positions in the Chapter and as Ordinals. */
	first: number;
	last: number;
	startOrdinal: number;
	endOrdinal: number;
	startWordId: number;
	endWordId: number;
	/** The line of context: before the match, the match as on the page, after it. */
	before: string;
	match: string;
	after: string;
}

/**
 * A query Word matches a Word that is the same, or its possessive ("Alice" finds "Alice's"). The
 * last Word of the query also matches the start of a Word, so results come while typing.
 */
function matches(word: string, q: string, last: boolean): boolean {
	if (word === q) return true;
	if (last) return word.startsWith(q);
	return word === `${q}'s`;
}

/** Every place the query's Words occur, in order, in one Chapter. */
export function findInChapter(chapter: SearchChapter, query: readonly string[]): SearchHit[] {
	const hits: SearchHit[] = [];
	const k = query.length;
	if (!k) return hits;
	const { words } = chapter;
	for (let i = 0; i + k <= words.length; i++) {
		let found = true;
		for (let j = 0; j < k; j++) {
			if (!matches(words[i + j]!, query[j]!, j === k - 1)) {
				found = false;
				break;
			}
		}
		if (found) {
			hits.push(hitAt(chapter, i, i + k - 1));
			// Phrases don't overlap: "had had had" has one "had had".
			i += k - 1;
		}
	}
	return hits;
}

function hitAt(chapter: SearchChapter, first: number, last: number): SearchHit {
	const { texts, blocks, wordIds, firstOrdinal } = chapter;
	// Context stays within the paragraph the match starts and ends in.
	let from = first;
	while (from > 0 && first - from < CONTEXT_WORDS && blocks[from - 1] === blocks[first]) from--;
	let to = last;
	while (to < texts.length - 1 && to - last < CONTEXT_WORDS && blocks[to + 1] === blocks[last])
		to++;
	const join = (a: number, b: number) => joinWords(texts.slice(a, b + 1));
	const cutBefore = from > 0 && blocks[from - 1] === blocks[first];
	const cutAfter = to < texts.length - 1 && blocks[to + 1] === blocks[last];
	return {
		chapterId: chapter.chapterId,
		first,
		last,
		startOrdinal: firstOrdinal + first,
		endOrdinal: firstOrdinal + last,
		startWordId: wordIds[first]!,
		endWordId: wordIds[last]!,
		before:
			(cutBefore ? '… ' : '') +
			(from < first ? join(from, first - 1) + gapAfter(texts[first - 1]!) : ''),
		match: join(first, last),
		after: (to > last ? gapAfter(texts[last]!) + join(last + 1, to) : '') + (cutAfter ? ' …' : '')
	};
}

/**
 * The Book's Chapters as they're readied for search, in reading order. Readying a Chapter means
 * reading and parsing it, so it happens once, a Chapter at a time; a failed one is tried again.
 */
export class SearchIndex {
	readonly #pending = new Map<string, Promise<SearchChapter>>();
	readonly #load: (chapterId: string) => Promise<ChapterText>;

	constructor(load: (chapterId: string) => Promise<ChapterText>) {
		this.#load = load;
	}

	chapter(chapterId: string): Promise<SearchChapter> {
		let chapter = this.#pending.get(chapterId);
		if (!chapter) {
			chapter = this.#load(chapterId).then(searchChapter);
			chapter.catch(() => this.#pending.delete(chapterId));
			this.#pending.set(chapterId, chapter);
		}
		return chapter;
	}
}
