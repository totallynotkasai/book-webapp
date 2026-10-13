/**
 * Layers as files and DTOs (DESIGN.md §8): Illustration Packs (§8.2, P1-LAY-01, P1-LAY-06), the
 * `pack.json` that `tools/build-packs` writes, and narration Audio Tracks (§8.3, P1-LAY-04), the
 * `track.json` that `tools/align` writes; plus what the reader gets from `Backend.layers`.
 * Validated with Zod at the boundary, like every DTO.
 */
import { z } from 'zod';
import { aiUseSchema } from './backend/dto';
import { moneySchema } from './money';

const id = z.string().min(1);
const int = z.number().int();

export const textQuoteSchema = z.object({
	exact: z.string(),
	prefix: z.string(),
	suffix: z.string()
});

export const pointAnchorSchema = z.object({
	kind: z.literal('point'),
	bookId: id,
	revisionId: id,
	wordId: int.positive(),
	ordinal: int.nonnegative(),
	quote: textQuoteSchema
});

export const rangeAnchorSchema = z.object({
	kind: z.literal('range'),
	bookId: id,
	revisionId: id,
	startWordId: int.positive(),
	endWordId: int.positive(),
	startOrdinal: int.nonnegative(),
	endOrdinal: int.nonnegative(),
	quote: textQuoteSchema
});

export const illustrationPlacements = ['panel', 'inline', 'full_page'] as const;
export type IllustrationPlacement = (typeof illustrationPlacements)[number];

/** An image, prepared offline: WebP widths to choose from, and a colour to show while it loads. */
export const illustrationImageSchema = z.object({
	width: int.positive(),
	height: int.positive(),
	dominant: z.string().regex(/^#[0-9a-f]{6}$/),
	/** Ascending by width; paths are relative to the pack. */
	variants: z.array(z.object({ width: int.positive(), path: id })).min(1)
});

export const illustrationSchema = z.object({
	id,
	/** The passage it illustrates. Its start decides when it becomes current (§8.2). */
	anchor: rangeAnchorSchema,
	/** Used in `in-text` mode. */
	placement: z.enum(illustrationPlacements),
	span: z.enum(['single', 'double']),
	alt: z.string().min(1),
	caption: z.string().optional(),
	credit: z.string().optional(),
	/** Only these may appear on store pages (Invariant 6). */
	spoilerSafe: z.boolean(),
	image: illustrationImageSchema
});
export type IllustrationDto = z.infer<typeof illustrationSchema>;

export const ILLUSTRATION_PACK_FILE_VERSION = 1;

export const illustrationPackFileSchema = z.object({
	version: z.literal(ILLUSTRATION_PACK_FILE_VERSION),
	id,
	bookId: id,
	/** The Revision its Anchors are on. */
	revisionId: id,
	creatorId: id,
	name: z.string().min(1),
	description: z.string(),
	isOfficial: z.boolean(),
	aiUse: aiUseSchema,
	credit: z.string(),
	/** In reading order. */
	illustrations: z.array(illustrationSchema)
});
export type IllustrationPackFile = z.infer<typeof illustrationPackFileSchema>;

/** Readers' ratings of a Layer (P1-COM-02): one per reader, 1–5 stars. */
export const ratingSummarySchema = z.object({
	/** 1–5, to one decimal place. */
	average: z.number().min(1).max(5),
	count: z.number().int().positive()
});
export type RatingSummaryDto = z.infer<typeof ratingSummarySchema>;

const layerBase = {
	id,
	bookId: id,
	/** The Product that grants it. */
	productId: id,
	name: z.string().min(1),
	description: z.string(),
	creatorId: id,
	creatorName: z.string(),
	/** For a link to their profile. */
	creatorHandle: z.string().default(''),
	isOfficial: z.boolean(),
	aiUse: aiUseSchema,
	credit: z.string(),
	price: moneySchema,
	/** Whether the signed-in user holds an Entitlement to it (§8.1). */
	entitled: z.boolean(),
	/** A community Layer the Book's author endorsed ("Author-endorsed", §4.8). */
	endorsed: z.boolean().default(false),
	rating: ratingSummarySchema.nullable().default(null),
	/** The signed-in user's own rating, if they gave one. */
	myRating: z.number().int().min(1).max(5).nullable().default(null)
};

/** An Illustration Pack as `Backend.layers.list` shows it: enough for the Layers menu (P1-LAY-07). */
export const illustrationPackSummarySchema = z.object({
	...layerBase,
	kind: z.literal('illustration_pack'),
	illustrationCount: int.nonnegative()
});
export type IllustrationPackSummaryDto = z.infer<typeof illustrationPackSummarySchema>;

/** A narration Audio Track as `Backend.layers.list` shows it (§8.3, P1-LAY-04). */
export const audioTrackSummarySchema = z.object({
	...layerBase,
	kind: z.literal('audio_track'),
	narrator: z.string().min(1),
	/** Chapters it has audio and a Sync Map for. */
	chapterCount: int.nonnegative(),
	durationMs: int.nonnegative()
});
export type AudioTrackSummaryDto = z.infer<typeof audioTrackSummarySchema>;

/** A Layer of either kind (§2). */
export const layerSummarySchema = z.discriminatedUnion('kind', [
	illustrationPackSummarySchema,
	audioTrackSummarySchema
]);
export type LayerSummaryDto = z.infer<typeof layerSummarySchema>;

/** An opened pack: its Illustrations, and a content token for its images (§10.3). */
export const openPackSchema = z.object({
	pack: illustrationPackSummarySchema,
	/** The Revision its Anchors are on; Illustrations on another one need migrating first. */
	revisionId: id,
	illustrations: z.array(illustrationSchema),
	contentToken: z.string().min(16),
	expiresAt: z.iso.datetime()
});
export type OpenPackDto = z.infer<typeof openPackSchema>;

export const AUDIO_TRACK_FILE_VERSION = 1;

/**
 * An Audio Track as files (§7.2, P1-LAY-03): the `track.json` that `tools/align` writes beside
 * its Sync Maps, one entry per Chapter it covers, in reading order.
 */
export const audioTrackFileSchema = z.object({
	version: z.literal(AUDIO_TRACK_FILE_VERSION),
	id,
	bookId: id,
	/** The Revision its Sync Maps are on. */
	revisionId: id,
	chapters: z.array(
		z.object({
			chapterId: id,
			/** The Chapter's Sync Map, relative to the track. */
			syncMap: id,
			/** Where the Chapter's `.m4a` is served from. */
			audio: id,
			durationMs: int.nonnegative(),
			coverage: z.number().min(0).max(1)
		})
	)
});
export type AudioTrackFile = z.infer<typeof audioTrackFileSchema>;

/**
 * A Chapter's Sync Map status (§7.2 step 6, P1-STU-03): `needs_review` below 0.90 coverage,
 * `stale` once the Book has a newer Revision than the one it was aligned to.
 */
export const syncMapStatusSchema = z.enum(['ready', 'needs_review', 'stale']);
export type SyncMapStatus = z.infer<typeof syncMapStatusSchema>;

/** An opened Audio Track: per Chapter, its Sync Map (read with `content.read`) and its audio. */
export const openTrackSchema = z.object({
	track: audioTrackSummarySchema,
	/** The Revision its Sync Maps are on. */
	revisionId: id,
	chapters: z.array(
		z.object({
			chapterId: id,
			/** Read with `content.read(contentToken, syncMap)`. */
			syncMap: id,
			/**
			 * A URL the platform audio player can stream. Phase 2: a signed URL that expires with
			 * the content token (§10.3).
			 */
			audioUrl: id,
			durationMs: int.nonnegative(),
			coverage: z.number().min(0).max(1),
			status: syncMapStatusSchema
		})
	),
	contentToken: z.string().min(16),
	expiresAt: z.iso.datetime()
});
export type OpenTrackDto = z.infer<typeof openTrackSchema>;
