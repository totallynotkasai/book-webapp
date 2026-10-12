/**
 * Illustration Packs as files (DESIGN.md §8.2, P1-LAY-01, P1-LAY-06): the `pack.json` that
 * `tools/build-packs` writes and `backend-local` serves, and the Illustration records the reader
 * gets from `Backend.layers`. Validated with Zod at the boundary, like every DTO.
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

/** A Layer as `Backend.layers.list` shows it: enough for the Layers menu (P1-LAY-07). */
export const layerSummarySchema = z.object({
	id,
	kind: z.literal('illustration_pack'),
	bookId: id,
	/** The Product that grants it. */
	productId: id,
	name: z.string().min(1),
	description: z.string(),
	creatorId: id,
	creatorName: z.string(),
	isOfficial: z.boolean(),
	aiUse: aiUseSchema,
	credit: z.string(),
	illustrationCount: int.nonnegative(),
	price: moneySchema,
	/** Whether the signed-in user holds an Entitlement to it (§8.1). */
	entitled: z.boolean()
});
export type LayerSummaryDto = z.infer<typeof layerSummarySchema>;

/** An opened pack: its Illustrations, and a content token for its images (§10.3). */
export const openPackSchema = z.object({
	pack: layerSummarySchema,
	/** The Revision its Anchors are on; Illustrations on another one need migrating first. */
	revisionId: id,
	illustrations: z.array(illustrationSchema),
	contentToken: z.string().min(16),
	expiresAt: z.iso.datetime()
});
export type OpenPackDto = z.infer<typeof openPackSchema>;
