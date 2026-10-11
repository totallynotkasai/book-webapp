/**
 * Anchors: the only way anything attaches to a Book's text (docs/DESIGN.md §6.1, Invariant 2).
 *
 * WordIds give identity (an unchanged Word keeps its ID across Revisions); Ordinals give order
 * (position in one Revision's reading order). Pages, CFIs and character offsets are never stored.
 */

/** Unique within a Book across all Revisions. Never reused. Not a position (Invariant 4). */
export type WordId = number;

/** W3C Web Annotation TextQuoteSelector. prefix/suffix: up to 32 characters of surrounding text. */
export interface TextQuote {
	exact: string;
	prefix: string;
	suffix: string;
}

export interface PointAnchor {
	kind: 'point';
	bookId: string;
	/** The Revision this Anchor was created on or last migrated to. */
	revisionId: string;
	wordId: WordId;
	/** Position of `wordId` in `revisionId`'s reading order. */
	ordinal: number;
	/** `exact` is the Word itself. */
	quote: TextQuote;
}

export interface RangeAnchor {
	kind: 'range';
	bookId: string;
	revisionId: string;
	startWordId: WordId;
	/** Inclusive. */
	endWordId: WordId;
	startOrdinal: number;
	endOrdinal: number;
	quote: TextQuote;
}

export type Anchor = PointAnchor | RangeAnchor;

/** Result of re-anchoring after a new Revision (§6.2). */
export type AnchorStatus = 'ok' | 'migrated' | 'orphaned';

/** Thrown when Anchors from different Books or Revisions are compared (Invariant 4). */
export class AnchorRevisionMismatchError extends Error {
	constructor(a: Anchor, b: Anchor) {
		super(
			`Cannot compare Anchors from different Revisions (${a.bookId}/${a.revisionId}, ${b.bookId}/${b.revisionId})`
		);
		this.name = 'AnchorRevisionMismatchError';
	}
}

export function startOrdinal(anchor: Anchor): number {
	return anchor.kind === 'point' ? anchor.ordinal : anchor.startOrdinal;
}

export function endOrdinal(anchor: Anchor): number {
	return anchor.kind === 'point' ? anchor.ordinal : anchor.endOrdinal;
}

function assertSameRevision(a: Anchor, b: Anchor): void {
	if (a.bookId !== b.bookId || a.revisionId !== b.revisionId) {
		throw new AnchorRevisionMismatchError(a, b);
	}
}

/**
 * Orders two Anchors in reading order: negative if `a` comes first, positive if `b` does, 0 if
 * they cover the same Words. Ranges are ordered by start, then by end.
 * Throws if they belong to different Revisions, since their Ordinals aren't comparable.
 */
export function compareAnchors(a: Anchor, b: Anchor): number {
	assertSameRevision(a, b);
	return startOrdinal(a) - startOrdinal(b) || endOrdinal(a) - endOrdinal(b);
}

export function isAtOrBefore(a: Anchor, b: Anchor): boolean {
	return compareAnchors(a, b) <= 0;
}

/** True if every Word of `anchor` falls inside `range` (inclusive at both ends). */
export function isWithinRange(anchor: Anchor, range: RangeAnchor): boolean {
	assertSameRevision(anchor, range);
	return range.startOrdinal <= startOrdinal(anchor) && endOrdinal(anchor) <= range.endOrdinal;
}

/** True if the two Anchors share any Word. */
export function rangesOverlap(a: Anchor, b: Anchor): boolean {
	assertSameRevision(a, b);
	return startOrdinal(a) <= endOrdinal(b) && startOrdinal(b) <= endOrdinal(a);
}

/**
 * Returns the item whose Anchor starts latest at or before `position`, or undefined if none.
 *
 * This is the spoiler-safe "current Illustration" rule (§8.2, Invariant 6): pass the last
 * visible Word as `position` and nothing anchored ahead of the reader can be returned.
 * Ties (same start) go to the item listed first, so callers control priority by order.
 */
export function latestAtOrBefore<T>(
	items: readonly T[],
	position: PointAnchor,
	getAnchor: (item: T) => Anchor
): T | undefined {
	let best: T | undefined;
	let bestStart = -Infinity;
	for (const item of items) {
		const anchor = getAnchor(item);
		assertSameRevision(anchor, position);
		const start = startOrdinal(anchor);
		if (start <= position.ordinal && start > bestStart) {
			best = item;
			bestStart = start;
		}
	}
	return best;
}
