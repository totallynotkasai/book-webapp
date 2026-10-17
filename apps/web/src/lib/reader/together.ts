/**
 * Readers together in the reader (P1-COM-03, P1-COM-04; plan §6 Phase 1.20 UX notes): which
 * paragraph each comment is beside, the count that paragraph shows, and the popular highlights a
 * reader sees. A paragraph is focus mode's (`focus.ts`): a run of a Chapter's Words in one Block.
 * Plain functions, tested without a reader.
 */
import type { CommentDto, PointAnchor, PopularHighlightDto, RangeAnchor } from '@book/core';
import { paragraphAt, type Paragraph } from './focus';

/** A paragraph with comments: where it is, and its comments in reading order. */
export interface CommentedParagraph {
	/** Its index among the Chapter's paragraphs: what its marker and sheet are known by. */
	index: number;
	paragraph: Paragraph;
	comments: CommentDto[];
	/** Comments and replies, but not a deleted comment's empty place. */
	count: number;
}

/** A Chapter's comments by the paragraph each passage starts in, in reading order. */
export function commentedParagraphs(
	comments: readonly CommentDto[],
	paragraphs: readonly Paragraph[]
): CommentedParagraph[] {
	const byIndex = new Map<number, CommentedParagraph>();
	for (const comment of comments) {
		const index = paragraphAt(paragraphs, comment.anchor.startOrdinal);
		if (index < 0) continue;
		const entry = byIndex.get(index) ?? {
			index,
			paragraph: paragraphs[index]!,
			comments: [],
			count: 0
		};
		entry.comments.push(comment);
		entry.count += (comment.deleted ? 0 : 1) + comment.replies.length;
		byIndex.set(index, entry);
	}
	return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/** "3 comments on this paragraph": a marker's accessible name. */
export function commentCountLabel(count: number): string {
	return `${count} ${count === 1 ? 'comment' : 'comments'} on this paragraph`;
}

/** "12 readers highlighted this". */
export function readersLabel(readers: number): string {
	return `${readers} ${readers === 1 ? 'reader' : 'readers'} highlighted this`;
}

/** A paragraph's first Word: its marker goes at the end of the Block holding it. */
export function paragraphStart(
	paragraph: Paragraph,
	book: { bookId: string; revisionId: string }
): PointAnchor {
	return {
		kind: 'point',
		bookId: book.bookId,
		revisionId: book.revisionId,
		wordId: paragraph.firstWordId,
		ordinal: paragraph.first,
		quote: { exact: '', prefix: '', suffix: '' }
	};
}

/** The whole paragraph, for "Add a comment" on it; its quote is its first Words. */
export function paragraphAnchor(
	paragraph: Paragraph,
	book: { bookId: string; revisionId: string },
	words: readonly string[]
): RangeAnchor {
	return {
		kind: 'range',
		bookId: book.bookId,
		revisionId: book.revisionId,
		startWordId: paragraph.firstWordId,
		endWordId: paragraph.lastWordId,
		startOrdinal: paragraph.first,
		endOrdinal: paragraph.last,
		quote: { exact: words.join(' '), prefix: '', suffix: '' }
	};
}

const PAIRS = [
	['(', ')'],
	['[', ']'],
	['“', '”'],
	['‘', '’']
] as const;
const HANGING = /[,;:]+$/u;

/**
 * A passage quoted from the page's Words, which carry their punctuation: no comma left hanging
 * at its end, and no bracket or quotation mark without its partner ("sleepy and stupid),").
 */
export function tidyPassage(text: string): string {
	let out = text.replace(/\s+/g, ' ').trim().replace(HANGING, '');
	const count = (mark: string) => [...out].filter((c) => c === mark).length;
	for (const [open, close] of PAIRS) {
		while (out.endsWith(close) && count(close) > count(open)) {
			out = out.slice(0, -1).replace(HANGING, '');
		}
		while (out.startsWith(open) && count(open) > count(close)) out = out.slice(1);
	}
	return out.trim();
}

/** "On “a passage”": dialogue keeps its own quotation marks rather than gaining a second pair. */
export function onPassage(text: string): string {
	return /^[“"‘'«„]/u.test(text) ? `On ${text}` : `On “${text}”`;
}

/** The popular passage holding an Ordinal, if any (a tap on an underlined Word). */
export function popularAt(
	passages: readonly PopularHighlightDto[],
	ordinal: number
): PopularHighlightDto | undefined {
	return passages.find((p) => p.anchor.startOrdinal <= ordinal && ordinal <= p.anchor.endOrdinal);
}

/** The most readers any popular passage overlapping a selection has, or 0. */
export function popularReaders(
	passages: readonly PopularHighlightDto[],
	anchor: { startOrdinal: number; endOrdinal: number }
): number {
	let most = 0;
	for (const p of passages) {
		if (p.anchor.startOrdinal <= anchor.endOrdinal && p.anchor.endOrdinal >= anchor.startOrdinal) {
			most = Math.max(most, p.readers);
		}
	}
	return most;
}

/**
 * The popular passages a reader has reached (Invariant 6: nothing ahead of them), most
 * highlighted first, then in reading order: for the list in Notes.
 */
export function popularReached(
	passages: readonly PopularHighlightDto[],
	reachedOrdinal: number
): PopularHighlightDto[] {
	return passages
		.filter((p) => p.anchor.endOrdinal <= reachedOrdinal)
		.sort((a, b) => b.readers - a.readers || a.anchor.startOrdinal - b.anchor.startOrdinal);
}
