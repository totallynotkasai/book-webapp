/**
 * Focus mode (P1-RDR-11, DESIGN.md §4.9): one paragraph bright, the rest dimmed, moved on a
 * paragraph at a time. A paragraph is a run of a Chapter's Words in the same Block, so a heading,
 * a list item or a table cell counts as one too. These decide where focus goes and when the page
 * has to turn for it; the reader does the turning. Plain functions, tested without a reader.
 */
import type { ChapterText } from '@book/reader-core';

/** A paragraph as Ordinals on the open Revision, with its first and last Words' ids. */
export interface Paragraph {
	first: number;
	last: number;
	firstWordId: number;
	lastWordId: number;
}

/** The Words on screen, as Ordinals. */
export interface Page {
	first: number;
	last: number;
}

export function paragraphsOf(text: ChapterText): Paragraph[] {
	const out: Paragraph[] = [];
	const { blocks, wordIds, firstOrdinal } = text;
	for (let i = 0; i < blocks.length; i++) {
		const run = out.at(-1);
		if (run && blocks[i] === blocks[i - 1]) {
			run.last = firstOrdinal + i;
			run.lastWordId = wordIds[i]!;
		} else {
			out.push({
				first: firstOrdinal + i,
				last: firstOrdinal + i,
				firstWordId: wordIds[i]!,
				lastWordId: wordIds[i]!
			});
		}
	}
	return out;
}

/** The paragraph holding an Ordinal, or -1. */
export function paragraphAt(paragraphs: readonly Paragraph[], ordinal: number): number {
	let lo = 0;
	let hi = paragraphs.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const p = paragraphs[mid]!;
		if (ordinal < p.first) hi = mid - 1;
		else if (ordinal > p.last) lo = mid + 1;
		else return mid;
	}
	return -1;
}

/**
 * Where focus starts on a page: the first paragraph that begins on it, or, when the whole page
 * is one paragraph carried over from before, that one. `end` starts from the page's end instead
 * (stepping back into it from the next Chapter).
 */
export function focusOnPage(
	paragraphs: readonly Paragraph[],
	page: Page,
	end: 'start' | 'end' = 'start'
): number {
	const at = paragraphAt(paragraphs, end === 'start' ? page.first : page.last);
	if (at < 0) return paragraphs.length ? (end === 'start' ? 0 : paragraphs.length - 1) : -1;
	if (end === 'end') return at;
	const p = paragraphs[at]!;
	return p.first < page.first &&
		at + 1 < paragraphs.length &&
		paragraphs[at + 1]!.first <= page.last
		? at + 1
		: at;
}

/**
 * The next (+1) or previous (-1) step from the focused paragraph:
 * - `turn`: the paragraph goes on past the page (or began before it): turn the page, keep focus;
 * - `focus`: focus the neighbouring paragraph, turning the page first if it isn't on this one;
 * - `chapter`: there is none in this Chapter: turn into the next or previous one.
 */
export type FocusStep =
	{ kind: 'turn' } | { kind: 'focus'; index: number; turn: boolean } | { kind: 'chapter' };

export function step(
	paragraphs: readonly Paragraph[],
	index: number,
	page: Page,
	dir: 1 | -1
): FocusStep {
	const p = paragraphs[index];
	if (!p) return { kind: 'chapter' };
	if (dir > 0 ? p.last > page.last : p.first < page.first) return { kind: 'turn' };
	const next = paragraphs[index + dir];
	if (!next) return { kind: 'chapter' };
	return {
		kind: 'focus',
		index: index + dir,
		turn: dir > 0 ? next.first > page.last : next.last < page.first
	};
}

/** Each Chapter's paragraphs, worked out once. */
export class ParagraphCache {
	readonly #chapters = new Map<string, Promise<Paragraph[]>>();
	readonly #load: (chapterId: string) => Promise<ChapterText>;

	constructor(load: (chapterId: string) => Promise<ChapterText>) {
		this.#load = load;
	}

	get(chapterId: string): Promise<Paragraph[]> {
		let paragraphs = this.#chapters.get(chapterId);
		if (!paragraphs) {
			paragraphs = this.#load(chapterId).then(paragraphsOf);
			paragraphs.catch(() => this.#chapters.delete(chapterId));
			this.#chapters.set(chapterId, paragraphs);
		}
		return paragraphs;
	}
}
