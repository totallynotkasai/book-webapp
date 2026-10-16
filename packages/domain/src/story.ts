/**
 * The story so far (DESIGN.md §4.9, Invariant 6; P1-STU-05, P1-RDR-13), shared by `backend-local`
 * now and the API in Phase 6: how a glossary name is found in the text, what stops a story being
 * published, and what a reader sees of it at the place they've reached.
 */
import type {
	AiUse,
	ChapterRecord,
	GlossaryPictureDto,
	RangeAnchor,
	StorySoFarDto
} from '@book/core';

/** Accents and curly apostrophes don't matter; case is kept (see `wordMatches`). */
function fold(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.replace(/[‘’ʼ′]/g, "'");
}

/**
 * A name's Words, split as the tokeniser splits text: at spaces, hyphens and other punctuation,
 * keeping apostrophes inside a Word ("Lamplighter's"). Accents and curly apostrophes are folded.
 */
export function nameWords(name: string): string[] {
	return fold(name)
		.split(/[^\p{L}\p{N}']+/u)
		.map((w) => w.replace(/^'+|'+$/g, ''))
		.filter(Boolean);
}

const startsWithCapital = (word: string) => {
	const first = word.charAt(0);
	return first !== first.toLowerCase();
};

/**
 * A Word of the text matches a Word of a name when its letters are the same, ignoring accents and
 * curly apostrophes; the name's last Word also matches its possessive ("Cobb" finds "Cobb’s").
 * Case matters one way only: a name Word with a capital needs a Word starting with a capital (or
 * in capitals), so "Wick" the cat isn't found in "the lamp’s wick", while a name Word in lower
 * case matches any case, so "the Murk" finds "The Murk" at the start of a sentence.
 */
export function wordMatches(text: string, nameWord: string, last: boolean): boolean {
	const word = fold(text).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
	const lower = word.toLowerCase();
	const wanted = nameWord.toLowerCase();
	if (lower !== wanted && !(last && lower === `${wanted}'s`)) return false;
	return nameWord === wanted || startsWithCapital(word);
}

/** Whether a selection in the text is the name (or its possessive), Word for Word. */
export function selectionIsName(selection: string, name: string): boolean {
	const selected = nameWords(selection);
	const words = nameWords(name);
	return (
		words.length > 0 &&
		selected.length === words.length &&
		selected.every((w, i) => wordMatches(w, words[i]!, i === words.length - 1))
	);
}

/** One Chapter's Words in reading order: their IDs and their text (as text-pipeline reads them). */
export interface ChapterWordTexts {
	chapterId: string;
	firstOrdinal: number;
	wordIds: readonly number[];
	texts: readonly string[];
}

/** A name's first occurrence: its Anchor, its Chapter, and a few Words either side of it. */
export interface NameOccurrence {
	anchor: RangeAnchor;
	chapterId: string;
	context: string;
}

const QUOTE_CHARS = 32;
const CONTEXT_WORDS = 6;

/**
 * A Revision's Words, indexed to find where names first appear (P1-STU-05). Built once per
 * Revision; each `find` looks only at the places the name's first Word occurs.
 */
export class RevisionWordTexts {
	readonly #bookId: string;
	readonly #revisionId: string;
	readonly #texts: string[] = [];
	readonly #ordinals: number[] = [];
	readonly #wordIds: number[] = [];
	readonly #chapterIds: string[] = [];
	/** Lower-case Word (and a possessive's Word without its "'s") → positions, ascending. */
	readonly #at = new Map<string, number[]>();

	constructor(bookId: string, revisionId: string, chapters: readonly ChapterWordTexts[]) {
		this.#bookId = bookId;
		this.#revisionId = revisionId;
		const ordered = [...chapters].sort((a, b) => a.firstOrdinal - b.firstOrdinal);
		for (const chapter of ordered) {
			chapter.texts.forEach((text, i) => {
				const position = this.#texts.length;
				this.#texts.push(text);
				this.#ordinals.push(chapter.firstOrdinal + i);
				this.#wordIds.push(chapter.wordIds[i]!);
				this.#chapterIds.push(chapter.chapterId);
				const lower = fold(text)
					.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
					.toLowerCase();
				const keys = lower.endsWith("'s") ? [lower, lower.slice(0, -2)] : [lower];
				for (const key of keys) {
					const list = this.#at.get(key);
					if (list) list.push(position);
					else this.#at.set(key, [position]);
				}
			});
		}
	}

	/** The name's first occurrence in reading order, or null when it isn't in the text. */
	find(name: string): NameOccurrence | null {
		const words = nameWords(name);
		const k = words.length;
		if (!k) return null;
		for (const start of this.#at.get(words[0]!.toLowerCase()) ?? []) {
			const end = start + k - 1;
			if (end >= this.#texts.length || this.#chapterIds[end] !== this.#chapterIds[start]) continue;
			let found = true;
			for (let j = 0; j < k; j++) {
				if (!wordMatches(this.#texts[start + j]!, words[j]!, j === k - 1)) {
					found = false;
					break;
				}
			}
			if (found) return this.#occurrence(start, end);
		}
		return null;
	}

	#join(from: number, to: number): string {
		return this.#texts.slice(Math.max(0, from), Math.max(0, to)).join(' ');
	}

	#occurrence(start: number, end: number): NameOccurrence {
		const chapterId = this.#chapterIds[start]!;
		const inChapter = (p: number) => this.#chapterIds[p] === chapterId;
		let from = start;
		while (from > 0 && start - from < CONTEXT_WORDS && inChapter(from - 1)) from--;
		let to = end;
		while (to < this.#texts.length - 1 && to - end < CONTEXT_WORDS && inChapter(to + 1)) to++;
		return {
			chapterId,
			anchor: {
				kind: 'range',
				bookId: this.#bookId,
				revisionId: this.#revisionId,
				startWordId: this.#wordIds[start]!,
				endWordId: this.#wordIds[end]!,
				startOrdinal: this.#ordinals[start]!,
				endOrdinal: this.#ordinals[end]!,
				quote: {
					exact: this.#join(start, end + 1),
					prefix: this.#join(start - 8, start).slice(-QUOTE_CHARS),
					suffix: this.#join(end + 1, end + 9).slice(0, QUOTE_CHARS)
				}
			},
			context: [
				from > 0 && inChapter(from - 1) ? '…' : '',
				this.#join(from, to + 1),
				to < this.#texts.length - 1 && inChapter(to + 1) ? '…' : ''
			]
				.filter(Boolean)
				.join(' ')
		};
	}
}

// ---- Publishing (P1-STU-05) ----

export const STORY_AI_QUESTION_PROBLEM = 'Answer “Was AI used to write these?” first.';

/**
 * Why a story so far can't be published yet, the AI answer aside; empty when it can. An entry
 * whose name isn't in the text can't be: no reader would ever meet it (P1-STU-05 acceptance).
 * Other names it's also called may be missing, for a version still to come.
 */
export function storyProblems(story: {
	recaps: number;
	entries: readonly { name: string; inText: boolean }[];
}): string[] {
	const problems: string[] = [];
	if (story.recaps === 0 && story.entries.length === 0) {
		problems.push('Write a recap or add a glossary entry first.');
	}
	for (const entry of story.entries) {
		if (!entry.inText) {
			problems.push(
				`“${entry.name}” isn’t in the book’s text, so readers would never meet it. Check its spelling, or remove it.`
			);
		}
	}
	return problems;
}

/** Everything that stops a publish, the AI answer first (§10.6). */
export function publishStoryProblems(
	story: Parameters<typeof storyProblems>[0],
	aiUse: AiUse | null | undefined
): string[] {
	return [...(aiUse ? [] : [STORY_AI_QUESTION_PROBLEM]), ...storyProblems(story)];
}

// ---- What a reader sees (P1-RDR-13, Invariant 6) ----

export interface GlossaryEntryAt {
	id: string;
	/** The first of its names the reader has met: its own name, or what it's also called. */
	name: string;
	/** Its other names the reader has met. */
	alsoCalled: string[];
	description: string;
	picture: GlossaryPictureDto | null;
	/** Where the earliest of those names appears. */
	firstAppearance: RangeAnchor;
}

export interface StoryAt {
	/** Recaps of the Chapters the reader has finished, in reading order. */
	recaps: { chapterId: string; text: string }[];
	/** Entries met so far, alphabetically. */
	glossary: GlossaryEntryAt[];
}

/** Alphabetical order ignores a leading "the", "a" or "an": "the Murk" sorts under M. */
export function glossarySortKey(name: string): string {
	return name.replace(/^(the|a|an)\s+/i, '');
}

/**
 * What a reader sees of the story so far once they've reached the Word at Ordinal `reached`
 * (Invariant 6: nothing from ahead of them). A Chapter's recap appears once its last Word has
 * been reached; a glossary entry once one of its names has appeared, under that name, with
 * only the other names already met. A story on another Revision shows nothing until it's moved.
 */
export function storySoFarAt(
	story: StorySoFarDto,
	manifest: { revisionId: string; chapters: readonly ChapterRecord[] },
	reached: number
): StoryAt {
	if (story.revisionId !== manifest.revisionId) return { recaps: [], glossary: [] };
	const chapters = new Map(manifest.chapters.map((c) => [c.chapterId, c]));
	const recaps = story.recaps
		.filter((recap) => {
			const chapter = chapters.get(recap.chapterId);
			return !!chapter && chapter.wordCount > 0 && chapter.lastOrdinal <= reached;
		})
		.sort(
			(a, b) => chapters.get(a.chapterId)!.firstOrdinal - chapters.get(b.chapterId)!.firstOrdinal
		);
	const glossary: GlossaryEntryAt[] = [];
	for (const entry of story.glossary) {
		const met = entry.names.filter(
			(n) =>
				n.firstAppearance.revisionId === story.revisionId && n.firstAppearance.endOrdinal <= reached
		);
		if (!met.length) continue;
		const earliest = met.reduce((a, b) =>
			b.firstAppearance.startOrdinal < a.firstAppearance.startOrdinal ? b : a
		);
		glossary.push({
			id: entry.id,
			name: met[0]!.name,
			alsoCalled: met.slice(1).map((n) => n.name),
			description: entry.description,
			picture: entry.picture,
			firstAppearance: earliest.firstAppearance
		});
	}
	glossary.sort((a, b) =>
		glossarySortKey(a.name).localeCompare(glossarySortKey(b.name), undefined, {
			sensitivity: 'base'
		})
	);
	return { recaps, glossary };
}

/** The entry a selection in the text names, among those the reader has met; or undefined. */
export function glossaryEntryFor(
	selection: string,
	at: Pick<StoryAt, 'glossary'>
): GlossaryEntryAt | undefined {
	return at.glossary.find((entry) =>
		[entry.name, ...entry.alsoCalled].some((name) => selectionIsName(selection, name))
	);
}

/** The Ordinal of the furthest Word a reader has reached, from what's on screen and what's saved. */
export function reachedOrdinal(
	revisionId: string,
	...points: ({ revisionId: string; ordinal: number } | null | undefined)[]
): number {
	let reached = -1;
	for (const point of points) {
		if (point && point.revisionId === revisionId) reached = Math.max(reached, point.ordinal);
	}
	return reached;
}
