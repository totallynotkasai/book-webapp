/**
 * Creator Studio DTOs (DESIGN.md §4.7, P1-STU-01 to P1-STU-04, P1-LAY-05): a Creator's Books,
 * their Revisions and ingest reports, Book settings, Illustration Packs being built, narration
 * Audio Tracks being assembled Chapter by Chapter, Creator Subscription plans, and a simulated
 * earnings dashboard. Money is integer minor units (Invariant 17).
 */
import { z } from 'zod';
import { aiUseSchema, bookSummarySchema, contentRatingSchema } from './backend/dto';
import { ingestReportSchema } from './content';
import {
	illustrationImageSchema,
	illustrationPlacements,
	illustrationSchema,
	pointAnchorSchema,
	rangeAnchorSchema,
	syncMapStatusSchema
} from './layers';
import { moneySchema } from './money';

const id = z.string().min(1);
const int = z.number().int();
const timestamp = z.iso.datetime();
/** Uploaded files. Phase 2 sends them to a presigned upload URL instead (§10.1). */
const file = z.instanceof(Blob);

/**
 * Where a Book or Layer stands (§6.6, §10.6): `draft` until submitted; `pending` while a community
 * Layer waits for the author's approval; `listed` publicly; `held` for a moderator's review
 * (private, the creator can still preview it); `declined` by the author; `delisted` (hidden from the
 * store; owners keep it); `removed` by a moderator.
 */
export const listingStateSchema = z.enum([
	'draft',
	'pending',
	'listed',
	'held',
	'declined',
	'delisted',
	'removed'
]);
export type ListingState = z.infer<typeof listingStateSchema>;

/** `books.community_policy` (§6.6). `closed` is the default (D-010). */
export const communityPolicySchema = z.enum(['closed', 'approval', 'open']);
export type CommunityPolicy = z.infer<typeof communityPolicySchema>;

/** `books.community_ai` (§6.6, §10.6): may AI-generated community Layers be submitted? */
export const communityAiSchema = z.enum(['allowed', 'refused']);
export type CommunityAi = z.infer<typeof communityAiSchema>;

// ---- Books and Revisions (P1-STU-01, P1-STU-02) ----

/** What a new Revision changes against the Book's current one (§6.2), shown before publishing. */
export const revisionChangesSchema = z.object({
	previousRevisionId: id,
	changedChapterIds: z.array(id),
	addedChapterIds: z.array(id),
	removedChapterIds: z.array(id),
	wordsAdded: int.nonnegative(),
	wordsRemoved: int.nonnegative(),
	/** Narration Chapters whose Sync Map becomes `stale` when this is published (§7.2). */
	staleNarration: z.array(z.object({ trackId: id, trackName: z.string(), chapterId: id }))
});
export type RevisionChangesDto = z.infer<typeof revisionChangesSchema>;

/**
 * When one of a Revision's Chapters comes out (P1-STU-06): `out` (readers have it);
 * `with_version` (it comes out when this version is published); or `scheduled` for `releaseAt`.
 * `scheduledAt` is the time the author chose: `releaseAt` is later only when the Chapter before
 * it comes out later, since Chapters come out in order (or null when it follows one that does).
 */
export const chapterReleaseSchema = z.object({
	state: z.enum(['out', 'with_version', 'scheduled']),
	releaseAt: timestamp.nullable(),
	scheduledAt: timestamp.nullable(),
	/** It can still be given a time: it isn't out, isn't the first Chapter, and none after it is out. */
	schedulable: z.boolean()
});
export type ChapterReleaseDto = z.infer<typeof chapterReleaseSchema>;

export const studioRevisionSchema = z.object({
	id,
	bookId: id,
	/** `processing` while text-pipeline runs; `superseded` once a later one is published. */
	state: z.enum(['processing', 'ready', 'failed', 'published', 'superseded']),
	uploadedAt: timestamp,
	publishedAt: timestamp.nullable(),
	/** "Was AI used to make this?" (§10.6), required before publishing. */
	aiUse: aiUseSchema.nullable(),
	report: ingestReportSchema.nullable(),
	/** Why it couldn't be processed, in words the author can act on. */
	failure: z.string().nullable(),
	/** Null for a Book's first Revision. */
	changes: revisionChangesSchema.nullable(),
	/** Its Chapters with Words, in reading order, for the report and the narration manager. */
	chapters: z.array(
		z.object({
			chapterId: id,
			title: z.string(),
			wordCount: int.nonnegative(),
			release: chapterReleaseSchema.default({
				state: 'out',
				releaseAt: null,
				scheduledAt: null,
				schedulable: false
			})
		})
	)
});
export type StudioRevisionDto = z.infer<typeof studioRevisionSchema>;

/**
 * Release a Chapter at a time (P1-STU-06), or with no time of its own (null): with its version
 * when that isn't published yet, or now when readers have it.
 */
export const scheduleChapterInputSchema = z.object({
	chapterId: id,
	releaseAt: timestamp.nullable()
});
export type ScheduleChapterInput = z.infer<typeof scheduleChapterInputSchema>;

/** The settings a Creator controls (P1-STU-02). */
export const bookSettingsSchema = z.object({
	title: z.string().trim().min(1).max(200),
	description: z.string().max(4000),
	/** Simulated: no money moves (plan §8 rule 3). */
	price: moneySchema,
	contentRating: contentRatingSchema,
	contentWarnings: z.array(z.string().trim().min(1).max(60)).max(12),
	communityPolicy: communityPolicySchema,
	communityAi: communityAiSchema,
	/** Its Chapters come out over time. */
	isSerial: z.boolean(),
	/**
	 * SIMULATION (OPEN-10): a serial's newest this-many Chapters are early access for the
	 * author's subscribers for 30 days after each publish; 0 for none.
	 */
	earlyAccessChapters: int.min(0).max(10)
});
export type BookSettingsDto = z.infer<typeof bookSettingsSchema>;

export const bookSettingsInputSchema = bookSettingsSchema.partial().extend({
	/** Corrects the current version's AI answer (a moderator asked to relabel it, §10.6). */
	aiUse: aiUseSchema.optional(),
	/** A new cover image (re-encoded on the device), or null to remove it. */
	cover: file.nullable().optional()
});
export type BookSettingsInput = z.input<typeof bookSettingsInputSchema>;

export const studioPackSummarySchema = z.object({
	id,
	bookId: id,
	name: z.string(),
	isOfficial: z.boolean(),
	listingState: listingStateSchema,
	illustrationCount: int.nonnegative(),
	/** Illustrations without alt text: the pack can't be published until it's 0 (P1-LAY-05). */
	missingAlt: int.nonnegative(),
	/** Illustrations whose text changed in a new Revision and couldn't be placed again (§6.2). */
	orphaned: int.nonnegative(),
	aiUse: aiUseSchema.nullable(),
	price: moneySchema,
	/** A moderator asked for its AI label to be corrected (§10.6). */
	relabelRequired: z.boolean().default(false)
});
export type StudioPackSummaryDto = z.infer<typeof studioPackSummarySchema>;

export const studioTrackSummarySchema = z.object({
	id,
	bookId: id,
	name: z.string(),
	narrator: z.string(),
	isOfficial: z.boolean(),
	listingState: listingStateSchema,
	aiUse: aiUseSchema.nullable(),
	price: moneySchema,
	chapterCount: int.nonnegative(),
	/** Chapters by Sync Map status, for the dashboard's next steps. */
	ready: int.nonnegative(),
	needsReview: int.nonnegative(),
	stale: int.nonnegative(),
	/** A moderator asked for its AI label to be corrected (§10.6). */
	relabelRequired: z.boolean().default(false)
});
export type StudioTrackSummaryDto = z.infer<typeof studioTrackSummarySchema>;

export const studioBookSchema = bookSummarySchema.extend({
	listingState: listingStateSchema,
	/** The newest unpublished Revision's state, if there is one. */
	pendingRevision: z.enum(['processing', 'ready', 'failed']).nullable()
});
export type StudioBookDto = z.infer<typeof studioBookSchema>;

export const studioBookDetailSchema = z.object({
	id,
	slug: id,
	creatorId: id,
	listingState: listingStateSchema,
	coverUrl: z.string().nullable(),
	settings: bookSettingsSchema,
	/** The current published Revision's AI answer (§10.6), shown on the store page. */
	aiUse: aiUseSchema.nullable(),
	currentRevisionId: id.nullable(),
	/** Newest first. */
	revisions: z.array(studioRevisionSchema),
	packs: z.array(studioPackSummarySchema),
	tracks: z.array(studioTrackSummarySchema)
});
export type StudioBookDetailDto = z.infer<typeof studioBookDetailSchema>;

export const publishRevisionInputSchema = z.object({
	revisionId: id,
	aiUse: aiUseSchema
});
export type PublishRevisionInput = z.infer<typeof publishRevisionInputSchema>;

// ---- Illustration Packs (P1-LAY-05) ----

export const layerDetailsSchema = z.object({
	name: z.string().trim().min(1).max(120),
	description: z.string().max(2000),
	credit: z.string().max(200),
	aiUse: aiUseSchema.nullable(),
	price: moneySchema
});
export type LayerDetailsDto = z.infer<typeof layerDetailsSchema>;
export const layerDetailsInputSchema = layerDetailsSchema.partial();
export type LayerDetailsInput = z.input<typeof layerDetailsInputSchema>;

/** An Illustration being placed: alt text may still be missing (publishing needs it). */
export const draftIllustrationSchema = illustrationSchema.extend({
	alt: z.string(),
	/** `orphaned`: its text changed in a new Revision and it couldn't be placed again (§6.2). */
	anchorStatus: z.enum(['ok', 'migrated', 'orphaned'])
});
export type DraftIllustrationDto = z.infer<typeof draftIllustrationSchema>;

export const studioPackSchema = studioPackSummarySchema.extend({
	description: z.string(),
	credit: z.string(),
	/** The Revision its Anchors are on. */
	revisionId: id.nullable(),
	/** In reading order. */
	illustrations: z.array(draftIllustrationSchema),
	/** Reads the pack's images with `content.read`. */
	contentToken: z.string().min(16),
	expiresAt: timestamp
});
export type StudioPackDto = z.infer<typeof studioPackSchema>;

/**
 * An image prepared on the device (plan §6 Phase 1.7: re-encoded to WebP, which strips EXIF):
 * WebP variants by width, ascending, and a colour to show while it loads (§7.3).
 */
export const imageUploadSchema = z.object({
	width: int.positive(),
	height: int.positive(),
	dominant: illustrationImageSchema.shape.dominant,
	variants: z.array(z.object({ width: int.positive(), file })).min(1)
});
export type ImageUpload = z.infer<typeof imageUploadSchema>;

export const illustrationInputSchema = z.object({
	anchor: rangeAnchorSchema,
	placement: z.enum(illustrationPlacements),
	span: z.enum(['single', 'double']),
	alt: z.string().max(1000),
	caption: z.string().max(500).optional(),
	credit: z.string().max(200).optional(),
	spoilerSafe: z.boolean(),
	image: imageUploadSchema
});
export type IllustrationInput = z.input<typeof illustrationInputSchema>;

export const illustrationChangesSchema = illustrationInputSchema
	.omit({ image: true })
	.partial()
	.extend({ image: imageUploadSchema.optional() });
export type IllustrationChanges = z.input<typeof illustrationChangesSchema>;

// ---- Narration (P1-STU-03) ----

export const studioTrackChapterSchema = z.object({
	chapterId: id,
	title: z.string(),
	wordCount: int.nonnegative(),
	/** `missing`: no audio and Sync Map yet. */
	status: z.union([syncMapStatusSchema, z.literal('missing')]),
	durationMs: int.nonnegative().nullable(),
	coverage: z.number().min(0).max(1).nullable(),
	/** Low-confidence regions, and how many the creator has checked. */
	regions: int.nonnegative(),
	reviewed: int.nonnegative()
});
export type StudioTrackChapterDto = z.infer<typeof studioTrackChapterSchema>;

export const studioTrackSchema = studioTrackSummarySchema.extend({
	description: z.string(),
	credit: z.string(),
	/** The Revision Chapters are listed from: the newest one. */
	revisionId: id.nullable(),
	chapters: z.array(studioTrackChapterSchema)
});
export type StudioTrackDto = z.infer<typeof studioTrackSchema>;

export const trackDetailsInputSchema = layerDetailsInputSchema.extend({
	narrator: z.string().trim().min(1).max(120).optional()
});
export type TrackDetailsInput = z.input<typeof trackDetailsInputSchema>;

/**
 * One Chapter's narration: its audio and a Sync Map from `tools/align` (§7.2), checked against
 * the Chapter's Words. Phase 3 aligns on the server instead (`align-narration`).
 */
export const chapterNarrationInputSchema = z.object({
	chapterId: id,
	audio: file,
	/** The Sync Map JSON as uploaded; validated against §7.2 and the Chapter. */
	syncMap: z.unknown()
});
export type ChapterNarrationInput = z.infer<typeof chapterNarrationInputSchema>;

/** A run of Words whose times were guessed rather than heard (§7.2 step 5). */
export const reviewRegionSchema = z.object({
	index: int.nonnegative(),
	startMs: int.nonnegative(),
	endMs: int.nonnegative(),
	firstWordId: int.positive(),
	lastWordId: int.positive(),
	wordCount: int.positive(),
	/** The Words, with a few around them for context. */
	before: z.string(),
	text: z.string(),
	after: z.string(),
	reviewed: z.boolean()
});
export type ReviewRegionDto = z.infer<typeof reviewRegionSchema>;

/** The review screen for one Chapter (P1-STU-03, §7.2 step 6). */
export const chapterReviewSchema = z.object({
	trackId: id,
	chapterId: id,
	chapterTitle: z.string(),
	coverage: z.number().min(0).max(1),
	status: syncMapStatusSchema,
	durationMs: int.nonnegative(),
	/** A URL the platform audio player can stream (as in `layers.openTrack`). */
	audioUrl: id,
	regions: z.array(reviewRegionSchema)
});
export type ChapterReviewDto = z.infer<typeof chapterReviewSchema>;

// ---- Plans and earnings (P1-STU-04) ----

export const planInputSchema = z.object({
	name: z.string().trim().min(1).max(80),
	description: z.string().max(1000),
	/** Per month. */
	price: moneySchema.refine((m) => m.amountMinor >= 100, { message: 'At least 1.00 a month' }),
	/** Serials whose early-access Chapters it opens (§6.5; OPEN-10 stays open). */
	earlyAccessBookIds: z.array(id)
});
export type PlanInput = z.infer<typeof planInputSchema>;

/** How a sale divides (§6.5 `revenue_split`), in minor units. Simulated: OPEN-08 is open. */
export const splitSchema = z.object({
	gross: moneySchema,
	platform: moneySchema,
	/** What this Creator receives. */
	yours: moneySchema,
	/** What other Creators receive: on a community Layer, the author's or the creator's share. */
	others: moneySchema
});
export type SplitDto = z.infer<typeof splitSchema>;

export const earningsLineSchema = z.object({
	kind: z.enum(['sales', 'tips', 'subscriptions']),
	/** What it's for: a Product's name, "Tips", or a plan's name. */
	label: z.string(),
	count: int.nonnegative(),
	split: splitSchema
});

export const earningsSchema = z.object({
	/** Every figure is simulated (P1-STU-04 acceptance). */
	simulated: z.literal(true),
	currency: z.string().regex(/^[A-Z]{3}$/),
	/** The placeholder split rules in words, e.g. "Platform 10% of sales (placeholder)". */
	splitNotes: z.array(z.string()),
	total: splitSchema,
	lines: z.array(earningsLineSchema),
	activeSubscribers: int.nonnegative()
});
export type EarningsDto = z.infer<typeof earningsSchema>;

// ---- Reader-side migration (P1-STU-01: readers' Anchors move when they next open a Book) ----

const migratedSchema = <T extends z.ZodType>(anchor: T) =>
	z.object({
		anchor,
		status: z.enum(['ok', 'migrated', 'orphaned'])
	});

export const migrateAnchorsInputSchema = z.object({
	/** The Revision the Anchors are on. */
	fromRevisionId: id,
	anchors: z.array(z.discriminatedUnion('kind', [pointAnchorSchema, rangeAnchorSchema])),
	progress: z.array(pointAnchorSchema)
});
export type MigrateAnchorsInput = z.infer<typeof migrateAnchorsInputSchema>;

export const migrateAnchorsResultSchema = z.object({
	/** The Book's current Revision, which they now point into. */
	revisionId: id,
	anchors: z.array(
		migratedSchema(z.discriminatedUnion('kind', [pointAnchorSchema, rangeAnchorSchema]))
	),
	/** Reading Progress falls back to the nearest surviving Word, so it is never orphaned. */
	progress: z.array(migratedSchema(pointAnchorSchema).nullable())
});
export type MigrateAnchorsResult = z.infer<typeof migrateAnchorsResultSchema>;
