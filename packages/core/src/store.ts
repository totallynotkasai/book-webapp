/**
 * The store's DTOs (DESIGN.md §6.5, P1-STO-01 to P1-STO-04): what a Book page offers, orders,
 * Bookmark Designs, Creator Subscription plans, subscriptions and Tips, and which Chapters a
 * reader can't open yet. Money is integer minor units (Invariant 17); every access decision
 * behind these is made by the Entitlements rules in `@book/domain` (Invariant 15).
 */
import { z } from 'zod';
import { bookDetailSchema, productKindSchema } from './backend/dto';
import { audioTrackSummarySchema, illustrationImageSchema, layerSummarySchema } from './layers';
import { moneySchema } from './money';

const id = z.string().min(1);
const timestamp = z.iso.datetime();

/** A curated row on the store's front page (P1-STO-01). */
export const shelfSchema = z.object({
	id,
	title: z.string().min(1),
	description: z.string(),
	bookIds: z.array(id)
});
export type ShelfDto = z.infer<typeof shelfSchema>;

/**
 * Something a Book page offers (§6.5): the Complete edition (a Bundle of the Book and its
 * official Layers) or the Book alone. `priceForYou` takes off what the reader already owns.
 */
export const offerSchema = z.object({
	productId: id,
	kind: z.enum(['bundle', 'book']),
	label: z.string().min(1),
	/** The Products it grants, the Bundle's children included. */
	includes: z.array(id).min(1),
	price: moneySchema,
	priceForYou: moneySchema,
	/** Everything in it is already in the reader's library. */
	owned: z.boolean()
});
export type OfferDto = z.infer<typeof offerSchema>;

/** A spoiler-safe Illustration for a store page (Invariant 6), read with the previews token. */
export const illustrationPreviewSchema = z.object({
	id,
	packId: id,
	packName: z.string(),
	alt: z.string().min(1),
	caption: z.string().optional(),
	credit: z.string().optional(),
	image: illustrationImageSchema
});
export type IllustrationPreviewDto = z.infer<typeof illustrationPreviewSchema>;

export const previewsSchema = z.object({
	illustrations: z.array(illustrationPreviewSchema),
	/** Reads only these images (§10.3). */
	contentToken: z.string().min(16),
	expiresAt: timestamp
});
export type PreviewsDto = z.infer<typeof previewsSchema>;

/** A short piece of the narration, playable without owning it (P1-STO-01). */
export const narrationSampleSchema = z.object({
	track: audioTrackSummarySchema,
	chapterId: id,
	chapterTitle: z.string(),
	/** SIMULATION: a static file, like `openTrack`'s audio (Phase 2: a signed URL). */
	audioUrl: id,
	startMs: z.number().int().nonnegative(),
	durationMs: z.number().int().positive()
});
export type NarrationSampleDto = z.infer<typeof narrationSampleSchema>;

/** One line of an order, with the price paid (copied, so later price changes don't rewrite it). */
export const orderItemSchema = z.object({
	productId: id,
	kind: productKindSchema,
	title: z.string(),
	price: moneySchema
});

/** A purchase or a free claim (§6.5). Simulated: no money moves. */
export const orderSchema = z.object({
	id,
	status: z.enum(['paid', 'claimed', 'refunded']),
	items: z.array(orderItemSchema).min(1),
	total: moneySchema,
	createdAt: timestamp,
	refundedAt: timestamp.nullable(),
	/** The Book it's for, if any, for "Read now". */
	bookId: id.nullable()
});
export type OrderDto = z.infer<typeof orderSchema>;

/** A Bookmark Design (§6.5): a cosmetic that works in every Book, however it was obtained. */
export const bookmarkDesignSchema = z.object({
	productId: id,
	name: z.string().min(1),
	description: z.string(),
	creatorName: z.string(),
	price: moneySchema,
	/** How it's drawn: the ribbon's shape and colours, and an optional mark on it. */
	look: z.object({
		shape: z.enum(['ribbon', 'notched', 'tab']),
		colour: z.string().regex(/^#[0-9a-f]{6}$/),
		accent: z.string().regex(/^#[0-9a-f]{6}$/),
		mark: z.enum(['none', 'heart', 'star', 'flame', 'key']).default('none')
	}),
	owned: z.boolean(),
	/** Everyone owns this one from the start. */
	isDefault: z.boolean()
});
export type BookmarkDesignDto = z.infer<typeof bookmarkDesignSchema>;

/** What a Creator Subscription plan gives while it's active (§6.5; OPEN-10 and OPEN-11). */
export const planBenefitSchema = z.object({
	kind: z.literal('early_access'),
	bookId: id,
	bookTitle: z.string(),
	description: z.string()
});

export const planSchema = z.object({
	id,
	creatorId: id,
	creatorName: z.string(),
	name: z.string().min(1),
	description: z.string(),
	/** Per month. */
	price: moneySchema,
	benefits: z.array(planBenefitSchema)
});
export type PlanDto = z.infer<typeof planSchema>;

export const subscriptionSchema = z.object({
	id,
	plan: planSchema,
	/** `active` renews; `cancelled` still gives its benefits until `currentPeriodEnd`. */
	status: z.enum(['active', 'cancelled', 'ended']),
	startedAt: timestamp,
	currentPeriodEnd: timestamp,
	endedAt: timestamp.nullable()
});
export type SubscriptionDto = z.infer<typeof subscriptionSchema>;

/** A one-off payment to a Creator (§6.5). It grants nothing and isn't a Product. */
export const tipSchema = z.object({
	id,
	creatorId: id,
	creatorName: z.string(),
	bookId: id.nullable(),
	amount: moneySchema,
	message: z.string().max(280).nullable(),
	createdAt: timestamp
});
export type TipDto = z.infer<typeof tipSchema>;

export const tipInputSchema = z.object({
	creatorId: id,
	bookId: id.nullable().default(null),
	amount: moneySchema.refine((m) => m.amountMinor >= 50 && m.amountMinor <= 50_000, {
		message: 'A Tip is between 0.50 and 500.00'
	}),
	message: z.string().max(280).nullable().default(null),
	idempotencyKey: z.string().min(8)
});
export type TipInput = z.input<typeof tipInputSchema>;

/** A Book page (P1-STO-01): the Book, its Layers, what it offers, and the reader's place in it. */
export const bookPageSchema = bookDetailSchema.extend({
	layers: z.array(layerSummarySchema),
	/** The primary offer first: the Complete edition when there is one (plan §6 Phase 1.6). */
	offers: z.array(offerSchema).min(1),
	inLibrary: z.boolean(),
	/** "Read sample" is offered. */
	hasSample: z.boolean(),
	/** The Creator's plans, for "Subscribe" next to their name. */
	planIds: z.array(id),
	/** Its Chapters come out over time (a serial) and may be early access. */
	isSerial: z.boolean(),
	/** When its next scheduled Chapter comes out (P1-STU-06): "Next chapter: Friday 24 October". */
	nextChapterAt: timestamp.nullable().default(null)
});
export type BookPageDto = z.infer<typeof bookPageSchema>;
