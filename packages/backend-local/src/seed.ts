/**
 * Seed data for the simulated backend (IMPLEMENTATION-PLAN.md §4.3): versioned JSON in
 * `fixtures/seed/`, fetched at runtime (never bundled) and validated here before use.
 *
 * These are backend-local's private records, like storage-local's IndexedDB schema, so their
 * schema lives here. What the app sees are the DTOs in `@book/core`.
 */
import {
	aiUseSchema,
	communityAiSchema,
	communityPolicySchema,
	contentRatingSchema,
	entitlementSourceSchema,
	flagRuleSchema,
	flagStateSchema,
	flagTargetTypeSchema,
	moneySchema,
	productKindSchema,
	roleSchema
} from '@book/core';
import { z } from 'zod';

const id = z.string().min(1);

/**
 * A file the simulated backend keeps itself (P1-STU-01, P1-STU-02): a Studio upload in
 * `layerFiles`, or a file of a processed Revision in `content`. Resolved to a URL when shown.
 */
const storedFileRef = z.object({
	store: z.enum(['layerFiles', 'content']),
	/** The Layer ID (or `cover:<bookId>`), or the Revision ID. */
	id,
	path: id
});

const personaRecord = z.object({
	id,
	label: z.string().min(1),
	description: z.string(),
	user: z.object({
		id,
		displayName: z.string().min(1),
		role: roleSchema,
		creatorId: id.nullable()
	})
});

const creatorRecord = z.object({
	id,
	handle: z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and hyphens'),
	displayName: z.string().min(1),
	bio: z.string()
});

const bookRecord = z.object({
	id,
	slug: z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and hyphens'),
	title: z.string().min(1),
	creatorId: id,
	lang: z.string().min(2),
	/** The current Revision's answer to "Was AI used?" (§10.6); null until a Studio publish. */
	aiUse: aiUseSchema.nullable(),
	description: z.string(),
	coverUrl: z.string().nullable(),
	/** A cover the backend keeps (Studio uploads, or the EPUB's own); wins over `coverUrl`. */
	coverFile: storedFileRef.nullable().default(null),
	/**
	 * The published Revision readers open (P1-STU-01). Null for a seeded Book until its author
	 * publishes one: its `epubUrl` is processed on first open and that Revision is current.
	 */
	currentRevisionId: id.nullable().default(null),
	/** The Book's WordId counter across every Revision processed, published or not (§6.2). */
	nextWordId: z.number().int().positive().default(1),
	communityPolicy: communityPolicySchema.default('closed'),
	communityAi: communityAiSchema.default('allowed'),
	/** Static path of the Book's EPUB, processed by text-pipeline on first open (plan §4.3). */
	epubUrl: z.string().nullable().default(null),
	listingState: z.enum(['draft', 'listed', 'delisted']),
	contentRating: contentRatingSchema.default('all_ages'),
	contentWarnings: z.array(z.string()).default([]),
	/** Its Chapters come out over time. */
	isSerial: z.boolean().default(false),
	/**
	 * SIMULATION (OPEN-10): the newest `chapters` Chapters are early access until `freeAt`,
	 * open now to holders of `productId` (granted by a Creator Subscription, P1-STO-04).
	 */
	earlyAccess: z
		.object({ chapters: z.number().int().positive(), freeAt: z.iso.datetime(), productId: id })
		.nullable()
		.default(null)
});

/** An Illustration Pack (§8.2): its record here, its Illustrations in a built `pack.json`. */
const illustrationPackRecord = z.object({
	id,
	bookId: id,
	creatorId: id,
	name: z.string().min(1),
	description: z.string(),
	isOfficial: z.boolean(),
	/** Null until its creator answers (Studio drafts). */
	aiUse: aiUseSchema.nullable(),
	credit: z.string(),
	/**
	 * Its `pack.json`: a static path built by `npm run layers` (P1-LAY-06), or
	 * `studio:<packId>/pack.json` for a pack built in the Studio (P1-LAY-05).
	 */
	packUrl: z.string().min(1),
	illustrationCount: z.number().int().nonnegative(),
	listingState: z.enum(['draft', 'listed', 'delisted']),
	contentRating: contentRatingSchema.default('all_ages')
});

/** A narration Audio Track (§8.3): its record here, its Chapters in a `track.json` (P1-LAY-03). */
const audioTrackRecord = z.object({
	id,
	bookId: id,
	creatorId: id,
	name: z.string().min(1),
	description: z.string(),
	narrator: z.string().min(1),
	isOfficial: z.boolean(),
	/** Null until its creator answers (Studio drafts). */
	aiUse: aiUseSchema.nullable(),
	credit: z.string(),
	/**
	 * Its `track.json`: a static path written by `npm run narration`, or
	 * `studio:<trackId>/track.json` for one assembled in the Studio (P1-STU-03).
	 */
	trackUrl: z.string().min(1),
	/** Studio tracks: Chapters whose text changed since they were aligned (§6.2, §7.2). */
	staleChapterIds: z.array(id).default([]),
	/** Studio tracks: the low-confidence regions a creator has checked, by Chapter. */
	reviewed: z.record(z.string(), z.array(z.number().int().nonnegative())).default({}),
	chapterCount: z.number().int().nonnegative(),
	durationMs: z.number().int().nonnegative(),
	listingState: z.enum(['draft', 'listed', 'delisted']),
	/** The store page's sample: a stretch of one of its Chapters (index into `track.json`). */
	sample: z
		.object({
			chapter: z.number().int().nonnegative(),
			/** The Chapter's title as the store page shows it. */
			title: z.string().min(1),
			startMs: z.number().int().nonnegative(),
			durationMs: z.number().int().positive()
		})
		.nullable()
		.default(null)
});

/** A Bookmark Design (§6.5, P1-STO-03): a cosmetic that works in every Book. */
const bookmarkDesignRecord = z.object({
	id,
	name: z.string().min(1),
	description: z.string(),
	creatorId: id,
	look: z.object({
		shape: z.enum(['ribbon', 'notched', 'tab']),
		colour: z.string().regex(/^#[0-9a-f]{6}$/),
		accent: z.string().regex(/^#[0-9a-f]{6}$/),
		mark: z.enum(['none', 'heart', 'star', 'flame', 'key']).default('none')
	}),
	/** Everyone owns it from sign-up (§6.5). Exactly one. */
	isDefault: z.boolean().default(false)
});

/** A Creator Subscription plan (§6.5, P1-STO-04). */
const planRecord = z.object({
	id,
	creatorId: id,
	name: z.string().min(1),
	description: z.string(),
	price: moneySchema,
	/** SIMULATION (OPEN-10, OPEN-11): early access to a serial, as an `early_access` Product. */
	benefits: z.array(
		z.object({
			kind: z.literal('early_access'),
			bookId: id,
			productId: id,
			description: z.string()
		})
	)
});

/** A curated shelf on the store's front page (P1-STO-01). */
const shelfRecord = z.object({
	id,
	title: z.string().min(1),
	description: z.string(),
	bookIds: z.array(id)
});

const productRecord = z.object({
	id,
	kind: productKindSchema,
	/** The Book, pack, track or design this Product sells. */
	refId: id,
	bookId: id.nullable(),
	creatorId: id,
	isOfficial: z.boolean(),
	price: moneySchema,
	status: z.enum(['active', 'retired']),
	/** A Bundle's children (§6.5). */
	childProductIds: z.array(id).default([])
});

const entitlementRecord = z.object({
	id,
	userId: id,
	productId: id,
	source: entitlementSourceSchema,
	grantedAt: z.iso.datetime(),
	revokedAt: z.iso.datetime().nullable().default(null),
	parentId: id.nullable().default(null),
	/**
	 * Which builds start with it (plan §6 Phase 1.6): tester builds, which have no store, start
	 * with what owner builds leave the Reader to get. Both when absent.
	 */
	profiles: z.array(z.enum(['owner', 'tester'])).optional()
});

const flagRecord = z.object({
	id,
	targetType: flagTargetTypeSchema,
	targetId: id,
	rule: flagRuleSchema,
	state: flagStateSchema,
	priority: z.number().int().nonnegative(),
	details: z.string(),
	createdAt: z.iso.datetime()
});

export const seedSchema = z.object({
	/** Bump when the seed changes; a different version re-seeds the simulated backend. */
	version: z.number().int().positive(),
	defaultPersonaId: id,
	personas: z.array(personaRecord).min(1),
	creators: z.array(creatorRecord),
	books: z.array(bookRecord),
	illustrationPacks: z.array(illustrationPackRecord).default([]),
	audioTracks: z.array(audioTrackRecord).default([]),
	bookmarkDesigns: z.array(bookmarkDesignRecord).default([]),
	plans: z.array(planRecord).default([]),
	shelves: z.array(shelfRecord).default([]),
	products: z.array(productRecord),
	entitlements: z.array(entitlementRecord),
	/** Open items for the admin review queue (P1-APP-01); P1-ADM-01 adds the rules that raise them. */
	flags: z.array(flagRecord).default([])
});

export type Seed = z.infer<typeof seedSchema>;
export type PersonaRecord = z.infer<typeof personaRecord>;
export type CreatorRecord = z.infer<typeof creatorRecord>;
export type BookRecord = z.infer<typeof bookRecord>;
export type ProductRecord = z.infer<typeof productRecord>;
export type IllustrationPackRecord = z.infer<typeof illustrationPackRecord>;
export type AudioTrackRecord = z.infer<typeof audioTrackRecord>;
export type BookmarkDesignRecord = z.infer<typeof bookmarkDesignRecord>;
export type PlanRecord = z.infer<typeof planRecord>;
export type ShelfRecord = z.infer<typeof shelfRecord>;
export type SeedEntitlementRecord = z.infer<typeof entitlementRecord>;
export type FlagRecord = z.infer<typeof flagRecord>;
export type StoredFileRef = z.infer<typeof storedFileRef>;

export class SeedError extends Error {
	constructor(readonly problems: string[]) {
		super(`The demo seed data is invalid:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
		this.name = 'SeedError';
	}
}

function duplicates(values: string[]): string[] {
	return values.filter((value, index) => values.indexOf(value) !== index);
}

/** Validates shape, then references between records. Throws a `SeedError` listing every problem. */
export function parseSeed(raw: unknown): Seed {
	const result = seedSchema.safeParse(raw);
	if (!result.success) {
		throw new SeedError(
			result.error.issues.map((issue) => {
				const path = issue.path.length ? issue.path.join('.') : '(root)';
				return `${path}: ${issue.message}`;
			})
		);
	}
	const seed = result.data;
	const problems: string[] = [];
	const ids = (records: { id: string }[]) => new Set(records.map((r) => r.id));
	const creators = ids(seed.creators);
	const books = ids(seed.books);
	const products = ids(seed.products);
	const users = new Set(seed.personas.map((p) => p.user.id));

	for (const [name, records] of Object.entries({
		personas: seed.personas,
		creators: seed.creators,
		books: seed.books,
		illustrationPacks: seed.illustrationPacks,
		audioTracks: seed.audioTracks,
		bookmarkDesigns: seed.bookmarkDesigns,
		plans: seed.plans,
		shelves: seed.shelves,
		products: seed.products,
		entitlements: seed.entitlements,
		flags: seed.flags
	})) {
		for (const dup of duplicates(records.map((r) => r.id)))
			problems.push(`${name}: duplicate id "${dup}"`);
	}
	for (const dup of duplicates(seed.books.map((b) => b.slug)))
		problems.push(`books: duplicate slug "${dup}"`);
	for (const dup of duplicates(seed.creators.map((c) => c.handle))) {
		problems.push(`creators: duplicate handle "${dup}"`);
	}

	if (!seed.personas.some((p) => p.id === seed.defaultPersonaId)) {
		problems.push(`defaultPersonaId: no persona "${seed.defaultPersonaId}"`);
	}
	seed.personas.forEach((p, i) => {
		if (p.user.creatorId !== null && !creators.has(p.user.creatorId)) {
			problems.push(`personas.${i}.user.creatorId: no creator "${p.user.creatorId}"`);
		}
		if (p.user.role === 'creator' && p.user.creatorId === null) {
			problems.push(`personas.${i}.user.creatorId: a creator persona needs a creator profile`);
		}
	});
	seed.books.forEach((b, i) => {
		if (!creators.has(b.creatorId))
			problems.push(`books.${i}.creatorId: no creator "${b.creatorId}"`);
		if (!seed.products.some((p) => p.kind === 'book' && p.refId === b.id)) {
			problems.push(`books.${i}: book "${b.id}" has no book Product`);
		}
	});
	const packs = ids(seed.illustrationPacks);
	const designs = ids(seed.bookmarkDesigns);
	seed.illustrationPacks.forEach((pack, i) => {
		if (!books.has(pack.bookId))
			problems.push(`illustrationPacks.${i}.bookId: no book "${pack.bookId}"`);
		if (!creators.has(pack.creatorId))
			problems.push(`illustrationPacks.${i}.creatorId: no creator "${pack.creatorId}"`);
		if (!seed.products.some((p) => p.kind === 'illustration_pack' && p.refId === pack.id)) {
			problems.push(`illustrationPacks.${i}: pack "${pack.id}" has no Product`);
		}
	});
	const tracks = ids(seed.audioTracks);
	seed.audioTracks.forEach((track, i) => {
		if (!books.has(track.bookId))
			problems.push(`audioTracks.${i}.bookId: no book "${track.bookId}"`);
		if (!creators.has(track.creatorId))
			problems.push(`audioTracks.${i}.creatorId: no creator "${track.creatorId}"`);
		if (!seed.products.some((p) => p.kind === 'audio_track' && p.refId === track.id)) {
			problems.push(`audioTracks.${i}: track "${track.id}" has no Product`);
		}
	});
	seed.products.forEach((p, i) => {
		if (!creators.has(p.creatorId))
			problems.push(`products.${i}.creatorId: no creator "${p.creatorId}"`);
		if (p.bookId !== null && !books.has(p.bookId))
			problems.push(`products.${i}.bookId: no book "${p.bookId}"`);
		if (p.kind === 'book' && !books.has(p.refId))
			problems.push(`products.${i}.refId: no book "${p.refId}"`);
		if (p.kind === 'illustration_pack' && !packs.has(p.refId))
			problems.push(`products.${i}.refId: no illustration pack "${p.refId}"`);
		if (p.kind === 'audio_track' && !tracks.has(p.refId))
			problems.push(`products.${i}.refId: no audio track "${p.refId}"`);
		if (p.kind === 'bookmark_design' && !designs.has(p.refId))
			problems.push(`products.${i}.refId: no bookmark design "${p.refId}"`);
		if (p.kind === 'early_access' && !books.has(p.refId))
			problems.push(`products.${i}.refId: no book "${p.refId}"`);
		if (p.kind === 'bundle') {
			if (!p.childProductIds.length) problems.push(`products.${i}: a bundle needs children`);
			for (const child of p.childProductIds) {
				if (!products.has(child))
					problems.push(`products.${i}.childProductIds: no product "${child}"`);
			}
		}
	});
	if (seed.bookmarkDesigns.length && seed.bookmarkDesigns.filter((d) => d.isDefault).length !== 1) {
		problems.push('bookmarkDesigns: exactly one design is the default');
	}
	seed.bookmarkDesigns.forEach((d, i) => {
		if (!seed.products.some((p) => p.kind === 'bookmark_design' && p.refId === d.id)) {
			problems.push(`bookmarkDesigns.${i}: design "${d.id}" has no Product`);
		}
	});
	seed.plans.forEach((plan, i) => {
		if (!creators.has(plan.creatorId))
			problems.push(`plans.${i}.creatorId: no creator "${plan.creatorId}"`);
		for (const benefit of plan.benefits) {
			if (!seed.products.some((p) => p.id === benefit.productId && p.kind === 'early_access')) {
				problems.push(`plans.${i}.benefits: no early_access product "${benefit.productId}"`);
			}
		}
	});
	seed.shelves.forEach((shelf, i) => {
		for (const bookId of shelf.bookIds) {
			if (!books.has(bookId)) problems.push(`shelves.${i}.bookIds: no book "${bookId}"`);
		}
	});
	seed.entitlements.forEach((e, i) => {
		if (!users.has(e.userId))
			problems.push(`entitlements.${i}.userId: no persona user "${e.userId}"`);
		if (!products.has(e.productId))
			problems.push(`entitlements.${i}.productId: no product "${e.productId}"`);
	});

	seed.flags.forEach((f, i) => {
		const known =
			f.targetType === 'book' ? books : f.targetType === 'creator' ? creators : undefined;
		if (known && !known.has(f.targetId)) {
			problems.push(`flags.${i}.targetId: no ${f.targetType} "${f.targetId}"`);
		}
	});

	if (problems.length > 0) throw new SeedError(problems);
	return seed;
}
