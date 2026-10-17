/**
 * What the UI sees from the Backend (IMPLEMENTATION-PLAN.md §4.6 rule 3): DTOs validated by
 * these schemas, never an implementation's internal records. The Phase 2 API returns the same.
 */
import { z } from 'zod';
import { moneySchema } from '../money';

const id = z.string().min(1);
const timestamp = z.iso.datetime();

/** `users.role` (§6.4, §10.6). Creators publish Products; moderators and admins review Flags. */
export const roles = ['reader', 'creator', 'moderator', 'admin'] as const;
export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;

/** The creator's answer to "Was AI used to make this?" (§10.6). */
export const aiUseSchema = z.enum(['none', 'assisted', 'generated']);
export type AiUse = z.infer<typeof aiUseSchema>;

export const productKindSchema = z.enum([
	'book',
	'illustration_pack',
	'audio_track',
	'cover',
	'bookmark_design',
	'bundle',
	// SIMULATION: a placeholder for OPEN-10 (Chapter-range Products for early-access serial
	// Chapters): a Book's early-access Chapters as one Product, granted by Creator Subscriptions
	// and never sold on its own in the PoC (P1-STO-04).
	'early_access'
]);
export type ProductKind = z.infer<typeof productKindSchema>;

export const entitlementSourceSchema = z.enum([
	'free_claim',
	'purchase',
	'bundle',
	'subscription',
	'grant'
]);
export type EntitlementSource = z.infer<typeof entitlementSourceSchema>;

export const userSchema = z.object({
	id,
	displayName: z.string().min(1),
	role: roleSchema,
	/** Set when the user is a Creator. */
	creatorId: id.nullable()
});
export type UserDto = z.infer<typeof userSchema>;

export const sessionSchema = z.object({ user: userSchema.nullable() });
export type SessionDto = z.infer<typeof sessionSchema>;

/** A seeded user the owner can switch to in development builds (§2 Persona). PoC only. */
export const personaSchema = z.object({
	id,
	label: z.string().min(1),
	description: z.string(),
	user: userSchema
});
export type PersonaDto = z.infer<typeof personaSchema>;

export const creatorSchema = z.object({
	id,
	handle: z.string().min(1),
	displayName: z.string().min(1),
	bio: z.string()
});
export type CreatorDto = z.infer<typeof creatorSchema>;

export const productSchema = z.object({
	id,
	kind: productKindSchema,
	bookId: id.nullable(),
	creatorId: id,
	isOfficial: z.boolean(),
	price: moneySchema
});
export type ProductDto = z.infer<typeof productSchema>;

/**
 * SIMULATION: a placeholder scheme until OPEN-12 decides the age policy and rating scheme.
 * Set by the Book's creator (§10.4).
 */
export const contentRatings = ['all_ages', 'teen', 'mature'] as const;
export const contentRatingSchema = z.enum(contentRatings);
export type ContentRating = z.infer<typeof contentRatingSchema>;

export const bookSummarySchema = z.object({
	id,
	slug: z.string().min(1),
	title: z.string().min(1),
	creatorId: id,
	creatorName: z.string(),
	lang: z.string().min(2),
	aiUse: aiUseSchema,
	/** Static path or URL; resolved by the app against its own origin. */
	coverUrl: z.string().nullable(),
	/** The Book's own Product (not Bundles). */
	price: moneySchema,
	contentRating: contentRatingSchema,
	/** It has listed Illustration Packs or a narration Audio Track (badges on cards). */
	hasIllustrations: z.boolean(),
	hasNarration: z.boolean(),
	/** The signed-in reader holds its Book Product. */
	inLibrary: z.boolean()
});
export type BookSummaryDto = z.infer<typeof bookSummarySchema>;

export const bookDetailSchema = bookSummarySchema.extend({
	description: z.string(),
	creator: creatorSchema,
	products: z.array(productSchema),
	contentWarnings: z.array(z.string())
});
export type BookDetailDto = z.infer<typeof bookDetailSchema>;

export const entitlementSchema = z.object({
	id,
	productId: id,
	source: entitlementSourceSchema,
	grantedAt: timestamp,
	/** The Bundle Entitlement that granted it (§6.5): refunding the Bundle revokes it. */
	parentId: id.nullable().default(null)
});
export type EntitlementDto = z.infer<typeof entitlementSchema>;

/** One Book in the user's library, with the Entitlements that put it there (§10.1). */
export const libraryEntrySchema = z.object({
	book: bookSummarySchema,
	entitlements: z.array(entitlementSchema).min(1)
});
export type LibraryEntryDto = z.infer<typeof libraryEntrySchema>;

/** What a Flag points at (§10.6, `moderation_flags.target_type`); readers' reviews from P1-STO-07. */
export const flagTargetTypeSchema = z.enum([
	'book',
	'illustration_pack',
	'audio_track',
	'creator',
	'review'
]);
export type FlagTargetType = z.infer<typeof flagTargetTypeSchema>;

/** The automatic and manual Flag rules (§10.6). */
export const flagRuleSchema = z.enum([
	'upload_volume',
	'ai_untagged_suspected',
	'report',
	'rapid_new_account'
]);
export type FlagRule = z.infer<typeof flagRuleSchema>;

export const flagStateSchema = z.enum(['open', 'cleared', 'actioned']);
export type FlagState = z.infer<typeof flagStateSchema>;

/** One item in the admin review queue (§10.6). */
export const flagSchema = z.object({
	id,
	targetType: flagTargetTypeSchema,
	targetId: id,
	/** The target's name, for the queue (a Book or pack title, a Creator's display name). */
	targetTitle: z.string(),
	rule: flagRuleSchema,
	state: flagStateSchema,
	/** Higher first; several reports on one item raise it. */
	priority: z.number().int().nonnegative(),
	/** What fired the rule, in plain language. */
	details: z.string(),
	createdAt: timestamp
});
export type FlagDto = z.infer<typeof flagSchema>;

/**
 * A Chapter the reader can't open yet (P1-STO-01 samples, P1-STO-04 early access, P1-STU-06 a
 * serial's Chapters still to come). Locked content always explains itself: whose it is, when it
 * comes out or becomes free, and how to get it.
 */
export const lockedChapterSchema = z.object({
	chapterId: id,
	reason: z.enum(['sample', 'early_access', 'scheduled']),
	/** When early access ends and it becomes free for every owner. */
	freeAt: timestamp.nullable(),
	/** When a scheduled Chapter comes out (`scheduled`). */
	releaseAt: timestamp.nullable().default(null),
	/** The plan that opens it now (early access). */
	planId: id.nullable(),
	creatorName: z.string(),
	creatorHandle: z.string()
});
export type LockedChapterDto = z.infer<typeof lockedChapterSchema>;

/**
 * An opened Book (§10.3): which Revision to read, and a short-lived content token for reading its
 * files. In Phase 2 the token is an HMAC-signed path prefix under /v1/content; the reader asks
 * again before it expires.
 */
export const openBookSchema = z.object({
	bookId: id,
	/** Its store page, for links from the reader ("Get the book", "See it in the store"). */
	slug: id,
	revisionId: id,
	title: z.string(),
	creatorName: z.string(),
	lang: z.string().min(2),
	contentToken: z.string().min(16),
	expiresAt: timestamp,
	/** `sample`: "Read sample" for a reader who doesn't own the Book (P1-STO-01). */
	access: z.enum(['full', 'sample']).default('full'),
	/**
	 * Chapters this reader can't open yet, in reading order: the rest of the Book in a sample,
	 * early-access Chapters (P1-STO-04), or Chapters still to come (P1-STU-06), which are always
	 * the last. Their files can't be read under the token.
	 */
	locked: z.array(lockedChapterSchema).default([])
});
export type OpenBookDto = z.infer<typeof openBookSchema>;
