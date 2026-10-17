/**
 * The story so far as readers see it (DESIGN.md §4.9, Invariant 6; P1-RDR-13): what a glossary
 * name matches, and what a reader sees of the story at the place they've reached. Shared by the
 * reader and `backend-local` now, and the API in Phase 6. Finding names in a Revision and the
 * publishing rules are in `story-text.ts`, so the reader route doesn't carry them.
 */
import type { ChapterRecord, GlossaryPictureDto, RangeAnchor, StorySoFarDto } from '@book/core';

/** Accents and curly apostrophes don't matter; case is kept (see `wordMatches`). */
export function foldName(text: string): string {
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
	return foldName(name)
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
	const word = foldName(text).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
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
