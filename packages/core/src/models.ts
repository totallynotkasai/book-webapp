import type { Locator, TextRange } from './locator';

/** ISO 8601 timestamp string. Kept as a string so records serialise cleanly to storage and JSON. */
export type Timestamp = string;

export type Bookmark = {
	id: string;
	editionId: string;
	locator: Locator;
	label?: string;
	/** Cosmetic Bookmark Design (§6.5). Undefined means the default design. */
	designId?: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
};

export type HighlightColour = 1 | 2 | 3 | 4 | 5;

export type Annotation = {
	id: string;
	editionId: string;
	range: TextRange;
	kind: 'highlight' | 'note';
	colour: HighlightColour;
	/** Note text. Empty for plain highlights. */
	body: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
};

export type ReadingProgress = {
	editionId: string;
	locator: Locator;
	/** 0 to 1 through the whole book. */
	percent: number;
	/** Furthest point reached. Used for spoiler gating (recaps, glossary, illustration previews). */
	maxLocator: Locator;
	updatedAt: Timestamp;
};

export type Illustration = {
	id: string;
	setId: string;
	locator: Locator;
	imageUrl: string;
	caption?: string;
	credit?: string;
	spoilerSafe: boolean;
};

export type IllustrationSet = {
	id: string;
	bookId: string;
	name: string;
	type: 'official' | 'community';
	aiGenerated: boolean;
};
