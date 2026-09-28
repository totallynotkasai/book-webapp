/**
 * The anchoring model (design doc §5.3).
 *
 * Page numbers are display-only and never stored. Everything attached to a book
 * (illustrations, audio, bookmarks, notes, progress) points at a text position.
 */

/** A single point in the text of a specific edition. */
export type Locator = {
	/** Specific version of the book text. */
	editionId: string;
	/** EPUB Canonical Fragment Identifier, used by the reader engine to navigate. */
	cfi: string;
	/** Stable ID assigned to each block-level element at ingest. */
	paragraphId: string;
	/**
	 * Position of the paragraph in reading order, assigned at ingest.
	 * Stored alongside `paragraphId` so locators can be ordered without the book loaded.
	 */
	paragraphIndex: number;
	/** Character offset within the paragraph. */
	charOffset: number;
	/** Fallback for re-anchoring after the author edits the text. */
	textQuote?: TextQuote;
};

export type TextQuote = {
	exact: string;
	prefix: string;
	suffix: string;
};

/**
 * A span of text between two locators (inclusive).
 * Named `TextRange` to avoid clashing with the DOM's built-in `Range`.
 */
export type TextRange = {
	start: Locator;
	end: Locator;
};

/**
 * Orders two locators in reading order: negative if `a` comes first, positive if `b` does, 0 if equal.
 * Throws if they belong to different editions, since their positions aren't comparable.
 */
export function compareLocators(a: Locator, b: Locator): number {
	if (a.editionId !== b.editionId) {
		throw new Error(
			`Cannot compare locators from different editions (${a.editionId}, ${b.editionId})`
		);
	}
	return a.paragraphIndex - b.paragraphIndex || a.charOffset - b.charOffset;
}

export function isAtOrBefore(a: Locator, b: Locator): boolean {
	return compareLocators(a, b) <= 0;
}

/** True if `locator` falls inside `range` (inclusive at both ends). */
export function isWithinRange(locator: Locator, range: TextRange): boolean {
	return compareLocators(range.start, locator) <= 0 && compareLocators(locator, range.end) <= 0;
}

/** True if the two ranges share any text. */
export function rangesOverlap(a: TextRange, b: TextRange): boolean {
	return compareLocators(a.start, b.end) <= 0 && compareLocators(b.start, a.end) <= 0;
}

/**
 * Returns the item with the latest anchor at or before `position`, or undefined if none.
 *
 * This is the spoiler-safe display rule used by the illustration panel (§3.2): nothing
 * anchored ahead of the reader is ever returned.
 */
export function latestAtOrBefore<T>(
	items: readonly T[],
	position: Locator,
	getLocator: (item: T) => Locator
): T | undefined {
	let best: T | undefined;
	let bestLocator: Locator | undefined;
	for (const item of items) {
		const locator = getLocator(item);
		if (!isAtOrBefore(locator, position)) continue;
		if (!bestLocator || compareLocators(locator, bestLocator) >= 0) {
			best = item;
			bestLocator = locator;
		}
	}
	return best;
}
