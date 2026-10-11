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
	'bundle'
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
	price: moneySchema
});
export type BookSummaryDto = z.infer<typeof bookSummarySchema>;

export const bookDetailSchema = bookSummarySchema.extend({
	description: z.string(),
	creator: creatorSchema,
	products: z.array(productSchema)
});
export type BookDetailDto = z.infer<typeof bookDetailSchema>;

export const entitlementSchema = z.object({
	id,
	productId: id,
	source: entitlementSourceSchema,
	grantedAt: timestamp
});
export type EntitlementDto = z.infer<typeof entitlementSchema>;

/** One Book in the user's library, with the Entitlements that put it there (§10.1). */
export const libraryEntrySchema = z.object({
	book: bookSummarySchema,
	entitlements: z.array(entitlementSchema).min(1)
});
export type LibraryEntryDto = z.infer<typeof libraryEntrySchema>;

export const studioBookSchema = bookSummarySchema.extend({
	listingState: z.enum(['draft', 'listed', 'delisted'])
});
export type StudioBookDto = z.infer<typeof studioBookSchema>;
