/**
 * The story so far in the Studio and the backend (DESIGN.md §4.9; P1-STU-05): where each glossary
 * name first appears in a Revision's text, and what stops a story being published. Shared by
 * `backend-local` now and the API in Phase 6.
 */
import type { AiUse, RangeAnchor } from '@book/core';
import { foldName, nameWords, wordMatches } from './story';

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
				const lower = foldName(text)
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

	/**
	 * The name's first occurrence in reading order, or null when it isn't in the text. With
	 * `chapterId`, its first in that Chapter (a seeded comment's passage, P1-COM-03).
	 */
	find(name: string, chapterId?: string): NameOccurrence | null {
		const words = nameWords(name);
		const k = words.length;
		if (!k) return null;
		for (const start of this.#at.get(words[0]!.toLowerCase()) ?? []) {
			const end = start + k - 1;
			if (end >= this.#texts.length || this.#chapterIds[end] !== this.#chapterIds[start]) continue;
			if (chapterId !== undefined && this.#chapterIds[start] !== chapterId) continue;
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

	/**
	 * The Words from one Ordinal to another, inclusive, as an occurrence (a popular highlight's
	 * passage, P1-COM-04); null when either isn't a Word or they're in different Chapters.
	 */
	between(startOrdinal: number, endOrdinal: number): NameOccurrence | null {
		const start = this.#positionOf(startOrdinal);
		const end = this.#positionOf(endOrdinal);
		if (start < 0 || end < start || this.#chapterIds[start] !== this.#chapterIds[end]) return null;
		return this.#occurrence(start, end);
	}

	/** Where an Ordinal's Word is in reading order, or -1. */
	#positionOf(ordinal: number): number {
		let lo = 0;
		let hi = this.#ordinals.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const at = this.#ordinals[mid]!;
			if (at === ordinal) return mid;
			if (at < ordinal) lo = mid + 1;
			else hi = mid - 1;
		}
		return -1;
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
