/**
 * User-owned records (docs/DESIGN.md §6.3) and the Layer records they refer to (§8).
 * Glossary terms (§2) are used exactly: Revision, Placed Bookmark, Illustration Pack, …
 */
import type { Anchor, AnchorStatus, PointAnchor, RangeAnchor } from './anchor';
import type { AiUse } from './backend/dto';
import type { Timestamp } from './ids';

/** Fields every user-owned record carries, so it can sync in Phase 2 (§6.3). */
export interface UserRecord {
	/** UUIDv7, generated on the device. */
	id: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
	/** Soft delete (tombstone), so deletions can sync. Null while the record is live. */
	deletedAt: Timestamp | null;
}

/** The five highlight colours; their values are theme tokens (§11.2). */
export type HighlightColour = 1 | 2 | 3 | 4 | 5;

/** A highlight, optionally with a note, on a RangeAnchor (§9.3). */
export interface Annotation extends UserRecord {
	bookId: string;
	anchor: RangeAnchor;
	anchorStatus: AnchorStatus;
	colour: HighlightColour;
	/** Optional note. Undefined for a plain highlight. */
	note?: string;
}

/** A user's saved position, drawn with one of their Bookmark Designs (§9.3). */
export interface PlacedBookmark extends UserRecord {
	bookId: string;
	anchor: PointAnchor;
	anchorStatus: AnchorStatus;
	label?: string;
	/** The Bookmark Design Product to draw it with. Undefined means the user's default design. */
	bookmarkDesignProductId?: string;
}

/**
 * Current and furthest position in a Book (§9.5). One per Book, so `bookId` is its identity.
 * The furthest Anchor gates spoiler-sensitive features; the furthest progression is a number
 * for reviews and refund rules (§6.4).
 */
export interface ReadingProgress {
	bookId: string;
	current: PointAnchor;
	/** 0..1 across the whole Book. */
	progression: number;
	furthest: PointAnchor;
	furthestProgression: number;
	deviceId?: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
	deletedAt: Timestamp | null;
}

/** A Book imported from the user's own EPUB (§4.6, §6.3). `id` is the Book's `bookId`. */
export interface LibraryBook extends UserRecord {
	title: string;
	creatorName?: string;
	/** BCP 47 language tag from the OPF. */
	lang: string;
	currentRevisionId: string;
	source: 'import';
}

/** One processed Revision of an imported Book. `id` is the SHA-256 of the EPUB file (§6.3). */
export interface LibraryRevision extends UserRecord {
	bookId: string;
	chapterCount: number;
	wordCount: number;
}

/** Which Layers a user has on for a Book (§8.1). One per Book. */
export interface LayerSelection {
	bookId: string;
	/** In priority order. */
	illustrationPackIds: string[];
	/** At most one narration Audio Track at a time. */
	narrationTrackId: string | null;
	createdAt: Timestamp;
	updatedAt: Timestamp;
	deletedAt: Timestamp | null;
}

/** A set of Illustrations for one Book by one Creator (§2). Served through `Backend.layers`. */
export interface IllustrationPack {
	id: string;
	bookId: string;
	creatorId: string;
	name: string;
	isOfficial: boolean;
	aiUse: AiUse;
}

/** An image attached to an Anchor (§8.2). */
export interface Illustration {
	id: string;
	packId: string;
	anchor: Anchor;
	/** Used in `in-text` mode. */
	placement: 'panel' | 'inline' | 'full_page';
	span: 'single' | 'double';
	assetId: string;
	/** Required before an Illustration can be published. */
	alt: string;
	caption?: string;
	credit?: string;
	/** Only these may appear on store pages (Invariant 6). */
	spoilerSafe: boolean;
}
