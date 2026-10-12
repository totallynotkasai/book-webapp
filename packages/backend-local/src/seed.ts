/**
 * Seed data for the simulated backend (IMPLEMENTATION-PLAN.md §4.3): versioned JSON in
 * `fixtures/seed/`, fetched at runtime (never bundled) and validated here before use.
 *
 * These are backend-local's private records, like storage-local's IndexedDB schema, so their
 * schema lives here. What the app sees are the DTOs in `@book/core`.
 */
import {
	aiUseSchema,
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
	aiUse: aiUseSchema,
	description: z.string(),
	coverUrl: z.string().nullable(),
	listingState: z.enum(['draft', 'listed', 'delisted'])
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
	status: z.enum(['active', 'retired'])
});

const entitlementRecord = z.object({
	id,
	userId: id,
	productId: id,
	source: entitlementSourceSchema,
	grantedAt: z.iso.datetime(),
	revokedAt: z.iso.datetime().nullable().default(null)
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
export type SeedEntitlementRecord = z.infer<typeof entitlementRecord>;
export type FlagRecord = z.infer<typeof flagRecord>;

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
	seed.products.forEach((p, i) => {
		if (!creators.has(p.creatorId))
			problems.push(`products.${i}.creatorId: no creator "${p.creatorId}"`);
		if (p.bookId !== null && !books.has(p.bookId))
			problems.push(`products.${i}.bookId: no book "${p.bookId}"`);
		if (p.kind === 'book' && !books.has(p.refId))
			problems.push(`products.${i}.refId: no book "${p.refId}"`);
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
